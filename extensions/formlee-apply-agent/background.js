/**
 * Formlee Apply Agent V1 — MV3 service worker.
 *
 * Holds ONLY the short-lived, workspace-scoped agent session token in
 * chrome.storage.local (extension-private storage; page JavaScript can never
 * read it). The httpOnly Formlee workspace cookie never appears here: the
 * server issued the agent session during pairing, and every agent API call
 * carries the x-formlee-agent-session header. The server still accepts the
 * historical Rankora header for older installed extension builds.
 */

importScripts('shared/formlee-config.js', 'shared/agent-core.js', 'shared/extension-policy.js', 'credits.js')

const AgentCore = globalThis.AgentCore
if (
  !AgentCore ||
  globalThis.FormleeAgentCore !== AgentCore ||
  globalThis.RankoraAgentCore !== AgentCore ||
  typeof AgentCore.classifyUrl !== 'function' ||
  typeof AgentCore.isFillablePageKind !== 'function'
) {
  throw new Error('Formlee Apply Agent initialization failed: shared AgentCore is unavailable. Ensure shared/agent-core.js loads before background.js.')
}

const SESSION_HEADER = 'x-formlee-agent-session'

const STORAGE_KEYS = {
  token: 'agentToken',
  expiresAt: 'agentExpiresAt',
  planContext: 'agentPlanContext',
}
const TOKEN_PATTERN = /^[0-9a-f]{64}$/
const PLAN_CONTEXT_VERSION = 1

/* ------------------------------ storage ------------------------------ */

function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, result => resolve(result))
  })
}

function storageSet(items) {
  return new Promise(resolve => {
    chrome.storage.local.set(items, () => resolve())
  })
}

function storageRemove(keys) {
  return new Promise(resolve => {
    chrome.storage.local.remove(keys, () => resolve())
  })
}

function storageClearToken() {
  return storageRemove([STORAGE_KEYS.token, STORAGE_KEYS.expiresAt, STORAGE_KEYS.planContext])
}

async function clearContentSessionState() {
  try {
    const tabs = await new Promise(resolve => chrome.tabs.query({}, result => resolve(Array.isArray(result) ? result : [])))
    await Promise.all(tabs.filter(tab => typeof tab.id === 'number').map(tab => new Promise(resolve => {
      chrome.tabs.sendMessage(tab.id, { type: 'FORMLEE_CLEAR_PRIVATE_STATE' }, () => {
        // Most tabs have no Formlee content script; the clear signal contains
        // no student data and a missing receiver is expected.
        void chrome.runtime.lastError
        resolve()
      })
    })))
  } catch (error) {
    // Clear the extension-private credential and plan even if a tab disappears.
  }
}

async function clearLocalAgentSession() {
  await storageClearToken()
  await clearContentSessionState()
}

async function readPlanContext() {
  const stored = await storageGet([STORAGE_KEYS.planContext])
  const context = stored[STORAGE_KEYS.planContext]
  if (!context || typeof context !== 'object') return null
  if (context.version !== PLAN_CONTEXT_VERSION) return null
  if (typeof context.tabId !== 'number') return null
  if (typeof context.url !== 'string' || typeof context.fingerprint !== 'string') return null
  if (typeof context.createdAt !== 'number') return null
  if (!context.plan || !Array.isArray(context.plan.items)) return null
  return context
}

async function clearPlanContext() {
  await storageRemove([STORAGE_KEYS.planContext])
}

async function savePlanContext(context) {
  await storageSet({ [STORAGE_KEYS.planContext]: context })
}

async function storedSession() {
  const stored = await storageGet([STORAGE_KEYS.token, STORAGE_KEYS.expiresAt])
  const token = typeof stored[STORAGE_KEYS.token] === 'string' ? stored[STORAGE_KEYS.token] : ''
  if (!TOKEN_PATTERN.test(token)) return null
  const expiresAt = typeof stored[STORAGE_KEYS.expiresAt] === 'string' ? stored[STORAGE_KEYS.expiresAt] : ''
  if (FormleeExtensionPolicy.isSessionExpired(expiresAt)) {
    await clearLocalAgentSession()
    return null
  }
  return {
    token,
    expiresAt,
  }
}

/* ------------------------------ agent API ------------------------------ */

async function agentApi(path, options = {}) {
  const session = await storedSession()
  if (!session) {
    return { ok: false, status: 401, body: { error: 'Not paired yet — paste a pairing code first.', code: 'AGENT_SESSION_INVALID' } }
  }
  const baseUrl = await FormleeConfig.getBaseUrl()
  if (!baseUrl) {
    return { ok: false, status: 0, body: { error: FormleeConfig.getConfigurationError(), code: 'API_ORIGIN_UNCONFIGURED' } }
  }
  try {
    const response = await fetch(baseUrl + path, {
      ...options,
      headers: { ...(options.headers || {}), [SESSION_HEADER]: session.token },
    })
    const body = await response.json().catch(() => null)
    if (response.status === 401) await clearLocalAgentSession()
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: 'Cannot reach the Formlee server at ' + baseUrl + ' — is it running?', code: 'NETWORK' },
    }
  }
}

/* ------------------------------ pairing ------------------------------ */

async function pairWithCode(code) {
  try {
    if (await storedSession()) {
      return { ok: false, error: 'Disconnect the current Formlee workspace before pairing a different account.' }
    }
    const baseUrl = await FormleeConfig.getBaseUrl()
    if (!baseUrl) {
      return { ok: false, error: FormleeConfig.getConfigurationError() }
    }
    const response = await fetch(baseUrl + '/api/agent/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token) ||
        FormleeExtensionPolicy.isSessionExpired(String(body.expiresAt || ''))) {
      return { ok: false, error: (body && body.error) || ('Pairing failed (HTTP ' + response.status + ')') }
    }
    await clearLocalAgentSession()
    await storageSet({
      [STORAGE_KEYS.token]: body.token,
      [STORAGE_KEYS.expiresAt]: String(body.expiresAt || ''),
    })
    return { ok: true, expiresAt: String(body.expiresAt || '') }
  } catch (error) {
    return { ok: false, error: 'Cannot reach the Formlee server — is it running?' }
  }
}

/* ------------------------------ page plumbing ------------------------------ */

function sendToTab(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError
      if (error) {
        const noReceiver = /receiving end does not exist/i.test(error.message)
        resolve({ ok: false, error: noReceiver ? 'NO_CONTENT_SCRIPT' : error.message })
        return
      }
      resolve(response || { ok: false, error: 'Empty response from the page.' })
    })
  })
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || typeof tab.id !== 'number') return { ok: false, error: 'No active tab found.' }
  return { ok: true, tab }
}

/**
 * The extension-side gate. Each adapter is matched by EXACT https origin +
 * path prefix only; lookalike hosts and arbitrary pages are refused before
 * any script is injected.
 */
function gateTab(tab) {
  if (!tab || typeof tab.url !== 'string' || !tab.url) {
    return { ok: false, error: 'Chrome did not expose this tab URL — open a normal http(s) page and try again.' }
  }
  const classified = AgentCore.classifyUrl(tab.url)
  if (classified.adapter === 'none') {
    const adapterNames = AgentCore.ADAPTERS.map(adapter => adapter.name).join(', ')
    return {
      ok: false,
      error:
        'The Apply Agent only runs on Formlee demo pages and supported examination portals (' + adapterNames + ').'
    }
  }
  if (classified.fixture && !FormleeConfig.isDevelopmentBuild()) {
    return { ok: false, error: 'Local demonstration pages are disabled in the production extension.' }
  }
  return { ok: true, classified }
}

async function scanActiveTab() {
  const active = await activeTab()
  if (!active.ok) return active

  const gate = gateTab(active.tab)
  if (!gate.ok) return gate

  let response = await sendToTab(active.tab.id, { type: 'FORMLEE_SCAN' })
  if (!response.ok && response.error === 'NO_CONTENT_SCRIPT') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: active.tab.id },
        files: ['shared/agent-core.js', 'content/agent.js'],
      })
    } catch (error) {
      return {
        ok: false,
        error: 'Chrome refused script injection on this page. The agent only runs on normal http(s) web pages — chrome:// pages, the Chrome Web Store and PDF viewers are off limits.',
      }
    }
    response = await sendToTab(active.tab.id, { type: 'FORMLEE_SCAN' })
  }
  if (!response.ok) return response

  const page = response.page
  if (!page || typeof page !== 'object') {
    return { ok: false, error: 'The page could not report its identity — reload it and try again.' }
  }
  if (page.adapter !== gate.classified.adapter || page.url !== gate.classified.sanitizedUrl) {
    return {
      ok: false,
      error: 'The page identity did not match this tab — nothing was inspected. Reload the page and try again.',
    }
  }
  return { ok: true, tab: active.tab, page, fields: Array.isArray(response.fields) ? response.fields : [] }
}

/** Scan the page, then turn the detected descriptors into a mapped, redacted
 * fill plan using the server. JEE Main pages use the strict documentation
 * adapter; the generic demo keeps its deterministic + optional local-model
 * pipeline. */
async function scanAndMap() {
  await clearPlanContext()
  const scanTool = await executeTool('scan_supported_application_page', {})
  const scanResult = scanTool.body && scanTool.body.result
  if (!scanTool.ok || !scanResult || !scanResult.browserAction) {
    return {
      ok: false,
      error: (scanResult && scanResult.error) || (scanTool.body && scanTool.body.error) || 'The browser scan could not be authorized.',
    }
  }
  const scan = await dispatchBrowserAction(scanResult.browserAction)
  if (!scan.ok) return scan

  const page = scan.page
  if (!AgentCore.isFillablePageKind(page.kind)) {
    return { ok: true, plan: null, page, note: AgentCore.pageNotice(page.adapter, page.kind) }
  }

  const fields = Array.isArray(scan.fields) ? scan.fields : []
  if (fields.length === 0) {
    return { ok: true, plan: null, page, note: 'No fillable form fields were found on this page.' }
  }

  const mapResponse = await executeTool('map_application_fields', {
      fields,
      page: { url: page.url, kind: page.kind, fingerprint: page.fingerprint },
  })
  if (!mapResponse.ok) {
    const failure = (mapResponse.body && mapResponse.body.result) || mapResponse.body || {}
    return {
      ok: false,
      error: failure.error || ('Mapping failed (HTTP ' + mapResponse.status + ')'),
    }
  }

  const plan = mapResponse.body && mapResponse.body.result && mapResponse.body.result.data && mapResponse.body.result.data.plan || null
  if (!plan) return { ok: true, plan: null, page, note: 'No fill plan was produced for this page.' }
  if (plan.page && plan.page.supported === false) {
    return { ok: true, plan: null, page, note: plan.adapterNote || AgentCore.pageNotice(page.kind) }
  }

  await savePlanContext({
    version: PLAN_CONTEXT_VERSION,
    tabId: scan.tab.id,
    url: page.url,
    adapter: page.adapter,
    kind: page.kind,
    fingerprint: page.fingerprint,
    createdAt: Date.now(),
    plan,
  })

  return { ok: true, plan, page, tab: scan.tab }
}

/* ------------------------------ filling ------------------------------ */

function approvedAgainstPlan(approved, plan) {
  if (!Array.isArray(approved) || approved.length === 0) {
    return { ok: false, error: 'Approve at least one mapped field first.' }
  }
  const plannedByIndex = new Map(
    plan.items
      .filter(item => item && item.status === 'mapped' && typeof item.canonical === 'string')
      .map(item => [item.index, item])
  )
  const seen = new Set()
  const clean = []
  for (const item of approved) {
    if (!item || typeof item.index !== 'number' || typeof item.canonical !== 'string') {
      return { ok: false, error: 'The approval list is malformed — inspect the page again.' }
    }
    const planned = plannedByIndex.get(item.index)
    if (!planned || planned.canonical !== item.canonical) {
      return { ok: false, error: 'The approval list does not match the inspected plan — inspect the page again.' }
    }
    if (seen.has(item.index)) continue
    seen.add(item.index)
    clean.push({ index: item.index, canonical: item.canonical })
  }
  return clean.length > 0 ? { ok: true, approved: clean } : { ok: false, error: 'No approved mapped fields remain.' }
}

async function fetchAgentValues(fields) {
  const res = await executeTool('generate_field_preview', { fields: Array.isArray(fields) ? fields : [] })
  if (!res.ok) {
    const failure = (res.body && res.body.result) || res.body || {}
    return { ok: false, error: failure.error || ('Could not fetch values (HTTP ' + res.status + ')') }
  }
  const data = res.body && res.body.result && res.body.result.data || {}
  return { ok: true, values: data.values || {}, missing: data.missing || [] }
}

async function hashValueFingerprint(value) {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Secure readback hashing is unavailable.')
  }
  const text = String(value == null ? '' : value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchProfileStatus() {
  const res = await executeTool('get_student_profile_summary', {})
  if (!res.ok) {
    const failure = (res.body && res.body.result) || res.body || {}
    return { ok: false, error: failure.error || ('Could not fetch profile status (HTTP ' + res.status + ')') }
  }
  return { ok: true, evaluation: (res.body && res.body.result && res.body.result.data) || null }
}

async function fetchReadinessSummary() {
  const res = await executeTool('get_application_readiness', {})
  if (!res.ok) {
    const failure = (res.body && res.body.result) || res.body || {}
    return { ok: false, error: failure.error || ('Could not fetch readiness summary (HTTP ' + res.status + ')') }
  }
  const data = res.body && res.body.result && res.body.result.data || {}
  return { ok: true, applications: data.applications || [] }
}

async function fetchDocumentsList() {
  const res = await executeTool('list_uploaded_documents', {})
  if (!res.ok) {
    const failure = (res.body && res.body.result) || res.body || {}
    return { ok: false, error: failure.error || ('Could not fetch documents (HTTP ' + res.status + ')') }
  }
  const data = res.body && res.body.result && res.body.result.data || {}
  return { ok: true, documents: data.documents || [] }
}

async function openFormleeTab(path) {
  try {
    const baseUrl = await FormleeConfig.getBaseUrl()
    if (!baseUrl) return { ok: false, error: FormleeConfig.getConfigurationError() }
    await chrome.tabs.create({ url: baseUrl + path })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || 'Could not open the tab.' }
  }
}

async function executeTool(tool, args, studentAction) {
  return agentApi('/api/agent/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args: args || {}, studentAction: studentAction === true }),
  })
}

async function createTask(objective, applicationId) {
  return agentApi('/api/agent/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective, applicationId }),
  })
}

async function planTask(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/plan', { method: 'POST' })
}

async function runTask(taskRef, resume) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume: !!resume }),
  })
}

async function pauseTask(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/pause', { method: 'POST' })
}

async function cancelTask(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/cancel', { method: 'POST' })
}

async function getTask(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef))
}

async function listTasks(status) {
  const query = status ? '?status=' + encodeURIComponent(status) : ''
  return agentApi('/api/agent/tasks' + query)
}

async function getTaskSteps(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/steps')
}

async function getTaskEvents(taskRef) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/events')
}

async function submitBrowserResult(taskRef, actionId, result) {
  return agentApi('/api/agent/tasks/' + encodeURIComponent(taskRef) + '/browser-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId, result }),
  })
}

async function createServerApproval(approved) {
  const context = await readPlanContext()
  if (!context) {
    return { ok: false, error: 'No fresh inspected plan — inspect the page again.' }
  }
  const validation = approvedAgainstPlan(approved, context.plan)
  if (!validation.ok) return validation

  const canonicals = [...new Set(validation.approved.map(item => item.canonical))]

  const proposedMapping = validation.approved.map(item => {
    const planned = context.plan.items.find(planItem => planItem.index === item.index)
    return {
      index: item.index,
      canonical: item.canonical,
      label: planned && planned.label ? planned.label : '',
    }
  })
  const origin = (() => {
    try {
      return new URL(context.url).origin
    } catch (error) {
      return context.url
    }
  })()

  const approvalResponse = await executeTool('request_student_approval', {
    adapterId: context.adapter,
    pageUrl: context.url,
    pageFingerprint: context.fingerprint,
    origin,
    tabRef: String(context.tabId),
    proposedMapping,
    approvedFieldIds: canonicals,
  }, true)
  if (!approvalResponse.ok) {
    const failure = (approvalResponse.body && approvalResponse.body.result) || approvalResponse.body || {}
    return {
      ok: false,
      error: failure.error || ('Approval request failed (HTTP ' + approvalResponse.status + ')'),
      code: failure.code,
    }
  }
  const approvalRef = approvalResponse.body && approvalResponse.body.result && approvalResponse.body.result.data && approvalResponse.body.result.data.approvalRef
  if (typeof approvalRef !== 'string') {
    return { ok: false, error: 'Server did not return an approval reference.', code: 'APPROVAL_CREATE_FAILED' }
  }
  return { ok: true, approvalRef }
}

async function fillActiveTab(approved, approvalRef) {
  if (!approvalRef || typeof approvalRef !== 'string') {
    return { ok: false, error: 'Approval reference is required — approve the fields in the side panel before filling.', code: 'APPROVAL_REQUIRED' }
  }

  const context = await readPlanContext()
  if (!context) {
    return { ok: false, error: 'No fresh inspected plan — press “Inspect this page” again before filling.' }
  }
  if (!AgentCore.isPlanFresh(context, Date.now())) {
    await clearPlanContext()
    return { ok: false, error: 'The inspected plan expired — inspect the page again.' }
  }

  const active = await activeTab()
  if (!active.ok) return active
  if (active.tab.id !== context.tabId) {
    await clearPlanContext()
    return { ok: false, error: 'The inspected tab is not active — return to that tab and inspect again.' }
  }

  const gate = gateTab(active.tab)
  if (!gate.ok) {
    await clearPlanContext()
    return gate
  }
  if (gate.classified.sanitizedUrl !== context.url || gate.classified.adapter !== context.adapter) {
    await clearPlanContext()
    return { ok: false, error: 'The tab navigated since the scan — inspect the page again.' }
  }

  const validation = approvedAgainstPlan(approved, context.plan)
  if (!validation.ok) return validation

  const pageResponse = await sendToTab(active.tab.id, { type: 'FORMLEE_PAGE' })
  if (!pageResponse.ok || !pageResponse.page) {
    return { ok: false, error: pageResponse.error || 'The page could not be re-checked.', code: 'PAGE_CHECK_FAILED' }
  }
  if (
    pageResponse.page.adapter !== context.adapter ||
    pageResponse.page.url !== context.url ||
    pageResponse.page.fingerprint !== context.fingerprint
  ) {
    await clearPlanContext()
    return { ok: false, code: 'PAGE_CHANGED', error: 'The page changed since the scan — inspect and review it again.' }
  }

  // The Tool Registry verifies the durable approval and reserves a credit only
  // after this student-controlled review action.
  const execution = await executeTool('execute_approved_field_fills', {
    approvalRef,
    approved: validation.approved.map(item => ({ index: item.index, canonical: item.canonical })),
  }, true)
  const executionResult = execution.body && execution.body.result || execution.body || {}
  if (!execution.ok || executionResult.ok !== true || !executionResult.browserAction) {
    if (execution.status === 0 || execution.status >= 500) {
      const recovered = await agentApi('/api/billing/reserve/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', approvalRef }),
      })
      if (recovered.ok && recovered.body && recovered.body.reservation && typeof recovered.body.reservation.id === 'string') {
        return runFillFromAction(active.tab, {
          approvalRef,
          reservationId: recovered.body.reservation.id,
          approved: validation.approved,
        })
      }
    }
    return {
      ok: false,
      error: executionResult.error || (execution.body && execution.body.error) || 'The approved fill could not be authorized.',
      code: executionResult.code,
    }
  }
  const fillPayload = executionResult.browserAction.payload
  if (fillPayload && typeof fillPayload.reservationId === 'string') {
    const stored = await Credits.trackReservation(fillPayload.reservationId, approvalRef)
    if (!stored.ok) {
      return { ok: false, error: stored.error, code: 'RESERVATION_STORAGE_FAILED', recoveryRequired: true }
    }
  }
  return runFillFromAction(active.tab, fillPayload)
}
/* ------------------------------ browser-action dispatch ------------------------------ */

const ALLOWED_BROWSER_ACTIONS = new Set(['GET_TAB_CONTEXT', 'SCAN_PAGE', 'VERIFY', 'FILL'])

async function dispatchBrowserAction(action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return { ok: false, error: 'Invalid browser action.', code: 'INVALID_ACTION' }
  }
  if (!ALLOWED_BROWSER_ACTIONS.has(action.type)) {
    return { ok: false, error: 'Unsupported browser action type: ' + action.type, code: 'UNSUPPORTED_ACTION' }
  }

  const session = await storedSession()
  if (!session) {
    return { ok: false, error: 'Not paired.', code: 'AGENT_SESSION_INVALID' }
  }

  const active = await activeTab()
  if (!active.ok) return active

  const gate = gateTab(active.tab)
  if (!gate.ok) return gate

  switch (action.type) {
    case 'GET_TAB_CONTEXT':
      return getTabContext(active.tab, gate.classified)
    case 'SCAN_PAGE':
      return scanActiveTab()
    case 'VERIFY':
      return runVerifyOnTab(active.tab, action.payload)
    case 'FILL':
      return runFillFromAction(active.tab, action.payload)
    default:
      return { ok: false, error: 'Unsupported action.', code: 'UNSUPPORTED_ACTION' }
  }
}

function getTabContext(tab, classified) {
  return {
    ok: true,
    page: {
      url: classified.sanitizedUrl,
      title: tab.title || '',
      adapter: classified.adapter,
      official: classified.official,
      fixture: classified.fixture,
      kind: classified.kind || 'unknown',
      // A real fingerprint requires a scan; this action only reports identity.
      fingerprint: '',
    },
  }
}

async function runVerifyOnTab(tab, payload) {
  if (!payload || typeof payload.approvalRef !== 'string') {
    return { ok: false, error: 'approvalRef is required.', code: 'INVALID_ACTION' }
  }

  const context = await readPlanContext()
  if (context && tab.id !== context.tabId) {
    return { ok: false, error: 'The active tab does not match the approved tab.', code: 'TAB_MISMATCH' }
  }

  let approved = []
  if (Array.isArray(payload.approved) && payload.approved.length > 0) {
    approved = payload.approved
  } else if (context && context.plan && Array.isArray(context.plan.items)) {
    // Fall back to the last plan's mapped fields if the payload omits them.
    approved = context.plan.items
      .filter(item => item && item.status === 'mapped' && typeof item.canonical === 'string')
      .map(item => ({ index: item.index, canonical: item.canonical }))
  }
  if (approved.length === 0) {
    return { ok: false, error: 'No approved fields to verify.', code: 'INVALID_ACTION' }
  }

  const verifyResponse = await sendToTab(tab.id, { type: 'FORMLEE_VERIFY', approved })
  if (!verifyResponse.ok) {
    return { ok: false, error: verifyResponse.error || 'Verification failed.', code: 'VERIFY_FAILED' }
  }
  return { ok: true, approvalRef: payload.approvalRef, results: verifyResponse.results, fingerprint: verifyResponse.fingerprint }
}

async function runFillFromAction(tab, payload) {
  if (!payload || typeof payload.approvalRef !== 'string' || typeof payload.reservationId !== 'string') {
    return { ok: false, error: 'approvalRef and reservationId are required.', code: 'INVALID_ACTION' }
  }
  const storedReservation = await Credits.trackReservation(payload.reservationId, payload.approvalRef)
  if (!storedReservation.ok) {
    return { ok: false, error: storedReservation.error, code: 'RESERVATION_STORAGE_FAILED', recoveryRequired: true }
  }
  const approved = Array.isArray(payload.approved) ? payload.approved : []
  if (approved.length === 0) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'No approved fields to fill.', code: 'INVALID_ACTION' }
  }

  const context = await readPlanContext()
  if (!context || !AgentCore.isPlanFresh(context, Date.now())) {
    await clearPlanContext()
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'The inspected plan is missing or expired. Scan and review the page again.', code: 'STALE_PLAN' }
  }
  if (typeof tab.id !== 'number' || tab.id !== context.tabId) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'The active tab does not match the reviewed application.', code: 'TAB_MISMATCH' }
  }

  const gate = gateTab(tab)
  if (!gate.ok) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return gate
  }
  if (gate.classified.adapter !== context.adapter || gate.classified.sanitizedUrl !== context.url) {
    await clearPlanContext()
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'The tab navigated after review. Scan and review the new page again.', code: 'PAGE_CHANGED' }
  }

  const validation = approvedAgainstPlan(approved, context.plan)
  if (!validation.ok) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return validation
  }

  const pageResponse = await sendToTab(tab.id, { type: 'FORMLEE_PAGE' })
  if (!pageResponse.ok || !pageResponse.page) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: pageResponse.error || 'The page could not be re-checked.', code: 'PAGE_CHECK_FAILED' }
  }
  const current = pageResponse.page
  if (
    current.adapter !== context.adapter ||
    current.url !== context.url ||
    current.fingerprint !== context.fingerprint ||
    !AgentCore.isFillablePageKind(current.kind)
  ) {
    await clearPlanContext()
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'The page changed after review. Scan the current page again.', code: 'PAGE_CHANGED' }
  }

  const approvalCheck = await agentApi('/api/agent/approvals/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      approvalRef: payload.approvalRef,
      adapterId: current.adapter,
      pageUrl: current.url,
      pageFingerprint: current.fingerprint,
      approved: validation.approved.map(item => ({ index: item.index, canonical: item.canonical })),
    }),
  })
  if (!approvalCheck.ok) {
    if (approvalCheck.body && approvalCheck.body.code === 'PAGE_CHANGED') await clearPlanContext()
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return {
      ok: false,
      error: (approvalCheck.body && approvalCheck.body.error) || 'The server rejected the approval before the fill.',
      code: (approvalCheck.body && approvalCheck.body.code) || 'APPROVAL_INVALID',
    }
  }

  const canonicals = [...new Set(validation.approved.map(item => item.canonical))]
  const valuesResponse = await fetchAgentValues(canonicals)
  if (!valuesResponse.ok) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: valuesResponse.error || 'Could not retrieve the approved values.', code: 'VALUES_UNAVAILABLE' }
  }

  const fills = []
  const noValue = []
  for (const item of validation.approved) {
    if (Object.prototype.hasOwnProperty.call(valuesResponse.values, item.canonical)) {
      fills.push({ index: item.index, canonical: item.canonical, value: valuesResponse.values[item.canonical] })
    } else {
      noValue.push({ index: item.index, canonical: item.canonical, status: 'no-saved-value' })
    }
  }
  if (fills.length === 0) {
    await clearPlanContext()
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: 'No saved values were available for the approved fields.', code: 'NO_VALUES' }
  }

  const fillResponse = await sendToTab(tab.id, {
    type: 'FORMLEE_FILL',
    fills,
    expectedFingerprint: context.fingerprint,
  })
  await clearPlanContext()
  if (!fillResponse.ok) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return { ok: false, error: fillResponse.error || 'The page could not be filled.', code: 'FILL_FAILED' }
  }

  // Re-read the page after writes. The first response checks setter results;
  // this second pass confirms the controls still expose the approved values.
  const readbackResponse = await sendToTab(tab.id, {
    type: 'FORMLEE_VERIFY',
    approved: validation.approved,
  })
  const readbackPageChanged = typeof readbackResponse.fingerprint === 'string' &&
    readbackResponse.fingerprint !== current.fingerprint
  if (
    !readbackResponse.ok ||
    !Array.isArray(readbackResponse.results) ||
    readbackPageChanged ||
    typeof readbackResponse.fingerprint !== 'string'
  ) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return {
      ok: false,
      error: 'The browser wrote fields, but readback verification failed. Do not repeat the fill; inspect the current page and confirm the values.',
      code: readbackPageChanged ? 'PAGE_CHANGED' : 'FIELD_VERIFICATION_FAILED',
    }
  }

  const fillByIndex = new Map(
    (Array.isArray(fillResponse.results) ? fillResponse.results : [])
      .filter(item => item && typeof item.index === 'number')
      .map(item => [item.index, item.status])
  )
  const fillValueByIndex = new Map(
    (Array.isArray(fillResponse.results) ? fillResponse.results : [])
      .filter(item => item && typeof item.index === 'number' && Object.prototype.hasOwnProperty.call(item, 'value'))
      .map(item => [item.index, item.value])
  )
  const readbackByIndex = new Map(
    readbackResponse.results
      .filter(item => item && typeof item.index === 'number')
      .map(item => [item.index, item])
  )
  const noValueByIndex = new Map(noValue.map(item => [item.index, item.status]))
  const results = await Promise.all(validation.approved.map(async item => {
    const fillStatus = fillByIndex.get(item.index) || noValueByIndex.get(item.index) || 'stale'
    const readback = readbackByIndex.get(item.index)
    const readbackStatus = readback && readback.status || 'stale'
    const fillValue = fillValueByIndex.get(item.index)
    const sameValue = fillValue === true
      ? readback && readback.value === true
      : typeof fillValue === 'string' && readback && readback.value === fillValue
    const result = {
      index: item.index,
      canonical: item.canonical,
      status: fillStatus !== 'filled'
        ? fillStatus
        : readbackStatus === 'filled' && sameValue
          ? 'filled'
          : readbackStatus === 'filled' ? 'unverified' : readbackStatus,
    }
    if (result.status === 'filled') result.valueHash = await hashValueFingerprint(readback.value)
    return result
  }))
  const verificationResponse = await executeTool('verify_filled_fields', {
    approvalRef: payload.approvalRef,
    adapterId: current.adapter,
    pageUrl: current.url,
    pageFingerprint: current.fingerprint,
    results,
  }, true)
  const verification = verificationResponse.body && verificationResponse.body.result || verificationResponse.body || {}
  if (!verificationResponse.ok || verification.ok !== true || !verification.data) {
    await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })
    return {
      ok: false,
      error: 'The browser wrote fields, but the server could not record readback verification. Do not repeat the fill; scan the page and confirm the current values.',
      code: 'FIELD_VERIFICATION_FAILED',
      results,
    }
  }

  const verifiedCount = Number(verification.data.verifiedCount || 0)
  const creditResult = verifiedCount > 0
    ? await Credits.confirmConsumption({ reservationId: payload.reservationId, approvalRef: payload.approvalRef, pageFingerprint: current.fingerprint })
    : await Credits.releaseCredit({ reservationId: payload.reservationId, approvalRef: payload.approvalRef })

  return {
    ok: true,
    approvalRef: payload.approvalRef,
    filled: verifiedCount,
    unverified: Number(verification.data.unverifiedCount || 0),
    results,
    creditFinalizationPending: creditResult.pending === true,
    creditFinalizationError: creditResult.ok ? undefined : creditResult.error,
  }
}
/* ------------------------------ navigation invalidation ------------------------------ */

async function invalidatePlanForTab(tabId) {
  const context = await readPlanContext()
  if (context && context.tabId === tabId) await clearPlanContext()
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo) return
  if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
    invalidatePlanForTab(tabId)
  }
})

chrome.tabs.onRemoved.addListener(tabId => {
  invalidatePlanForTab(tabId)
})

/* ------------------------------ message router ------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!FormleeExtensionPolicy.isAllowedMessageSender(
    _sender,
    chrome.runtime.id,
    message,
    AgentCore.classifyUrl,
    FormleeConfig.isDevelopmentBuild()
  )) {
    sendResponse({ ok: false, error: 'Message sender is not an allowed Formlee extension context.' })
    return false
  }
  // Retry only the server-side finalization of a previously completed fill.
  // This never replays browser writes.
  Credits.flushPendingOperations().catch(() => {})
  handleAgentMessage(message).then(sendResponse)
  return true
})

chrome.runtime.onStartup.addListener(() => {
  Credits.flushPendingOperations().catch(() => {})
})

chrome.runtime.onInstalled.addListener(() => {
  Credits.flushPendingOperations().catch(() => {})
})

async function handleAgentMessage(message) {
  if (!message || typeof message !== 'object') return { ok: false, error: 'Unknown message.' }
  switch (message.type) {
    case 'PAIR':
      return pairWithCode(String(message.code || ''))
    case 'STATUS': {
      const session = await storedSession()
      if (!session) return { ok: true, connected: false }
      const probe = await agentApi('/api/agent/session')
      return {
        ok: true,
        connected: probe.ok === true,
        expiresAt: probe.ok === true ? session.expiresAt : null,
        error: probe.ok === true ? null : ((probe.body && probe.body.error) || 'Session invalid.'),
      }
    }
    case 'SCAN':
      return scanAndMap()
    case 'CREATE_APPROVAL':
      return createServerApproval(Array.isArray(message.approved) ? message.approved : [])
    case 'FILL':
      return fillActiveTab(
        Array.isArray(message.approved) ? message.approved : [],
        typeof message.approvalRef === 'string' ? message.approvalRef : null
      )
    case 'LIST_CREDIT_RESERVATIONS':
      return Credits.listRecoverableReservations()
    case 'RELEASE_CREDIT_RESERVATION':
      return Credits.releaseRecoveredReservation(String(message.reservationId || ''))
    case 'RUN_BROWSER_ACTION':
      return dispatchBrowserAction(message.action)
    case 'CHAT':
      return agentApi('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: message.messages || [], maxIterations: message.maxIterations }),
      })
    case 'VALUES':
      return fetchAgentValues(message.fields)
    case 'PROFILE_STATUS':
      return fetchProfileStatus()
    case 'READINESS_SUMMARY':
      return fetchReadinessSummary()
    case 'DOCUMENTS_LIST':
      return fetchDocumentsList()
    case 'OPEN_PROFILE':
      return openFormleeTab('/apply/profile')
    case 'OPEN_HUB':
      return openFormleeTab('/apply/applications')
    case 'OPEN_APPLICATION': {
      const applicationId = String(message.applicationId || '')
      if (!applicationId) return { ok: false, error: 'Application id is required.' }
      return openFormleeTab('/apply/applications/' + applicationId)
    }
    case 'SHOW_PET': {
      const active = await activeTab()
      if (!active.ok) return active
      const response = await sendToTab(active.tab.id, { type: 'FORMLEE_SHOW_PET' })
      return response || { ok: true }
    }
    case 'CLEAR_PLAN':
      await clearPlanContext()
      return { ok: true }
    case 'CREATE_TASK':
      return createTask(String(message.objective || ''), message.applicationId ? String(message.applicationId) : undefined)
    case 'PLAN_TASK':
      return planTask(String(message.taskRef || ''))
    case 'RUN_TASK':
      return runTask(String(message.taskRef || ''), !!message.resume)
    case 'PAUSE_TASK':
      return pauseTask(String(message.taskRef || ''))
    case 'CANCEL_TASK':
      return cancelTask(String(message.taskRef || ''))
    case 'GET_TASK':
      return getTask(String(message.taskRef || ''))
    case 'LIST_TASKS':
      return listTasks(message.status ? String(message.status) : undefined)
    case 'GET_TASK_STEPS':
      return getTaskSteps(String(message.taskRef || ''))
    case 'GET_TASK_EVENTS':
      return getTaskEvents(String(message.taskRef || ''))
    case 'SUBMIT_TASK_BROWSER_RESULT':
      return submitBrowserResult(
        String(message.taskRef || ''),
        String(message.actionId || ''),
        message.result || { ok: false, error: 'No result provided.' }
      )
    case 'GET_PLAN_CONTEXT': {
      const context = await readPlanContext()
      if (!context) return { ok: false, error: 'No saved plan to resume.' }
      return { ok: true, plan: context.plan, tabId: context.tabId, page: { url: context.url, adapter: context.adapter, kind: context.kind } }
    }
    case 'DISCONNECT': {
      const session = await storedSession()
      let serverRevoked = false
      if (session) {
        const response = await agentApi('/api/agent/session', { method: 'POST' })
        serverRevoked = response.ok === true
      }
      await clearLocalAgentSession()
      return { ok: true, serverRevoked }
    }
    default:
      return { ok: false, error: 'Unknown message type.' }
  }
}

/* ------------------------------ side panel ------------------------------ */

/**
 * The Side Panel is the primary interface. On Chrome versions without the
 * Side Panel API (the panel API landed in Chrome 114), fall back to the
 * classic popup so the action button always does something useful.
 *
 * There is deliberately no chrome.action.onClicked listener here:
 * openPanelOnActionClick handles the click natively, and adding a second
 * listener would fight with it.
 */
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => {
      console.warn('[Formlee] Could not enable open-on-action-click:', error && error.message)
      chrome.action.setPopup({ popup: 'popup.html' })
    })
} else {
  // Older Chrome: keep the previous popup experience.
  chrome.action.setPopup({ popup: 'popup.html' })
}
