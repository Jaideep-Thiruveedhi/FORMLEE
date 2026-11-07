/**
 * Formlee Apply Agent V1 — popup controller.
 *
 * Plan rendering is DOM-safe: every page-derived string (labels, reasons)
 * goes through textContent — never innerHTML — because labels come from any
 * web page the student inspects.
 */

const state = {
  connected: false,
  expiresAt: null,
  plan: null,
  page: null,
  filledAt: null,
}

const STATUS_BADGES = {
  mapped: { text: 'Will fill', cls: 'st-mapped' },
  ambiguous: { text: 'Needs your choice', cls: 'st-ambiguous' },
  manual: { text: 'Fill by hand', cls: 'st-neutral' },
  unsafe: { text: 'Skipped for safety', cls: 'st-unsafe' },
  unmapped: { text: 'Not mapped', cls: 'st-neutral' },
}

// Shared vocabulary: the popup and side panel must describe fields,
// results and adapter honesty identically.
const AgentUI = typeof FormleeAgentUI !== 'undefined' ? FormleeAgentUI : null

function pageKindLabel(kind) {
  return AgentUI ? AgentUI.pageKindLabel(kind) : (kind || 'this page')
}

function clearStatusLabel(adapterStatus) {
  return AgentUI ? AgentUI.clearStatusLabel(adapterStatus) : null
}

function adapterBannerClass(adapterStatus) {
  const tone = AgentUI ? AgentUI.adapterTone(adapterStatus) : ''
  if (tone === 'error') return 'banner-error'
  if (tone === 'warn') return 'banner-warn'
  return ''
}

function adapterBannerBody(adapterStatus, pageKind) {
  return AgentUI ? AgentUI.adapterSummary(adapterStatus, pageKind) : ''
}

const FILLABLE_FIELD_NAMES = AgentUI ? AgentUI.FIELD_NAMES : {}

const RESULT_LINES = AgentUI ? AgentUI.RESULT_LINES : {}

const el = id => document.getElementById(id)

document.addEventListener('DOMContentLoaded', () => {
  el('pair-button').addEventListener('click', onPair)
  el('pair-code').addEventListener('keydown', event => {
    if (event.key === 'Enter') onPair()
  })
  el('scan-button').addEventListener('click', onScan)
  el('show-pet-button').addEventListener('click', onShowPet)
  el('fill-button').addEventListener('click', onFill)
  el('cancel-button').addEventListener('click', onCancel)
  el('disconnect-button').addEventListener('click', onDisconnect)
  window.setInterval(refreshExpiry, 1000)
  refreshStatus()
})

/* ------------------------------ runtime bridge ------------------------------ */

function sendRuntime(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError
      resolve(error ? { ok: false, error: error.message } : (response || { ok: false, error: 'No response from the extension.' }))
    })
  })
}

/* ------------------------------ status ------------------------------ */

async function refreshStatus() {
  const response = await sendRuntime({ type: 'STATUS' })
  if (response && response.connected) {
    state.connected = true
    state.expiresAt = response.expiresAt || null
    showConnected()
  } else {
    state.connected = false
    state.plan = null
    showConnectPanel(response && response.error ? response.error : null)
  }
}

function showConnectPanel(pairError) {
  el('connect-panel').classList.remove('hidden')
  el('connected-panel').classList.add('hidden')
  el('connection-chip').textContent = 'Not connected'
  el('connection-chip').classList.remove('chip-on')
  const error = el('pair-error')
  if (pairError) {
    error.textContent = pairError
    error.classList.remove('hidden')
  } else {
    error.classList.add('hidden')
  }
  restoreFocusForCode()
}

function restoreFocusForCode() {
  el('pair-code').focus()
}

function showConnected() {
  el('connect-panel').classList.add('hidden')
  el('connected-panel').classList.remove('hidden')
  el('connection-chip').textContent = 'Connected'
  el('connection-chip').classList.add('chip-on')
  el('status-line').textContent = ''
  el('results').classList.add('hidden')
  hideAdapterBanner()
  refreshExpiry()
}

function refreshExpiry() {
  if (!state.connected || !state.expiresAt) {
    el('expires-at').textContent = '—'
    return
  }
  const end = new Date(state.expiresAt).getTime()
  if (!Number.isFinite(end)) {
    el('expires-at').textContent = 'unknown'
    return
  }
  const seconds = Math.max(0, Math.round((end - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  el('expires-at').textContent = minutes + ':' + String(seconds % 60).padStart(2, '0')
  if (seconds === 0) {
    state.connected = false
    showConnectPanel('The agent session expired — pair again with a fresh code.')
  }
}

/* ------------------------------ pairing ------------------------------ */

async function onPair() {
  const input = el('pair-code')
  const code = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const error = el('pair-error')
  if (code.length !== 15) {
    error.textContent = 'Paste the 15-character code exactly as shown on the agent page (3 groups of 5).'
    error.classList.remove('hidden')
    return
  }
  error.classList.add('hidden')
  const button = el('pair-button')
  button.disabled = true
  button.textContent = 'Pairing…'
  const response = await sendRuntime({ type: 'PAIR', code })
  button.disabled = false
  button.textContent = 'Pair'
  if (!response || !response.ok) {
    error.textContent = (response && response.error) || 'Pairing failed.'
    error.classList.remove('hidden')
    return
  }
  input.value = ''
  state.connected = true
  state.expiresAt = response.expiresAt || null
  showConnected()
}

async function onShowPet() {
  const button = el('show-pet-button')
  button.disabled = true
  button.textContent = 'Opening…'
  const response = await sendRuntime({ type: 'SHOW_PET' })
  button.disabled = false
  button.textContent = 'Show floating assistant'
  if (!response || !response.ok) {
    el('status-line').textContent = (response && response.error) || 'Could not reach the page assistant.'
  }
}

async function onDisconnect() {
  await sendRuntime({ type: 'DISCONNECT' })
  state.connected = false
  state.plan = null
  state.page = null
  state.filledAt = null
  hideAdapterBanner()
  showConnectPanel(null)
}

/* ------------------------------ scan & plan ------------------------------ */

async function onScan() {
  const status = el('status-line')
  const scanButton = el('scan-button')
  scanButton.disabled = true
  scanButton.textContent = 'Inspecting…'
  status.textContent = ''
  el('results').classList.add('hidden')
  hideAdapterBanner()

  const response = await sendRuntime({ type: 'SCAN' })
  scanButton.disabled = false
  scanButton.textContent = 'Inspect this page'

  if (!response || !response.ok) {
    state.plan = null
    state.page = null
    status.textContent = (response && response.error) || 'Scan failed.'
    return
  }

  state.page = response.page || (response.plan && response.plan.page) || null
  state.filledAt = null
  el('cancel-button').textContent = 'Cancel'
  if (!response.plan) {
    state.plan = null
    renderPageNotice(state.page, response.note)
    return
  }
  state.plan = response.plan
  renderPlan()
}

function hideAdapterBanner() {
  const banner = el('adapter-banner')
  banner.textContent = ''
  banner.className = 'banner hidden'
}

function renderPageNotice(page, note) {
  const status = el('status-line')
  status.textContent = note || 'No fillable form fields found on this page.'
  if (!page || page.adapter === 'none' || page.adapter === 'generic') {
    hideAdapterBanner()
    return
  }
  const banner = el('adapter-banner')
  banner.textContent = ''
  banner.classList.remove('hidden')
  banner.className = 'banner ' + adapterBannerClass(page.adapterStatus)

  const title = document.createElement('p')
  title.className = 'banner-title'
  const label = page.adapterLabel || page.adapter
  const statusText = clearStatusLabel(page.adapterStatus)
  title.textContent = label + (statusText ? ' · ' + statusText : '') + ' — page: ' + pageKindLabel(page.kind)
  banner.appendChild(title)

  const body = document.createElement('p')
  body.textContent = note || adapterBannerBody(page.adapterStatus, page.kind)
  banner.appendChild(body)
}

function renderAdapterBanner(plan) {
  const banner = el('adapter-banner')
  banner.textContent = ''
  banner.classList.remove('banner-warn')
  banner.classList.remove('banner-error')
  if (!plan || plan.adapter === 'none' || plan.adapter === 'generic' || !plan.adapterLabel) {
    banner.classList.add('hidden')
    return
  }
  banner.classList.remove('hidden')
  banner.className = 'banner ' + adapterBannerClass(plan.adapterStatus)

  const title = document.createElement('p')
  title.className = 'banner-title'
  const statusText = clearStatusLabel(plan.adapterStatus)
  title.textContent = plan.adapterLabel + (statusText ? ' · ' + statusText : '')
  banner.appendChild(title)

  const body = document.createElement('p')
  body.textContent = adapterBannerBody(plan.adapterStatus, plan.page && plan.page.kind)
  banner.appendChild(body)

  if (plan.adapterNote) {
    const note = document.createElement('p')
    note.textContent = plan.adapterNote
    banner.appendChild(note)
  }
}

function renderPlan() {
  const plan = state.plan
  if (!plan) return
  renderAdapterBanner(plan)
  const items = el('plan-items')
  items.textContent = ''
  items.classList.remove('hidden')

  const summary = el('plan-summary')
  summary.textContent = ''
  summary.classList.remove('hidden')
  appendSummaryChip(summary, plan.counts.detected + ' detected', '')
  appendSummaryChip(summary, plan.counts.mapped + ' will fill', 's-mapped')
  if (plan.counts.ambiguous > 0) appendSummaryChip(summary, plan.counts.ambiguous + ' ambiguous', 's-ambiguous')
  appendSummaryChip(summary, plan.counts.manual + ' manual', '')
  appendSummaryChip(summary, plan.counts.unsafe + ' skipped (safety)', 's-unsafe')

  const note = el('plan-note')
  if (plan.aiNote) {
    note.textContent = plan.aiNote
    note.classList.remove('hidden')
  } else {
    note.classList.add('hidden')
  }

  const sorted = plan.items.slice().sort((a, b) => a.index - b.index)
  for (const item of sorted) {
    items.appendChild(buildPlanRow(item))
  }

  el('approve-actions').classList.remove('hidden')
  updateFillButton()
}

function appendSummaryChip(container, text, extraClass) {
  const chip = document.createElement('span')
  chip.textContent = text
  if (extraClass) chip.classList.add(extraClass)
  container.appendChild(chip)
}

function buildPlanRow(item) {
  const row = document.createElement('div')
  row.className = 'item'

  const badge = document.createElement('span')
  const badgeMeta = STATUS_BADGES[item.status] || STATUS_BADGES.unmapped
  badge.className = 'status ' + badgeMeta.cls
  badge.textContent = badgeMeta.text
  row.appendChild(badge)

  const main = document.createElement('div')
  main.className = 'item-main'

  const label = document.createElement('div')
  label.className = 'item-label'
  label.textContent = item.label && item.label.length > 0 ? item.label : '(no label detected)'
  const kindSpan = document.createElement('span')
  kindSpan.className = 'item-kind'
  kindSpan.textContent = item.kind + (item.required ? ' · required' : '')
  label.appendChild(kindSpan)
  main.appendChild(label)

  if (item.group) {
    const group = document.createElement('div')
    group.className = 'item-group'
    group.textContent = 'group: ' + item.group
    main.appendChild(group)
  }

  const mapping = document.createElement('div')
  mapping.className = 'item-mapping'
  if (item.status === 'mapped' && item.canonical) {
    const human = FILLABLE_FIELD_NAMES[item.canonical] || item.canonical
    mapping.textContent = '→ ' + human + (item.firedByAi ? ' (local model)' : '') + (item.needsReview ? ' — review before approving' : '')
  } else if (item.status === 'ambiguous') {
    mapping.textContent = '→ choose: ' + item.ambiguous.map(id => FILLABLE_FIELD_NAMES[id] || id).join(' / ')
  } else {
    mapping.textContent = item.reason
  }
  main.appendChild(mapping)
  row.appendChild(main)

  if (item.status === 'mapped') {
    const check = document.createElement('label')
    check.className = 'item-check'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.index = String(item.index)
    checkbox.checked = !item.needsReview
    checkbox.addEventListener('change', updateFillButton)
    check.appendChild(checkbox)
    const checkText = document.createElement('span')
    checkText.textContent = 'fill'
    check.appendChild(checkText)
    row.appendChild(check)
  }

  return row
}

function updateFillButton() {
  const count = approvedItems().length
  const button = el('fill-button')
  button.disabled = count === 0
  button.textContent = count === 0 ? 'Fill approved fields' : 'Fill ' + count + ' approved field' + (count === 1 ? '' : 's')
}

function approvedItems() {
  if (!state.plan || state.filledAt) return []
  const checked = new Set(
    Array.from(el('plan-items').querySelectorAll('input[type="checkbox"]:checked')).map(input => Number(input.dataset.index))
  )
  return state.plan.items.filter(item => item.status === 'mapped' && checked.has(item.index))
}

/* ------------------------------ fill & results ------------------------------ */

async function onFill() {
  const approved = approvedItems()
  if (approved.length === 0) return
  const button = el('fill-button')
  button.disabled = true
  button.textContent = 'Approving…'

  const approval = await sendRuntime({
    type: 'CREATE_APPROVAL',
    approved: approved.map(item => ({ index: item.index, canonical: item.canonical })),
  })
  if (!approval || !approval.ok || typeof approval.approvalRef !== 'string') {
    button.disabled = false
    updateFillButton()
    el('status-line').textContent = (approval && approval.error) || 'Could not create server-side approval.'
    return
  }

  button.textContent = 'Filling…'
  const response = await sendRuntime({
    type: 'FILL',
    approvalRef: approval.approvalRef,
    approved: approved.map(item => ({ index: item.index, canonical: item.canonical })),
  })

  const resultsBox = el('results')
  resultsBox.textContent = ''
  if (!response || !response.ok) {
    if (response && response.code === 'PAGE_CHANGED') {
      discardPlan(response.error, true)
      return
    }
    button.disabled = false
    updateFillButton()
    resultsBox.classList.remove('hidden')
    const line = document.createElement('p')
    line.className = 'r-item'
    line.textContent = (response && response.error) || 'Fill failed.'
    resultsBox.appendChild(line)
    return
  }

  state.filledAt = new Date().toISOString()
  button.disabled = true
  button.textContent = 'Done — nothing was submitted'
  resultsBox.classList.remove('hidden')

  const head = document.createElement('p')
  head.className = 'r-head'
  head.textContent = 'Filled ' + response.filled + ' of ' + response.results.length + ' selected fields. Nothing was submitted.'
  if (response.unverified > 0) {
    const warning = document.createElement('span')
    warning.className = 'r-fail'
    warning.textContent =
      ' ' + response.unverified + ' field' + (response.unverified === 1 ? '' : 's') + ' could not be verified — check ' +
      (response.unverified === 1 ? 'it' : 'them') + ' yourself.'
    head.appendChild(warning)
  }
  resultsBox.appendChild(head)

  const labelByIndex = new Map(state.plan ? state.plan.items.map(item => [item.index, item.label]) : [])
  const order = new Map(approved.map((item, position) => [item.index, position]))
  const sorted = response.results
    .slice()
    .filter(result => order.has(result.index))
    .sort((a, b) => order.get(a.index) - order.get(b.index))

  for (const result of sorted) {
    const line = document.createElement('p')
    line.className = 'r-item'
    const name = labelByIndex.get(result.index) || ('field #' + result.index)
    const done = result.status === 'filled'
    line.textContent = (done ? '✓ ' : '✗ ') + name + ' — '
    if (!done) {
      const reason = document.createElement('span')
      reason.className = 'r-fail'
      reason.textContent = RESULT_LINES[result.status] || result.status
      line.appendChild(reason)
    } else {
      line.appendChild(document.createTextNode(RESULT_LINES.filled))
    }
    resultsBox.appendChild(line)
  }

  const cancel = el('cancel-button')
  cancel.textContent = 'Close results'
}

function discardPlan(message, keepResults) {
  state.plan = null
  state.filledAt = null
  el('plan-items').classList.add('hidden')
  el('plan-summary').classList.add('hidden')
  el('plan-note').classList.add('hidden')
  el('approve-actions').classList.add('hidden')
  if (!keepResults) el('results').classList.add('hidden')
  el('cancel-button').textContent = 'Cancel'
  hideAdapterBanner()
  el('status-line').textContent =
    message || 'Cancelled — nothing was filled. Inspect again to rebuild a plan.'
  sendRuntime({ type: 'CLEAR_PLAN' })
}

function onCancel() {
  if (state.filledAt) {
    discardPlan('Plan discarded. Nothing more will be filled until you inspect again.')
    return
  }
  if (state.plan) {
    discardPlan('Cancelled — nothing was filled. Inspect again to rebuild a plan.')
  }
}
