/**
 * Formly Apply Agent V1 — content script.
 *
 * Runs only when THIS extension injects it, and does exactly two things:
 *   SCAN — returns metadata of visible form controls (labels, kinds, required
 *          flags, option lists). It never reads a control's VALUE.
 *   FILL — writes values the Formly server resolved from the student's own
 *          profile into controls the student explicitly approved, dispatching
 *          input/change events, and reports per-field results.
 *
 * It never submits forms, never touches password/OTP/CAPTCHA/payment/upload
 * fields, and never acts without an explicit FILL message from the extension.
 */

const AgentCore = typeof RankoraAgentCore !== 'undefined' ? RankoraAgentCore : null

const UNSAFE_PATTERNS = [
  /password/i,
  /\bpasswd\b/i,
  /\botp\b/i,
  /one[\s-]?time/i,
  /\bcaptcha\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /card[\s-]?(no|number|num|holder)/i,
  /\bdebit\b/i,
  /credit[\s-]?card/i,
  /\bpayment\b/i,
  /security[\s-]?(code|pin)/i,
  /bank[\s-]?(account|ifsc|branch)/i,
  /\baadhaar\b/i,
  /\baadhar\b/i,
  /\bpassport\b/i,
  /\bupload\b/i,
  /\battach(ment)?\b/i,
  /\bdeclaration\b/i,
  /\bundertaking\b/i,
  /\bi\s+agree\b/i,
  /\bconsent\b/i,
  /\bapplication\s*(no|number)\b/i,
]

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image'])
const FILLABLE_TEXT_KINDS = new Set(['text', 'textarea', 'email', 'tel', 'date', 'number'])

/** sniffed results of the last scan; entries keep live DOM references */
let scanRegistry = []

/* ------------------------------------------------------------------ */
/* generic helpers                                                     */
/* ------------------------------------------------------------------ */

function normalizeLabel(raw) {
  return String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function untrustedText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

/** Page text is untrusted input; keep descriptors inside the server schema. */
function clip(value, max) {
  const text = untrustedText(value)
  return text.length > max ? text.slice(0, max) : text
}

function cssEscape(value) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value)
  return String(value).replace(/([^\w-])/g, '\\$1')
}

function textLabelledBy(idList) {
  return idList
    .split(/\s+/)
    .map(id => document.getElementById(id))
    .filter(Boolean)
    .map(el => untrustedText(el.textContent))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function isVisibleControl(element) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (parseFloat(style.opacity || '1') === 0) return false
  return element.getClientRects().length > 0
}

function isUnsafeDescriptor(parts) {
  const haystack = parts.join(' | ')
  return UNSAFE_PATTERNS.some(pattern => pattern.test(haystack))
}

/* ------------------------------------------------------------------ */
/* label resolution                                                    */
/* ------------------------------------------------------------------ */

function labelForControl(control) {
  if (control.id) {
    const explicit = document.querySelector('label[for="' + cssEscape(control.id) + '"]')
    if (explicit) return untrustedText(explicit.textContent)
  }
  const nested = control.closest('label')
  if (nested) {
    const own = untrustedText(nested.textContent)
    if (own) return own
  }
  const labelledBy = control.getAttribute('aria-labelledby')
  if (labelledBy) {
    const joined = textLabelledBy(labelledBy)
    if (joined) return joined
  }
  const ariaLabel = control.getAttribute('aria-label')
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
  const placeholder = control.getAttribute('placeholder')
  if (placeholder && placeholder.trim()) return placeholder.trim() + ' (placeholder)'
  return ''
}

function labelledTextForRadio(radio) {
  if (radio.id) {
    const explicit = document.querySelector('label[for="' + cssEscape(radio.id) + '"]')
    if (explicit) return untrustedText(explicit.textContent)
  }
  const nested = radio.closest('label')
  if (nested) return untrustedText(nested.textContent)
  return ''
}

function labelForRadioGroup(radios) {
  const first = radios[0]
  const groupContainer = first.closest('[role="radiogroup"]')
  if (groupContainer) {
    const ariaLabel = groupContainer.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
    const labelledBy = groupContainer.getAttribute('aria-labelledby')
    if (labelledBy) {
      const joined = textLabelledBy(labelledBy)
      if (joined) return joined
    }
  }
  const fieldset = first.closest('fieldset')
  const legend = fieldset ? fieldset.querySelector('legend') : null
  if (legend) return untrustedText(legend.textContent)

  // last resort: the closest preceding sibling text of an enclosing container
  let node = first.parentElement
  while (node && node !== document.body) {
    const sibling = node.previousElementSibling
    const text = sibling ? untrustedText(sibling.textContent) : ''
    if (text && text.length <= 160) return text
    node = node.parentElement
  }
  return labelledTextForRadio(first)
}

/**
 * Nearest accessible grouping label. This is what lets the JEE adapter know
 * that "School Board" belongs to Class 10, or that bare "Day"/"Month"/"Year"
 * selects belong to the candidate date of birth. If no group can be found we
 * return an empty string and the server leaves the field manual.
 */
function groupLabelForControl(control) {
  const fieldset = control.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend) {
      const text = untrustedText(legend.textContent)
      if (text) return text
    }
  }

  const groupContainer = control.closest('[role="group"], [role="radiogroup"]')
  if (groupContainer) {
    const ariaLabel = groupContainer.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
    const labelledBy = groupContainer.getAttribute('aria-labelledby')
    if (labelledBy) {
      const joined = textLabelledBy(labelledBy)
      if (joined) return joined
    }
  }

  const section = control.closest('section[aria-label], section[aria-labelledby]')
  if (section) {
    const ariaLabel = section.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
    const labelledBy = section.getAttribute('aria-labelledby')
    if (labelledBy) {
      const joined = textLabelledBy(labelledBy)
      if (joined) return joined
    }
  }

  let node = control.parentElement
  while (node && node !== document.body) {
    let sibling = node.previousElementSibling
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        const text = untrustedText(sibling.textContent)
        if (text) return text
      }
      const nestedHeading = sibling.querySelector ? sibling.querySelector('h1, h2, h3, h4, h5, h6, legend') : null
      if (nestedHeading) {
        const text = untrustedText(nestedHeading.textContent)
        if (text) return text
      }
      sibling = sibling.previousElementSibling
    }
    node = node.parentElement
  }

  return ''
}

/* ------------------------------------------------------------------ */
/* page context                                                        */
/* ------------------------------------------------------------------ */

function pageHeadings() {
  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend'))
    .filter(element => isVisibleControl(element))
    .slice(0, 40)
    .map(element => untrustedText(element.textContent))
    .filter(Boolean)
    .slice(0, 40)
}

/**
 * Current page identity for the extension only. The URL is reduced to origin
 * + pathname (the official portal's `enc` query is a one-time token and must
 * never leave the tab). Kind and fingerprint are derived from labels and
 * structure — never from field values.
 */
function pageInfo(descriptors) {
  const sanitized = AgentCore ? AgentCore.sanitizeUrl(location.href) : null
  const classified = AgentCore ? AgentCore.classifyUrl(location.href) : null
  if (!classified) {
    return {
      adapter: 'none',
      url: sanitized,
      official: false,
      fixture: false,
      kind: 'unknown',
      fingerprint: '',
      supported: false,
    }
  }

  const kind =
    classified.adapter === 'none'
      ? 'unknown'
      : AgentCore.classifyPageKind({
          adapter: classified.adapter,
          headings: pageHeadings(),
          labels: descriptors.map(descriptor => descriptor.label).filter(Boolean),
          hasPasswordField: !!document.querySelector('input[type="password"]'),
        })

  const fingerprint = AgentCore.computeFingerprint(descriptors)
  const supported = classified.adapter !== 'none' && AgentCore.isFillablePageKind(kind)
  const adapterMeta = AgentCore.adapterById(classified.adapter)

  return {
    adapter: classified.adapter,
    adapterLabel: adapterMeta ? adapterMeta.name : null,
    adapterStatus: adapterMeta ? adapterMeta.statusLabel : null,
    url: sanitized,
    official: classified.official,
    fixture: classified.fixture,
    kind,
    fingerprint,
    supported,
  }
}

/* ------------------------------------------------------------------ */
/* detection                                                           */
/* ------------------------------------------------------------------ */

function sameGroupRadios(radio) {
  const name = radio.name || ''
  const anchorForm = radio.form
  return Array.from(document.querySelectorAll('input[type="radio"]')).filter(other => {
    if (other.name !== name) return false
    const otherForm = other.form
    return anchorForm && otherForm ? otherForm === anchorForm : otherForm === anchorForm
  })
}

function optionsForSelect(control) {
  const options = Array.from(control.options).map(option => ({
    text: untrustedText(option.text),
    value: option.value || '',
  }))
  const hasValues = options.some(option => option.value !== '')
  if (!hasValues) return options.filter(option => option.text !== '')
  // Drop empty-value placeholder options ("Select day", "Choose...") so the
  // server's option-shape heuristics see the meaningful option list only.
  return options.filter(option => option.value !== '' && !/^(select|choose|pick)\b/i.test(option.text))
}

function collectControlUnits() {
  const units = []
  const groupedRadios = new Set()
  for (const element of document.querySelectorAll('input, textarea, select')) {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLSelectElement)) continue
    if (!isVisibleControl(element)) continue

    if (element instanceof HTMLSelectElement) {
      if (element.disabled) continue
      units.push({ kind: 'select', control: element })
      continue
    }

    if (element instanceof HTMLTextAreaElement) {
      if (element.disabled) continue
      units.push({ kind: 'textarea', control: element })
      continue
    }

    const type = (element.type || 'text').toLowerCase()

    if (SKIP_INPUT_TYPES.has(type)) continue
    if (type === 'password') continue // never detected, never reported, never filled
    if (element.disabled) continue

    if (type === 'radio') {
      if (groupedRadios.has(element)) continue
      const radios = sameGroupRadios(element).filter(isVisibleControl)
      radios.forEach(radio => groupedRadios.add(radio))
      if (radios.length === 0 || radios[0].disabled) continue
      units.push({ kind: 'radio-group', radios })
      continue
    }

    if (type === 'file') {
      units.push({ kind: 'file', control: element })
      continue
    }

    if (type === 'checkbox') {
      units.push({ kind: 'checkbox', control: element })
      continue
    }

    units.push({ kind: 'text-input', control: element, inputType: type })
  }
  return units
}

function kindForUnit(unit) {
  if (unit.kind === 'radio-group') return 'radio'
  if (unit.kind === 'file') return 'file'
  if (unit.kind === 'checkbox') return 'checkbox'
  if (unit.kind === 'textarea') return 'textarea'
  if (unit.kind === 'select') return 'select'
  const type = unit.inputType
  if (type === 'date') return 'date'
  if (type === 'number') return 'number'
  if (type === 'email') return 'email'
  if (type === 'tel') return 'tel'
  return 'text'
}

function descriptorForUnit(unit, index) {
  if (unit.kind === 'radio-group') {
    const first = unit.radios[0]
    return {
      index,
      label: clip(labelForRadioGroup(unit.radios), 240),
      kind: 'radio',
      inputName: first.name || '',
      inputId: first.id || '',
      required: unit.radios.some(radio => radio.required || radio.getAttribute('aria-required') === 'true'),
      inputType: 'radio',
      group: clip(groupLabelForControl(first), 240),
      options: unit.radios.slice(0, 80).map(radio => ({
        text: clip(labelledTextForRadio(radio) || radio.value || '', 150),
        value: clip(radio.value || '', 150),
      })),
    }
  }

  const control = unit.control
  return {
    index,
    label: clip(labelForControl(control), 240),
    kind: kindForUnit(unit),
    inputName: clip(control.name || '', 150),
    inputId: clip(control.id || '', 150),
    required: control.required === true || control.getAttribute('aria-required') === 'true',
    inputType: unit.kind === 'textarea' ? 'textarea' : String(control.type || '').slice(0, 20),
    group: clip(groupLabelForControl(control), 240),
    options: unit.kind === 'select' ? optionsForSelect(control).slice(0, 80).map(option => ({
      text: clip(option.text, 150),
      value: clip(option.value, 150),
    })) : [],
  }
}

function scanPage() {
  scanRegistry = []
  const descriptors = []
  for (const unit of collectControlUnits()) {
    const index = descriptors.length
    const descriptor = descriptorForUnit(unit, index)
    descriptors.push(descriptor)
    scanRegistry.push({ descriptor, unit })
  }
  return { ok: true, fields: descriptors, page: pageInfo(descriptors) }
}

/* ------------------------------------------------------------------ */
/* filling                                                             */
/* ------------------------------------------------------------------ */

const VALUE_DESCRIPTOR_INPUT = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
const VALUE_DESCRIPTOR_TEXTAREA = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
const VALUE_DESCRIPTOR_SELECT = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
const CHECKED_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')

function valueSetterFor(control) {
  if (control instanceof HTMLTextAreaElement) return VALUE_DESCRIPTOR_TEXTAREA ? VALUE_DESCRIPTOR_TEXTAREA.set : null
  if (control instanceof HTMLSelectElement) return VALUE_DESCRIPTOR_SELECT ? VALUE_DESCRIPTOR_SELECT.set : null
  return VALUE_DESCRIPTOR_INPUT ? VALUE_DESCRIPTOR_INPUT.set : null
}

function fireInputAndChange(control) {
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

function setChecked(target, checked) {
  if (CHECKED_DESCRIPTOR && CHECKED_DESCRIPTOR.set) CHECKED_DESCRIPTOR.set.call(target, checked)
  else target.checked = checked
  fireInputAndChange(target)
}

function pickOption(control, rawValue) {
  const wanted = normalizeLabel(rawValue)
  if (!wanted) return null
  const options = Array.from(control.options)
  let match = options.find(option => normalizeLabel(option.text) === wanted)
  if (!match) match = options.find(option => normalizeLabel(option.value) === wanted)
  if (!match && /^\d{1,4}$/.test(String(rawValue).trim())) {
    const numeric = parseInt(String(rawValue).trim(), 10)
    match = options.find(option => /^\d{1,4}$/.test(option.value) && parseInt(option.value, 10) === numeric)
  }
  return match || null
}

function pickRadio(radios, rawValue) {
  const wanted = normalizeLabel(rawValue)
  if (!wanted) return null
  return (
    radios.find(radio => normalizeLabel(labelledTextForRadio(radio)) === wanted) ||
    radios.find(radio => normalizeLabel(radio.value) === wanted) ||
    null
  )
}

function stillMatchesSnapshot(entry) {
  const control = entry.unit.control
  if (!control || !(control instanceof HTMLElement) || !control.isConnected) return false
  return (
    kindForUnit(entry.unit) === entry.descriptor.kind &&
    (control.name || '') === entry.descriptor.inputName &&
    labelForControl(control) === entry.descriptor.label &&
    groupLabelForControl(control) === entry.descriptor.group
  )
}

function isUnsafeNow(entry) {
  return isUnsafeDescriptor([
    entry.descriptor.label,
    entry.descriptor.group || '',
    entry.descriptor.inputName,
    entry.descriptor.inputId,
    entry.descriptor.inputType || '',
  ])
}

function verifiedWrite(kind, expected, actual) {
  if (AgentCore) return AgentCore.verifyWrite(kind, expected, actual)
  if (kind === 'radio' || kind === 'checkbox') return expected === true && actual === true
  return typeof expected === 'string' && actual === expected
}

function fillEntry(entry, rawValue) {
  const kind = entry.descriptor.kind
  if (kind === 'file') return 'refused'
  if (isUnsafeNow(entry)) return 'refused'

  // Radio groups carry descriptor kind 'radio' (detection reports the group as
  // kind: 'radio') and have no single `unit.control`, so they are handled here
  // BEFORE the generic snapshot check, which is only valid for single controls.
  if (kind === 'radio') {
    // Fresh lookup: single-page apps may have re-rendered since the scan.
    const radios = sameGroupRadios(entry.unit.radios[0]).filter(isVisibleControl)
    if (radios.length === 0) return 'stale'
    if (
      isUnsafeDescriptor([
        entry.descriptor.label,
        entry.descriptor.group || '',
        entry.descriptor.inputName || radios[0].name || '',
      ])
    ) {
      return 'refused'
    }
    const target = pickRadio(radios, rawValue)
    if (!target) return 'no-option'
    setChecked(target, true)
    return verifiedWrite('radio', true, target.checked) ? 'filled' : 'unverified'
  }

  if (!stillMatchesSnapshot(entry)) return 'stale'
  const control = entry.unit.control
  const setter = valueSetterFor(control)

  if (kind === 'checkbox') {
    if (rawValue !== true) return 'skipped'
    setChecked(control, true)
    return verifiedWrite('checkbox', true, control.checked) ? 'filled' : 'unverified'
  }

  if (kind === 'select') {
    if (control.disabled) return 'skipped'
    const option = pickOption(control, String(rawValue))
    if (!option) return 'no-option'
    if (setter) setter.call(control, option.value)
    else control.value = option.value
    // Empty-valued options are common in legacy portals; selecting by index
    // makes the choice unambiguous and lets us read it back.
    if (control.value !== option.value) control.selectedIndex = option.index
    fireInputAndChange(control)
    return control.selectedIndex === option.index ? 'filled' : 'unverified'
  }

  if (!FILLABLE_TEXT_KINDS.has(kind)) return 'unsupported'
  if (control.readOnly) return 'skipped'
  const textValue = String(rawValue)
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(textValue)) return 'no-option'
  if (setter) setter.call(control, textValue)
  else control.value = textValue
  fireInputAndChange(control)
  return verifiedWrite(kind, textValue, control.value) ? 'filled' : 'unverified'
}

function applyFill(fills, expectedFingerprint) {
  if (!AgentCore) {
    return { ok: false, error: 'The shared agent policy failed to load — reload this page and the extension.' }
  }

  // Re-scan immediately before writing. This both refreshes the registry and
  // proves the page still has the structure the student approved.
  const fresh = scanPage()
  const page = fresh.page
  if (page.adapter === 'none') {
    return { ok: false, error: 'This page is not an approved Formly target; nothing was filled.' }
  }
  if (!AgentCore.isFillablePageKind(page.kind)) {
    return { ok: false, error: AgentCore.pageNotice(page.adapter, page.kind) }
  }
  if (!expectedFingerprint) {
    return { ok: false, error: 'Inspect this page again before filling.' }
  }
  if (expectedFingerprint && page.fingerprint !== expectedFingerprint) {
    return { ok: false, code: 'PAGE_CHANGED', error: 'The page changed since the scan — inspect again.' }
  }

  const results = []
  for (const fill of fills) {
    if (!fill || typeof fill.index !== 'number') continue
    const entry = scanRegistry.find(candidate => candidate.descriptor.index === fill.index)
    if (!entry) {
      results.push({ index: fill.index, status: 'stale' })
      continue
    }
    const valueOk = typeof fill.value === 'string' || fill.value === true
    if (!valueOk) {
      results.push({ index: fill.index, status: 'no-saved-value' })
      continue
    }
    const status = fillEntry(entry, fill.value)
    results.push({
      index: fill.index,
      status,
      // Kept inside the extension so a second DOM read can prove the value
      // stayed unchanged. This value is never sent to the server or model.
      ...(status === 'filled' ? { value: readEntryValue(entry).value } : {}),
    })
  }
  return { ok: true, results, fingerprint: page.fingerprint }
}

function readEntryValue(entry) {
  const kind = entry.descriptor.kind
  if (kind === 'file') return { value: null, status: 'refused' }
  if (isUnsafeNow(entry)) return { value: null, status: 'refused' }

  if (kind === 'radio') {
    const radios = sameGroupRadios(entry.unit.radios[0]).filter(isVisibleControl)
    if (radios.length === 0) return { value: null, status: 'stale' }
    const selected = radios.find(radio => radio.checked)
    if (!selected) return { value: null, status: 'unverified' }
    return { value: selected.value, status: 'filled' }
  }

  if (!stillMatchesSnapshot(entry)) return { value: null, status: 'stale' }
  const control = entry.unit.control

  if (kind === 'checkbox') {
    return { value: control.checked, status: control.checked ? 'filled' : 'unverified' }
  }

  if (kind === 'select') {
    return { value: control.value, status: control.value ? 'filled' : 'unverified' }
  }

  if (!FILLABLE_TEXT_KINDS.has(kind)) return { value: null, status: 'unsupported' }
  return { value: control.value, status: control.value ? 'filled' : 'unverified' }
}

function verifyFields(approved) {
  if (!AgentCore) {
    return { ok: false, error: 'The shared agent policy failed to load — reload this page and the extension.' }
  }

  const fresh = scanPage()
  const page = fresh.page
  if (page.adapter === 'none') {
    return { ok: false, error: 'This page is not an approved Formly target; nothing was verified.' }
  }

  const results = []
  for (const item of approved) {
    if (!item || typeof item.index !== 'number') continue
    const entry = scanRegistry.find(candidate => candidate.descriptor.index === item.index)
    if (!entry) {
      results.push({ index: item.index, canonical: item.canonical, status: 'stale', value: null })
      continue
    }
    const read = readEntryValue(entry)
    results.push({ index: item.index, canonical: item.canonical, status: read.status, value: read.value })
  }
  return { ok: true, results, fingerprint: page.fingerprint }
}

/* ------------------------------------------------------------------ */
/* message endpoints (extension-only: pages cannot reach this)          */
/* ------------------------------------------------------------------ */

if (!window.__rankoraApplyAgentLoaded) {
  window.__rankoraApplyAgentLoaded = true
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'RANKORA_SCAN') {
      sendResponse(scanPage())
      return
    }
    if (message.type === 'RANKORA_PAGE') {
      const fresh = scanPage()
      sendResponse({ ok: true, page: fresh.page })
      return
    }
    if (message.type === 'RANKORA_FILL') {
      sendResponse(
        applyFill(
          Array.isArray(message.fills) ? message.fills : [],
          typeof message.expectedFingerprint === 'string' ? message.expectedFingerprint : null
        )
      )
      return
    }
    if (message.type === 'RANKORA_VERIFY') {
      sendResponse(verifyFields(Array.isArray(message.approved) ? message.approved : []))
      return
    }
  })
}
