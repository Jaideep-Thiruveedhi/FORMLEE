/**
 * Formlee Chrome Side Panel controller.
 *
 * The side panel is the primary workspace when a student uses a supported
 * examination portal. It reuses the existing service-worker agent APIs and
 * content-script scan/fill machinery; it does not implement a second agent.
 *
 * Page-derived strings (labels, reasons, adapter notes) are always escaped
 * or written through textContent — never trusted HTML.
 */

;(function () {
  'use strict'

  const AgentUI = typeof FormleeAgentUI !== 'undefined' ? FormleeAgentUI : null
  const PetCore = typeof FormleePetCore !== 'undefined' ? FormleePetCore : null

  // When the side panel is open it is the primary Pet surface: the floating
  // pet suppresses itself (see content/pet.js) until this flag flips back.
  const PET_SURFACE_KEY = 'formleePetSurface'
  const SESSION_HEADER_REMINDER = 'Sessions expire after 15 minutes — pair again with a fresh code.'

  const state = {
    connected: false,
    sessionExpiresAt: null,
    page: null,
    plan: null,
    planTabId: null,
    lastScanPage: null,
    scanning: false,
    filling: false,
    values: {},
    missing: [],
    readiness: null,
    petState: 'idle',
    petMessage: 'Hello — I’m Formlee. Open a supported exam page and I’ll help you fill it safely.',
    activity: [],
    chatApiMessages: [],
    chatThinking: false,
    pendingBrowserAction: null,
    pendingToolCallId: null,
    task: null,
    taskRef: null,
    taskPolling: null,
  }

  const els = {
    connectionChip: document.getElementById('connection-chip'),
    connectionDot: document.getElementById('connection-dot'),
    connectionLabel: document.getElementById('connection-label'),
    connectSection: document.getElementById('connect-section'),
    connectChip: document.getElementById('connect-chip'),
    pairCode: document.getElementById('pair-code'),
    pairBtn: document.getElementById('pair-btn'),
    pairError: document.getElementById('pair-error'),
    petAvatar: document.getElementById('pet-avatar'),
    petMessage: document.getElementById('pet-message'),
    petState: document.getElementById('pet-state'),
    adapterChip: document.getElementById('adapter-chip'),
    adapterBanner: document.getElementById('adapter-banner'),
    currentDomain: document.getElementById('current-domain'),
    pageKind: document.getElementById('page-kind'),
    readinessProgress: document.getElementById('readiness-progress'),
    readinessBar: document.getElementById('readiness-bar'),
    readinessLabel: document.getElementById('readiness-label'),
    scanBtn: document.getElementById('scan-btn'),
    fillBtn: document.getElementById('fill-btn'),
    clearBtn: document.getElementById('clear-btn'),
    planEmpty: document.getElementById('plan-empty'),
    planContainer: document.getElementById('plan-container'),
    planSummary: document.getElementById('plan-summary'),
    planList: document.getElementById('plan-list'),
    planSafety: document.getElementById('plan-safety'),
    resultsContainer: document.getElementById('results-container'),
    resultsList: document.getElementById('results-list'),
    missingSection: document.getElementById('missing-section'),
    missingList: document.getElementById('missing-list'),
    missingFixBtn: document.getElementById('missing-fix-btn'),
    readinessContainer: document.getElementById('readiness-container'),
    refreshReadinessBtn: document.getElementById('refresh-readiness-btn'),
    activityList: document.getElementById('activity-list'),
    clearActivityBtn: document.getElementById('clear-activity-btn'),
    openProfileLink: document.getElementById('open-profile-link'),
    openHubLink: document.getElementById('open-hub-link'),
    openAgentLink: document.getElementById('open-agent-link'),
    openDemoLink: document.getElementById('open-demo-link'),
    disconnectBtn: document.getElementById('disconnect-btn'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    chatSend: document.getElementById('chat-send'),
    chatActions: document.getElementById('chat-actions'),
    taskSection: document.getElementById('task-section'),
    taskStatusChip: document.getElementById('task-status-chip'),
    taskObjectiveInput: document.getElementById('task-objective'),
    taskCreateBtn: document.getElementById('task-create-btn'),
    taskCreateRow: document.getElementById('task-create-row'),
    taskDetail: document.getElementById('task-detail'),
    taskObjectiveDisplay: document.getElementById('task-objective-display'),
    taskProgress: document.getElementById('task-progress'),
    taskProgressBar: document.getElementById('task-progress-bar'),
    taskProgressLabel: document.getElementById('task-progress-label'),
    taskMessage: document.getElementById('task-message'),
    taskSteps: document.getElementById('task-steps'),
    taskRunBtn: document.getElementById('task-run-btn'),
    taskPauseBtn: document.getElementById('task-pause-btn'),
    taskResumeBtn: document.getElementById('task-resume-btn'),
    taskCancelBtn: document.getElementById('task-cancel-btn'),
    taskPending: document.getElementById('task-pending'),
    taskPendingBtn: document.getElementById('task-pending-btn'),
  }

  /* ----------------------------- chrome helpers ----------------------------- */

  function sendRuntime(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError
        if (error) {
          resolve({ ok: false, error: error.message })
          return
        }
        resolve(response || { ok: false, error: 'Empty response from extension.' })
      })
    })
  }

  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  async function goToFormlee(path) {
    // The panel never calls Formlee APIs itself; opening tabs is all it does.
    const base = typeof FormleeConfig !== 'undefined' ? await FormleeConfig.getBaseUrl() : null
    if (!base) {
      setPetState('error', typeof FormleeConfig !== 'undefined' && FormleeConfig.getConfigurationError
        ? FormleeConfig.getConfigurationError()
        : 'Formlee API origin is not configured.')
      return
    }
    chrome.tabs.create({ url: base + path })
  }

  /* ----------------------------- activity log ----------------------------- */

  function logActivity(level, text) {
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    state.activity.unshift({ level, text, time })
    if (state.activity.length > 40) state.activity.pop()
    renderActivity()
  }

  function renderActivity() {
    if (!els.activityList) return
    if (state.activity.length === 0) {
      els.activityList.innerHTML = '<li class="sp-activity-item info">No recent activity.</li>'
      return
    }
    els.activityList.innerHTML = state.activity
      .map(
        item =>
          '<li class="sp-activity-item ' +
          escapeText(item.level) +
          '">' +
          escapeText(item.text) +
          '<span class="sp-activity-time">' +
          escapeText(item.time) +
          '</span></li>'
      )
      .join('')
  }

  /* ----------------------------- pet states ----------------------------- */

  function setPetState(stateId, message) {
    state.petState = stateId
    state.petMessage = message || (PetCore ? PetCore.defaultMessage(stateId) : '')
    if (els.petMessage) els.petMessage.textContent = state.petMessage
    if (els.petState) {
      const meta = PetCore ? PetCore.stateMeta(stateId) : null
      els.petState.textContent = meta ? meta.label : stateId
    }
    if (els.petAvatar) {
      const motion = PetCore ? PetCore.motionClass(stateId) : ''
      els.petAvatar.className = 'sp-pet-avatar state-' + stateId + (motion ? ' ' + motion : '')
    }
  }

  /* ----------------------------- connection ----------------------------- */

  async function checkConnection(initial) {
    setConnection('checking', 'Checking…')
    const response = await sendRuntime({ type: 'STATUS' })
    const wasConnected = state.connected
    state.connected = response && response.ok && response.connected === true
    state.sessionExpiresAt = response && response.connected ? response.expiresAt : null
    if (wasConnected && !state.connected) {
      // Remove profile values already rendered here after server-side logout
      // or session revocation.
      window.location.reload()
      return
    }
    if (state.connected) {
      setConnection('connected', 'Connected')
    } else {
      const expired = state.sessionExpiresAt && new Date(state.sessionExpiresAt).getTime() <= Date.now()
      setConnection('disconnected', expired ? 'Session expired' : (initial ? 'Not connected' : (response && response.error) || 'Disconnected'))
      showConnectSection(expired ? SESSION_HEADER_REMINDER : null)
    }
    renderConnectSection()
  }

  function setConnection(status, label) {
    if (!els.connectionDot || !els.connectionLabel) return
    els.connectionDot.className = 'sp-status-dot ' + status
    els.connectionLabel.textContent = label
  }

  function renderConnectSection() {
    if (!els.connectSection) return
    els.connectSection.hidden = state.connected
    if (els.connectChip) {
      els.connectChip.className = 'sp-chip ' + (state.connected ? 'supported' : 'unsupported')
      els.connectChip.textContent = state.connected ? 'Connected' : 'Not connected'
    }
  }

  function showConnectSection(fallbackError) {
    renderConnectSection()
    renderPairError(fallbackError)
  }

  function renderPairError(message) {
    if (!els.pairError) return
    if (message) {
      els.pairError.textContent = message
      els.pairError.hidden = false
    } else {
      els.pairError.textContent = ''
      els.pairError.hidden = true
    }
  }

  async function onPair() {
    const input = els.pairCode
    if (!input) return
    const code = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (code.length !== 15) {
      renderPairError('Paste the 15-character code exactly as shown on the agent page (3 groups of 5).')
      return
    }
    renderPairError(null)

    els.pairBtn.disabled = true
    els.pairBtn.textContent = 'Connecting…'
    setPetState('greeting', 'Pairing with your Formlee workspace…')
    const response = await sendRuntime({ type: 'PAIR', code })
    els.pairBtn.disabled = false
    els.pairBtn.textContent = 'Connect'

    if (!response || !response.ok) {
      const error = (response && response.error) || 'Pairing failed.'
      renderPairError(error)
      setPetState('error', error)
      logActivity('error', error)
      return
    }

    input.value = ''
    state.connected = true
    state.sessionExpiresAt = response.expiresAt || null
    setConnection('connected', 'Connected')
    renderConnectSection()
    renderPairError(null)
    setPetState('greeting', 'Connected! Open an examination portal and I’ll start helping.')
    logActivity('success', 'Paired with the Formlee workspace.')
    await refreshCurrentPage()
  }

  async function disconnect() {
    await sendRuntime({ type: 'DISCONNECT' })
    // Reloading this extension page discards any profile values held in its
    // current JS state. The service worker also clears supported content tabs.
    window.location.reload()
  }

  /** 15-minute agent session countdown in the header chip. */
  function refreshExpiryCountdown() {
    if (!state.connected || !state.sessionExpiresAt) return
    const end = new Date(state.sessionExpiresAt).getTime()
    if (!Number.isFinite(end)) return
    const seconds = Math.max(0, Math.round((end - Date.now()) / 1000))
    const minutes = Math.floor(seconds / 60)
    if (seconds === 0) {
      state.connected = false
      state.sessionExpiresAt = null
      setConnection('disconnected', 'Session expired')
      renderConnectSection()
      showConnectSection(SESSION_HEADER_REMINDER)
      setPetState('warning', 'The agent session expired — pair again with a fresh code. Nothing was lost; rescan to continue.')
      logActivity('warning', 'Agent session expired.')
      return
    }
    if (seconds <= 120) {
      setConnection('checking', 'Connected · ' + minutes + ':' + String(seconds % 60).padStart(2, '0'))
    } else {
      setConnection('connected', 'Connected')
    }
  }

  /* ----------------------------- adapter honesty ----------------------------- */

  function hideAdapterBanner() {
    if (!els.adapterBanner) return
    els.adapterBanner.hidden = true
    els.adapterBanner.textContent = ''
  }

  /**
   * The honesty banner. Shown from the page/plan the agent itself received,
   * so the wording is the adapter's own status — never invented here.
   */
  function renderAdapterBanner(page, plan, note) {
    if (!els.adapterBanner) return
    const source = page || plan || null
    if (!source || !source.adapterLabel || source.adapter === 'generic' || source.adapter === 'none') {
      hideAdapterBanner()
      return
    }
    const tone = AgentUI ? AgentUI.adapterTone(source.adapterStatus) : ''
    const clearStatus = source.adapterStatus || ''
    els.adapterBanner.hidden = false
    els.adapterBanner.className = 'sp-banner' + (tone ? ' ' + tone : '')

    const title = document.createElement('p')
    title.className = 'sp-banner-title'
    const statusText = AgentUI ? AgentUI.clearStatusLabel(clearStatus) : null
    title.textContent = source.adapterLabel + (statusText ? ' · ' + statusText : '')
    els.adapterBanner.appendChild(title)

    const body = document.createElement('p')
    body.className = 'sp-banner-body'
    body.textContent = note || (AgentUI ? AgentUI.adapterSummary(clearStatus, source.kind) : '')
    els.adapterBanner.appendChild(body)
  }

  /* ----------------------------- current page ----------------------------- */

  async function refreshCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab || typeof tab.url !== 'string') {
        renderPage(null)
        return
      }
      const classified = typeof AgentCore !== 'undefined' && AgentCore ? AgentCore.classifyUrl(tab.url) : null
      renderPage(classified, tab, tab.url)
    } catch (error) {
      renderPage(null)
    }
  }

  function renderPage(classified, tab, url) {
    if (!classified || classified.adapter === 'none') {
      state.page = null
      if (els.adapterChip) {
        els.adapterChip.className = 'sp-chip unsupported'
        els.adapterChip.textContent = 'Unsupported'
      }
      if (els.currentDomain) els.currentDomain.textContent = url ? safeHostname(url) : '—'
      if (els.pageKind) els.pageKind.textContent = 'Open an examination portal or the Formlee demo form.'
      if (els.readinessProgress) els.readinessProgress.hidden = true
      hideAdapterBanner()
      if (state.plan) {
        setPetState(
          'warning',
          'You moved to an unsupported page. Switch back to the scanned tab to fill, or scan again here.'
        )
      }
      return
    }

    const meta = typeof AgentCore !== 'undefined' && AgentCore ? AgentCore.adapterById(classified.adapter) : null
    state.page = classified
    if (els.adapterChip) {
      els.adapterChip.className = 'sp-chip ' + (meta && meta.status === 'stable' ? 'supported' : 'beta')
      els.adapterChip.textContent = meta ? meta.name : classified.adapter
    }
    if (els.currentDomain) els.currentDomain.textContent = safeHostname(classified.sanitizedUrl)
    if (els.pageKind) {
      els.pageKind.textContent = classified.fixture
        ? 'Formlee synthetic fixture — safe to practice on.'
        : (meta ? meta.statusLabel : 'Supported examination portal.')
    }
    if (!state.plan) {
      renderAdapterBanner(state.lastScanPage, state.plan, null)
    }
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname
    } catch (error) {
      return '—'
    }
  }

  /* ----------------------------- plan tab freshness ----------------------------- */

  function markPlanStaleForTab(tabId) {
    if (!state.plan) return
    if (state.planTabId == null || tabId !== state.planTabId) return
    clearPlan(
      'The scanned page navigated — the old plan is no longer safe to use. Scan again.',
      false
    )
    setPetState('warning', 'The page changed after the scan. Check it again before filling.')
    logActivity('warning', 'Plan discarded: the scanned page navigated.')
  }

  async function handleTabActivated(tabId) {
    if (!state.plan) return
    if (state.planTabId != null && tabId !== state.planTabId) {
      setPetState(
        'reviewing',
        'Your plan is waiting on the other tab. Return to the scanned page to review and fill.'
      )
    }
  }

  /* ----------------------------- scan / plan ----------------------------- */

  async function runScan() {
    if (state.scanning || state.filling) return
    state.scanning = true
    state.plan = null
    state.values = {}
    state.missing = []
    updateActionButtons()
    renderMissingSection()
    setPetState('scanning', 'Scanning this form for fields I can help with…')
    logActivity('info', 'Started scanning the active page.')

    const response = await sendRuntime({ type: 'SCAN' })
    state.scanning = false

    if (!response || !response.ok) {
      const error = (response && response.error) || 'Scan failed.'
      setPetState('error', error)
      logActivity('error', error)
      renderPlan(null)
      updateActionButtons()
      return
    }

    if (response.note) {
      const page = response.page || null
      state.lastScanPage = page
      renderAdapterBanner(page, null, response.note)
      setPetState('warning', response.note)
      logActivity('warning', response.note)
      renderPlan(null)
      updateActionButtons()
      return
    }

    state.plan = response.plan || null
    if (response.page) state.lastScanPage = response.page
    if (response.tab && typeof response.tab.id === 'number') state.planTabId = response.tab.id
    if (!state.plan) {
      setPetState('warning', 'No fillable fields were found on this page.')
      logActivity('warning', 'No fillable fields found.')
      renderPlan(null)
      updateActionButtons()
      return
    }

    // Fetch proposed values for mapped fields (preview before approval).
    const mappedCanonicals = state.plan.items
      .filter(item => item.status === 'mapped' && item.canonical)
      .map(item => item.canonical)
    const uniqueCanonicals = [...new Set(mappedCanonicals)]
    if (uniqueCanonicals.length > 0) {
      const valuesResponse = await sendRuntime({ type: 'VALUES', fields: uniqueCanonicals })
      if (valuesResponse && valuesResponse.ok) {
        state.values = valuesResponse.values || {}
        state.missing = Array.isArray(valuesResponse.missing) ? valuesResponse.missing : []
      }
    }
    renderMissingSection()

    const mappedCount = state.plan.items.filter(item => item.status === 'mapped').length
    const ambiguousCount = state.plan.items.filter(item => item.status === 'ambiguous').length
    const unsafeCount = state.plan.items.filter(item => item.status === 'unsafe').length

    setPetState(
      'reviewing',
      `I found ${state.plan.items.length} fields. ${mappedCount} are ready to fill, ${ambiguousCount} need your choice, and ${unsafeCount} are left for you.`
    )
    logActivity(
      'success',
      `Scanned: ${state.plan.items.length} fields, ${mappedCount} ready, ${ambiguousCount} ambiguous, ${unsafeCount} skipped for safety.`
    )
    renderAdapterBanner(state.lastScanPage, state.plan, null)
    renderPlan(state.plan)
    updateActionButtons()
  }

  function renderPlan(plan) {
    if (!plan) {
      if (els.planEmpty) els.planEmpty.hidden = false
      if (els.planContainer) els.planContainer.hidden = true
      if (els.resultsContainer) els.resultsContainer.hidden = true
      return
    }

    if (els.planEmpty) els.planEmpty.hidden = true
    if (els.planContainer) els.planContainer.hidden = false

    const counts = plan.counts || {}
    if (els.planSummary) {
      els.planSummary.innerHTML =
        summaryChip(`${counts.detected || 0} fields`, 'default') +
        summaryChip(`${counts.mapped || 0} ready`, 'ready') +
        summaryChip(`${counts.ambiguous || 0} needs you`, 'needs-you') +
        summaryChip(`${counts.unsafe || 0} not supported`, 'not-supported')
    }

    if (els.planList) {
      els.planList.innerHTML = plan.items
        .map(item => {
          const status = displayStatus(item)
          const style = status.replace(/_/g, '-')
          const checkbox =
            item.status === 'mapped' && !item.needsReview
              ? '<label class="sp-plan-check"><input type="checkbox" class="sp-approve-check" data-index="' +
                item.index +
                '" checked></label>'
              : item.status === 'mapped' && item.needsReview
                ? '<label class="sp-plan-check"><input type="checkbox" class="sp-approve-check" data-index="' +
                  item.index +
                  '"></label>'
                : '<span class="sp-plan-check"><input type="checkbox" disabled></span>'
          const valueText =
            item.status === 'mapped' && item.canonical && state.values[item.canonical] != null
              ? 'Will fill: ' + escapeText(String(state.values[item.canonical]))
              : escapeText(explanationFor(item))
          const sourceMeta =
            item.status === 'mapped' && item.source
              ? '<span class="sp-plan-source ' + sourceTone(item.source) + '">' + escapeText(sourceLabel(item.source)) + '</span>' +
                (item.confidence ? '<span class="sp-plan-confidence ' + confidenceTone(item.confidence) + '">' + escapeText(item.confidence) + '</span>' : '')
              : ''
          const warnings =
            Array.isArray(item.warnings) && item.warnings.length > 0
              ? '<div class="sp-plan-warnings">' + item.warnings.map(w => '⚠ ' + escapeText(w)).join('<br>') + '</div>'
              : ''
          return (
            '<li class="sp-plan-item">' +
            checkbox +
            '<div class="sp-plan-main">' +
            '<div class="sp-plan-label">' +
            escapeText(item.label || '(no label)') +
            ' <span class="sp-plan-kind">' +
            escapeText(item.kind) +
            (item.required ? ' · required' : '') +
            '</span></div>' +
            '<div class="sp-plan-mapping">' +
            (item.status === 'mapped' && item.canonical
              ? '→ ' + escapeText(fieldNameFor(item.canonical)) + sourceMeta + (item.needsReview ? ' — review before approving' : '')
              : valueText) +
            '</div>' +
            warnings +
            '</div>' +
            '<span class="sp-plan-status ' +
            style +
            '">' +
            escapeText(statusLabel(status)) +
            '</span>' +
            '</li>'
          )
        })
        .join('')
    }
  }

  function sourceLabel(source) {
    return source.replace(/_/g, ' ')
  }

  function sourceTone(source) {
    if (source === 'EXACT_ADAPTER' || source === 'DETERMINISTIC_ALIAS' || source === 'CONFIRMED_HISTORY') return 'ready'
    if (source === 'OPTION_MATCH' || source === 'SEMANTIC_MATCH') return 'needs-you'
    if (source === 'AI_SUGGESTION') return 'not-supported'
    return 'default'
  }

  function confidenceTone(confidence) {
    if (confidence === 'HIGH') return 'ready'
    if (confidence === 'MEDIUM') return 'needs-you'
    return 'not-supported'
  }

  function fieldNameFor(canonical) {
    if (AgentUI) return AgentUI.fieldName(canonical)
    return canonical
  }

  function summaryChip(text, tone) {
    const toneClass = tone === 'default' ? '' : ' ' + tone
    return '<span class="sp-chip' + toneClass + '">' + escapeText(text) + '</span>'
  }

  function displayStatus(item) {
    if (item.status === 'unsafe') return 'NOT_SUPPORTED'
    if (item.status === 'unmapped') return 'NOT_SUPPORTED'
    if (item.status === 'ambiguous' || item.status === 'manual') return 'NEEDS_YOU'
    if (item.needsReview) return 'CONFLICT_DETECTED'
    return 'READY'
  }

  function statusLabel(status) {
    return status.replace(/_/g, ' ')
  }

  function explanationFor(item) {
    if (item.status === 'unsafe') return 'Never filled automatically (CAPTCHA, OTP, payment, declaration, upload).'
    if (item.status === 'unmapped') return 'No mapping found — enter manually.'
    if (item.status === 'ambiguous') {
      const options = Array.isArray(item.ambiguous) ? item.ambiguous.map(id => fieldNameFor(id)).join(' / ') : null
      return options ? 'Could match: ' + options : 'Could match multiple vault fields.'
    }
    if (item.status === 'manual') return 'Left for manual entry.'
    if (item.needsReview) return 'Mapping flagged for review.'
    return 'Ready to fill.'
  }

  function getApprovedItems() {
    if (!state.plan || !els.planList) return []
    const checked = els.planList.querySelectorAll('.sp-approve-check:checked')
    const approved = []
    checked.forEach(box => {
      const index = Number(box.dataset.index)
      const item = state.plan.items.find(i => i.index === index)
      if (item && item.canonical) approved.push({ index, canonical: item.canonical, item })
    })
    return approved
  }

  async function runFill() {
    const approved = getApprovedItems()
    if (approved.length === 0) {
      setPetState('warning', 'Tick at least one mapped field before filling.')
      logActivity('warning', 'Fill attempted with no approved fields.')
      return
    }

    state.filling = true
    updateActionButtons()
    setPetState('filling', 'Requesting your approval to fill ' + approved.length + ' field' + (approved.length === 1 ? '' : 's') + '…')
    logActivity('info', 'Requesting server-side approval for ' + approved.length + ' field(s).')

    const approval = await sendRuntime({
      type: 'CREATE_APPROVAL',
      approved: approved.map(({ index, canonical }) => ({ index, canonical })),
    })
    if (!approval || !approval.ok || typeof approval.approvalRef !== 'string') {
      const error = (approval && approval.error) || 'Could not create server-side approval.'
      state.filling = false
      updateActionButtons()
      setPetState('error', error)
      logActivity('error', error)
      return
    }

    setPetState('filling', 'Filling ' + approved.length + ' approved field' + (approved.length === 1 ? '' : 's') + ' — nothing will be submitted.')
    logActivity('info', 'Server approval ' + approval.approvalRef.slice(0, 8) + '… granted; filling.')

    const response = await sendRuntime({
      type: 'FILL',
      approvalRef: approval.approvalRef,
      approved: approved.map(({ index, canonical }) => ({ index, canonical })),
    })
    state.filling = false
    updateActionButtons()

    if (!response || !response.ok) {
      const error = (response && response.error) || 'Fill failed.'
      setPetState('error', error)
      logActivity('error', error)
      renderResults(null)
      if (response && response.code === 'PAGE_CHANGED') {
        setPetState('warning', error)
        renderPlan(null)
      }
      return
    }

    const unverified = response.unverified || 0
    let summary =
      'Filled ' + response.filled + ' of ' + response.results.length +
      ' field(s) and read them back to verify. ' +
      (unverified > 0
        ? unverified + ' could not be verified — check ' + (unverified === 1 ? 'it' : 'them') + ' yourself.'
        : 'Nothing was submitted — always review the form.')
    if (response.creditFinalizationPending) {
      summary += ' The verified fill is complete, but credit finalization is pending; keep Formlee connected and do not repeat the fill.'
    } else if (response.creditFinalizationError) {
      summary += ' The verified fill is complete, but the credit finalization request failed: ' + response.creditFinalizationError + '. Do not repeat the fill.'
    }
    const needsAttention = unverified > 0 || response.creditFinalizationPending || !!response.creditFinalizationError
    setPetState(needsAttention ? 'warning' : 'success', summary)
    logActivity(needsAttention ? 'warning' : 'success', `Filled ${response.filled} field(s); ${unverified} unverified.` + (response.creditFinalizationPending ? ' Credit finalization pending.' : response.creditFinalizationError ? ' Credit finalization failed.' : ''))
    renderResults(response.results)
    if (els.resultsContainer) els.resultsContainer.hidden = false
  }

  function renderResults(results) {
    if (!els.resultsList) return
    if (!results || results.length === 0) {
      els.resultsList.innerHTML = '<li class="sp-result-item"><span>No results to show.</span></li>'
      return
    }
    const labelByIndex = new Map(state.plan ? state.plan.items.map(item => [item.index, item.label]) : [])
    els.resultsList.innerHTML = results
      .map(result => {
        const label = labelByIndex.get(result.index) || (result.canonical ? fieldNameFor(result.canonical) : 'Field ' + result.index)
        const done = result.status === 'filled'
        return (
          '<li class="sp-result-item">' +
          '<span>' +
          escapeText(label) +
          '</span>' +
          '<span class="sp-result-status ' +
          escapeText(result.status) +
          '">' +
          (done ? '✓ ' : '✗ ') +
          escapeText(resultLineFor(result.status)) +
          '</span>' +
          '</li>'
        )
      })
      .join('')
  }

  function resultLineFor(status) {
    if (AgentUI) return AgentUI.resultLine(status)
    return status
  }

  function clearPlan(message, alsoWarn) {
    state.plan = null
    state.planTabId = null
    state.values = {}
    state.missing = []
    renderPlan(null)
    renderMissingSection()
    updateActionButtons()
    hideAdapterBanner()
    if (message) {
      setPetState(alsoWarn ? 'warning' : 'idle', message)
      logActivity('info', message)
    } else {
      setPetState('idle', 'Plan cleared. Scan a form when you’re ready.')
      logActivity('info', 'Plan cleared.')
    }
    sendRuntime({ type: 'CLEAR_PLAN' })
  }

  function updateActionButtons() {
    if (els.scanBtn) els.scanBtn.disabled = state.scanning || state.filling
    if (els.fillBtn) els.fillBtn.disabled = !state.plan || state.scanning || state.filling
    if (els.clearBtn) els.clearBtn.disabled = !state.plan || state.scanning || state.filling
  }

  /* ----------------------------- missing profile info ----------------------------- */

  function renderMissingSection() {
    if (!els.missingSection || !els.missingList) return
    if (!state.plan || state.missing.length === 0) {
      els.missingSection.hidden = true
      els.missingList.innerHTML = ''
      return
    }
    els.missingSection.hidden = false
    els.missingList.innerHTML = state.missing
      .map(entry => {
        if (typeof entry === 'string') {
          return '<li>' + escapeText(fieldNameFor(entry)) + '</li>'
        }
        return '<li>' + escapeText(entry && (entry.label || fieldNameFor(entry.canonical)) || 'A profile field') + '</li>'
      })
      .join('')
  }

  /* ----------------------------- readiness ----------------------------- */

  async function loadReadiness() {
    if (!els.readinessContainer) return
    els.readinessContainer.innerHTML = '<p class="sp-hint">Loading readiness…</p>'
    const response = await sendRuntime({ type: 'READINESS_SUMMARY' })
    if (!response || !response.ok) {
      els.readinessContainer.innerHTML =
        '<p class="sp-hint">Could not load readiness. ' + escapeText((response && response.error) || '') + '</p>'
      return
    }
    const applications = response.applications || []
    state.readiness = applications
    renderReadiness(applications)
    updateReadinessProgress(applications)
  }

  function renderReadiness(applications) {
    if (!els.readinessContainer) return
    if (applications.length === 0) {
      els.readinessContainer.innerHTML =
        '<p class="sp-hint">No applications tracked yet. Add one in the Application Hub.</p>'
      return
    }
    els.readinessContainer.innerHTML = applications
      .map(app => {
        const stateClass =
          app.readinessState === 'READY'
            ? 'ready'
            : app.readinessState === 'DOCUMENT_ATTENTION_REQUIRED'
              ? 'attention'
              : 'missing'
        const issues = []
        if (app.missingProfileLabels && app.missingProfileLabels.length > 0) {
          issues.push('Missing profile: ' + app.missingProfileLabels.join(', '))
        }
        if (app.missingDocumentLabels && app.missingDocumentLabels.length > 0) {
          issues.push('Missing documents: ' + app.missingDocumentLabels.join(', '))
        }
        if (app.needsConfirmationLabels && app.needsConfirmationLabels.length > 0) {
          issues.push('Needs confirmation: ' + app.needsConfirmationLabels.join(', '))
        }
        return (
          '<div class="sp-readiness-app">' +
          '<div class="sp-readiness-header">' +
          '<p class="sp-readiness-name">' +
          escapeText(app.examName || 'Application') +
          '</p>' +
          '<span class="sp-readiness-state ' +
          stateClass +
          '">' +
          escapeText(app.readinessState.replace(/_/g, ' ')) +
          '</span>' +
          '</div>' +
          (issues.length > 0
            ? '<ul class="sp-readiness-items"><li>' +
              issues.map(escapeText).join('</li><li>') +
              '</li></ul>'
            : '<p class="sp-hint" style="margin:0">All published requirements met.</p>') +
          '</div>'
        )
      })
      .join('')
  }

  function updateReadinessProgress(applications) {
    if (!els.readinessProgress || !els.readinessBar || !els.readinessLabel) return
    if (applications.length === 0) {
      els.readinessProgress.hidden = true
      return
    }
    const readyCount = applications.filter(a => a.readinessState === 'READY').length
    const percent = Math.round((readyCount / applications.length) * 100)
    els.readinessProgress.hidden = false
    els.readinessBar.style.setProperty('--progress', percent + '%')
    els.readinessBar.setAttribute('aria-valuenow', String(percent))
    els.readinessLabel.textContent = percent + '% ready (' + readyCount + '/' + applications.length + ')'
  }

  /* ----------------------------- plan resume ----------------------------- */

  async function tryResumePlan() {
    if (!state.connected) return
    const response = await sendRuntime({ type: 'GET_PLAN_CONTEXT' })
    if (!response || !response.ok || !response.plan) return
    state.plan = response.plan
    state.planTabId = typeof response.tabId === 'number' ? response.tabId : null
    if (response.page) state.lastScanPage = { ...response.page, adapterLabel: response.plan.adapterLabel, adapterStatus: response.plan.adapterStatus, kind: response.page.kind }
    const mappedCanonicals = state.plan.items
      .filter(item => item.status === 'mapped' && item.canonical)
      .map(item => item.canonical)
    const uniqueCanonicals = [...new Set(mappedCanonicals)]
    if (uniqueCanonicals.length > 0) {
      const valuesResponse = await sendRuntime({ type: 'VALUES', fields: uniqueCanonicals })
      if (valuesResponse && valuesResponse.ok) {
        state.values = valuesResponse.values || {}
        state.missing = Array.isArray(valuesResponse.missing) ? valuesResponse.missing : []
      }
    }
    renderAdapterBanner(state.lastScanPage, state.plan, null)
    renderPlan(state.plan)
    renderMissingSection()
    updateActionButtons()
    setPetState('reviewing', 'Resumed the plan from your last scan — check it still matches the page before filling.')
    logActivity('info', 'Resumed the previously inspected plan.')
  }

  /* ----------------------------- agent chat ----------------------------- */

  function renderChat() {
    if (!els.chatMessages) return
    if (state.chatApiMessages.length === 0) {
      els.chatMessages.innerHTML = '<p class="sp-hint">Ask a question about your vault, readiness, or a supported exam page.</p>'
      return
    }
    els.chatMessages.innerHTML = state.chatApiMessages
      .map(msg => {
        if (msg.role === 'user') {
          return '<div class="sp-chat-message user"><span>' + escapeText(msg.content) + '</span></div>'
        }
        if (msg.role === 'assistant') {
          return '<div class="sp-chat-message assistant"><span>' + escapeText(msg.content || '') + '</span></div>'
        }
        if (msg.role === 'tool') {
          return '<div class="sp-chat-message tool"><span>Tool result</span></div>'
        }
        return ''
      })
      .join('')
    if (state.chatThinking) {
      els.chatMessages.innerHTML += '<div class="sp-chat-message assistant thinking"><span>Formlee is thinking…</span></div>'
    }
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight
  }

  function appendChatMessage(role, content) {
    state.chatApiMessages.push({ role, content })
    renderChat()
  }

  function clearChatActions() {
    state.pendingBrowserAction = null
    state.pendingToolCallId = null
    if (els.chatActions) {
      els.chatActions.innerHTML = ''
      els.chatActions.hidden = true
    }
  }

  function renderBrowserAction(action, toolCallId) {
    if (!els.chatActions) return
    state.pendingBrowserAction = action
    state.pendingToolCallId = toolCallId
    els.chatActions.hidden = false
    const label = actionLabel(action)
    els.chatActions.innerHTML =
      '<button class="sp-btn primary sm" id="chat-action-btn" type="button">' + escapeText(label) + '</button>'
    const btn = document.getElementById('chat-action-btn')
    if (btn) btn.addEventListener('click', () => onChatAction(action, toolCallId))
  }

  function actionLabel(action) {
    switch (action.type) {
      case 'GET_TAB_CONTEXT':
        return 'Read active tab'
      case 'SCAN_PAGE':
        return 'Scan this page'
      case 'VERIFY':
        return 'Verify filled fields'
      case 'FILL':
        return 'Fill approved fields'
      default:
        return 'Run action'
    }
  }

  async function onChatAction(action, toolCallId) {
    clearChatActions()
    setPetState('thinking', 'Running browser action…')
    logActivity('info', 'Running browser action: ' + action.type)

    const result = await sendRuntime({ type: 'RUN_BROWSER_ACTION', action })
    const resultContent = JSON.stringify(result.ok ? { ok: true, data: result } : { ok: false, error: result.error, code: result.code })
    state.chatApiMessages.push({
      role: 'user',
      content: 'Browser action result (untrusted page data): ' + resultContent,
    })

    if (!result.ok) {
      setPetState('error', result.error || 'Browser action failed.')
      logActivity('error', 'Browser action ' + action.type + ' failed: ' + (result.error || ''))
    } else {
      setPetState('success', 'Browser action completed.')
      logActivity('success', 'Browser action ' + action.type + ' completed.')
    }

    renderChat()
    await resumeChat()
  }

  async function sendChat() {
    if (!els.chatInput || state.chatThinking) return
    const text = els.chatInput.value.trim()
    if (!text) return
    els.chatInput.value = ''

    clearChatActions()
    appendChatMessage('user', text)
    state.chatThinking = true
    renderChat()
    setPetState('thinking', 'Thinking…')
    logActivity('info', 'Chat: ' + text)

    await runChatTurn()
  }

  async function resumeChat() {
    if (state.chatThinking) return
    state.chatThinking = true
    renderChat()
    setPetState('thinking', 'Continuing…')
    await runChatTurn()
  }

  async function runChatTurn() {
    const response = await sendRuntime({ type: 'CHAT', messages: state.chatApiMessages })
    state.chatThinking = false
    renderChat()

    if (!response || !response.ok) {
      const error = (response && response.body && response.body.error) || (response && response.error) || 'Chat failed.'
      appendChatMessage('assistant', 'Sorry — ' + error)
      setPetState('error', error)
      logActivity('error', 'Chat request failed: ' + error)
      return
    }

    const body = response.body || {}
    const finalText = body.finalText || 'Done.'
    const toolCalls = Array.isArray(body.toolCalls) ? body.toolCalls : []

    // Record the assistant turn. Tool results for server-side tools are kept
    // inside the runner and do not need to be replayed by the client, but the
    // assistant message must carry tool_calls so the next model turn is valid.
    // The server already ran each tool and returned the final answer. Replaying
    // orphaned tool_calls without their results would corrupt the next turn.
    const assistantMsg = { role: 'assistant', content: finalText }
    state.chatApiMessages.push(assistantMsg)
    renderChat()

    let taskStartedFromChat = false
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        logActivity(tc.result && tc.result.ok ? 'success' : 'error', `Tool ${tc.name}: ${tc.result && tc.result.ok ? 'ok' : (tc.result && tc.result.error) || 'failed'}`)
        if (tc.result && tc.result.ok && tc.result.result && tc.result.result.data) {
          const data = tc.result.result.data
          if ((tc.name === 'create_agent_task' || tc.name === 'resume_agent_task') && typeof data.taskRef === 'string') {
            state.taskRef = data.taskRef
            taskStartedFromChat = true
          }
        }
      }
    }

    if (body.taskRef && typeof body.taskRef === 'string') {
      state.taskRef = body.taskRef
      taskStartedFromChat = true
    }

    if (taskStartedFromChat) {
      startTaskPolling()
      await refreshCurrentTask()
      await loadTaskSteps()
      renderTask()
      setPetState('working', 'Task started from chat.')
      logActivity('success', 'Task ' + state.taskRef + ' started from chat.')
    }

    if (body.pendingBrowserAction && toolCalls.length > 0) {
      const lastCall = toolCalls[toolCalls.length - 1]
      renderBrowserAction(body.pendingBrowserAction, lastCall.id)
      setPetState('waiting', 'Formlee needs your permission to run a browser action.')
      logActivity('info', 'Pending browser action: ' + body.pendingBrowserAction.type)
    } else {
      setPetState(body.ok ? 'success' : 'error', finalText)
    }
  }

  /* ----------------------------- task orchestrator ----------------------------- */

  function taskStatusToPetState(status) {
    switch (status) {
      case 'PLANNING':
        return 'thinking'
      case 'RUNNING':
        return 'working'
      case 'WAITING_FOR_STUDENT':
        return 'waiting'
      case 'PAUSED':
      case 'RETRYING':
        return 'reviewing'
      case 'COMPLETED':
        return 'success'
      case 'PARTIALLY_COMPLETED':
        return 'warning'
      case 'FAILED':
      case 'CANCELLED':
      case 'EXPIRED':
        return 'error'
      default:
        return 'idle'
    }
  }

  function startTaskPolling() {
    if (state.taskPolling) return
    state.taskPolling = window.setInterval(refreshCurrentTask, 3000)
  }

  function stopTaskPolling() {
    if (state.taskPolling) {
      window.clearInterval(state.taskPolling)
      state.taskPolling = null
    }
  }

  async function refreshCurrentTask() {
    if (!state.taskRef) return
    const response = await sendRuntime({ type: 'GET_TASK', taskRef: state.taskRef })
    if (!response || !response.ok || !response.task) return
    state.task = response.task
    renderTask()
  }

  async function loadTaskSteps() {
    if (!state.taskRef) return
    const response = await sendRuntime({ type: 'GET_TASK_STEPS', taskRef: state.taskRef })
    if (response && response.ok && Array.isArray(response.steps)) {
      state.task.steps = response.steps
    }
  }

  function renderTask() {
    if (!els.taskSection) return
    const task = state.task
    if (!task) {
      if (els.taskStatusChip) els.taskStatusChip.textContent = 'No task'
      if (els.taskCreateRow) els.taskCreateRow.hidden = false
      if (els.taskDetail) els.taskDetail.hidden = true
      return
    }

    if (els.taskCreateRow) els.taskCreateRow.hidden = true
    if (els.taskDetail) els.taskDetail.hidden = false
    if (els.taskStatusChip) {
      els.taskStatusChip.className = 'sp-chip ' + taskStatusTone(task.status)
      els.taskStatusChip.textContent = task.status.replace(/_/g, ' ')
    }
    if (els.taskObjectiveDisplay) els.taskObjectiveDisplay.textContent = task.objective
    if (els.taskMessage) els.taskMessage.textContent = task.errorMessage || task.plan?.explanation || ''

    renderTaskProgress()
    renderTaskSteps()
    renderTaskActions()

    setPetState(taskStatusToPetState(task.status), task.errorMessage || task.plan?.explanation || 'Working on your task…')
  }

  function taskStatusTone(status) {
    switch (status) {
      case 'COMPLETED':
        return 'ready'
      case 'RUNNING':
      case 'PLANNING':
        return 'supported'
      case 'WAITING_FOR_STUDENT':
      case 'PAUSED':
      case 'RETRYING':
        return 'needs-you'
      case 'FAILED':
      case 'CANCELLED':
      case 'EXPIRED':
        return 'not-supported'
      default:
        return 'default'
    }
  }

  function renderTaskProgress() {
    if (!els.taskProgress || !els.taskProgressBar || !els.taskProgressLabel || !state.task) return
    const steps = state.task.steps || []
    if (steps.length === 0) {
      els.taskProgress.hidden = true
      return
    }
    const completed = steps.filter(s => s.status === 'COMPLETED').length
    const percent = Math.round((completed / steps.length) * 100)
    els.taskProgress.hidden = false
    els.taskProgressBar.style.setProperty('--progress', percent + '%')
    els.taskProgressBar.setAttribute('aria-valuenow', String(percent))
    els.taskProgressLabel.textContent = percent + '%'
  }

  function renderTaskSteps() {
    if (!els.taskSteps || !state.task) return
    const steps = state.task.steps || []
    if (steps.length === 0) {
      els.taskSteps.innerHTML = '<li class="sp-task-step"><span class="sp-task-step-number">…</span><span>Planning…</span></li>'
      return
    }
    els.taskSteps.innerHTML = steps
      .map((step, idx) => {
        const statusClass = step.status.toLowerCase()
        const icon = step.status === 'COMPLETED' ? '✓' : step.status === 'RUNNING' ? '●' : step.status === 'WAITING_FOR_STUDENT' ? '⏸' : step.status === 'FAILED' ? '✗' : idx + 1
        return (
          '<li class="sp-task-step ' + escapeText(statusClass) + '">' +
          '<span class="sp-task-step-number">' + icon + '</span>' +
          '<span>' + escapeText(step.description || step.toolName) + '</span>' +
          '</li>'
        )
      })
      .join('')
  }

  function renderTaskActions() {
    if (!state.task) return
    const status = state.task.status
    const pendingAction = state.task.pendingAction

    if (els.taskRunBtn) els.taskRunBtn.hidden = status !== 'READY'
    if (els.taskPauseBtn) els.taskPauseBtn.hidden = status !== 'RUNNING'
    if (els.taskResumeBtn) els.taskResumeBtn.hidden = status !== 'PAUSED' && status !== 'RETRYING'
    if (els.taskCancelBtn) els.taskCancelBtn.hidden = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)

    if (els.taskPending) {
      els.taskPending.hidden = status !== 'WAITING_FOR_STUDENT' || !pendingAction
    }
    if (els.taskPendingBtn && pendingAction) {
      els.taskPendingBtn.textContent = actionLabel(pendingAction)
      els.taskPendingBtn.onclick = () => onTaskPendingAction(pendingAction)
    }
  }

  async function onCreateTask() {
    if (!els.taskObjectiveInput) return
    const objective = els.taskObjectiveInput.value.trim()
    if (!objective) return
    els.taskCreateBtn.disabled = true
    setPetState('thinking', 'Creating task…')
    logActivity('info', 'Creating task: ' + objective)

    const response = await sendRuntime({ type: 'CREATE_TASK', objective })
    if (!response || !response.ok || !response.body || typeof response.body.taskRef !== 'string') {
      const error = (response && response.body && response.body.error) || 'Could not create task.'
      setPetState('error', error)
      logActivity('error', error)
      els.taskCreateBtn.disabled = false
      return
    }

    state.taskRef = response.body.taskRef
    els.taskObjectiveInput.value = ''
    els.taskCreateBtn.disabled = false
    logActivity('success', 'Task created: ' + state.taskRef)

    // Plan immediately.
    await onPlanTask()
    startTaskPolling()
  }

  async function onPlanTask() {
    if (!state.taskRef) return
    setPetState('thinking', 'Planning task…')
    logActivity('info', 'Planning task…')
    const response = await sendRuntime({ type: 'PLAN_TASK', taskRef: state.taskRef })
    if (!response || !response.ok || !response.body) {
      const error = (response && response.body && response.body.error) || 'Planning failed.'
      setPetState('error', error)
      logActivity('error', error)
      return
    }
    state.task = response.body
    await loadTaskSteps()
    renderTask()
    logActivity('success', 'Task planned: ' + (response.body.message || 'Ready to run.'))
  }

  async function onRunTask() {
    if (!state.taskRef) return
    setPetState('working', 'Running task…')
    logActivity('info', 'Running task…')
    const response = await sendRuntime({ type: 'RUN_TASK', taskRef: state.taskRef })
    await handleTaskRunResponse(response)
  }

  async function onResumeTask() {
    if (!state.taskRef) return
    setPetState('working', 'Resuming task…')
    logActivity('info', 'Resuming task…')
    const response = await sendRuntime({ type: 'RUN_TASK', taskRef: state.taskRef, resume: true })
    await handleTaskRunResponse(response)
  }

  async function handleTaskRunResponse(response) {
    if (!response || !response.ok || !response.body) {
      const error = (response && response.body && response.body.error) || 'Task run failed.'
      setPetState('error', error)
      logActivity('error', error)
      return
    }
    state.task = response.body
    await loadTaskSteps()
    renderTask()

    if (response.body.pendingBrowserAction) {
      logActivity('info', 'Task waiting for browser action: ' + response.body.pendingBrowserAction.type)
      return
    }

    const status = response.body.status
    if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') {
      logActivity('success', 'Task finished: ' + status.replace(/_/g, ' '))
    } else if (status === 'WAITING_FOR_STUDENT') {
      logActivity('info', 'Task waiting for you.')
    } else if (status === 'FAILED') {
      logActivity('error', 'Task failed: ' + (response.body.message || ''))
    }
  }

  async function onPauseTask() {
    if (!state.taskRef) return
    const response = await sendRuntime({ type: 'PAUSE_TASK', taskRef: state.taskRef })
    if (response && response.ok && response.body) {
      state.task = response.body
      renderTask()
      logActivity('info', 'Task paused.')
    }
  }

  async function onCancelTask() {
    if (!state.taskRef) return
    const response = await sendRuntime({ type: 'CANCEL_TASK', taskRef: state.taskRef })
    if (response && response.ok && response.body) {
      state.task = response.body
      renderTask()
      logActivity('info', 'Task cancelled.')
    }
  }

  async function onTaskPendingAction(action) {
    if (!action || !state.taskRef) return
    setPetState('working', 'Running task browser action…')
    logActivity('info', 'Task browser action: ' + action.type)
    const result = await sendRuntime({ type: 'RUN_BROWSER_ACTION', action })
    const resultPayload = result.ok ? { ok: true, data: result } : { ok: false, error: result.error, code: result.code }
    const response = await sendRuntime({
      type: 'SUBMIT_TASK_BROWSER_RESULT',
      taskRef: state.taskRef,
      actionId: state.task.pendingActionId,
      result: resultPayload,
    })
    await handleTaskRunResponse(response)
  }

  /* ----------------------------- pet surface flag ----------------------------- */

  function setPetSurface(surface) {
    try {
      chrome.storage.local.set({ [PET_SURFACE_KEY]: surface })
    } catch (error) {
      // The flag only feels nice; failing to set it is not an experience
      // breaker. The floating pet keeps its default behaviour.
    }
  }

  /* ----------------------------- event wiring ----------------------------- */

  function wireButtons() {
    if (els.pairBtn) els.pairBtn.addEventListener('click', onPair)
    if (els.pairCode) {
      els.pairCode.addEventListener('keydown', event => {
        if (event.key === 'Enter') onPair()
      })
    }
    if (els.scanBtn) els.scanBtn.addEventListener('click', runScan)
    if (els.fillBtn) els.fillBtn.addEventListener('click', runFill)
    if (els.clearBtn) els.clearBtn.addEventListener('click', () => clearPlan(null, false))
    if (els.chatSend) els.chatSend.addEventListener('click', sendChat)
    if (els.chatInput) {
      els.chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') sendChat()
      })
    }
    if (els.taskCreateBtn) els.taskCreateBtn.addEventListener('click', onCreateTask)
    if (els.taskObjectiveInput) {
      els.taskObjectiveInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') onCreateTask()
      })
    }
    if (els.taskRunBtn) els.taskRunBtn.addEventListener('click', onRunTask)
    if (els.taskPauseBtn) els.taskPauseBtn.addEventListener('click', onPauseTask)
    if (els.taskResumeBtn) els.taskResumeBtn.addEventListener('click', onResumeTask)
    if (els.taskCancelBtn) els.taskCancelBtn.addEventListener('click', onCancelTask)
    if (els.missingFixBtn) els.missingFixBtn.addEventListener('click', () => sendRuntime({ type: 'OPEN_PROFILE' }))
    if (els.refreshReadinessBtn) els.refreshReadinessBtn.addEventListener('click', loadReadiness)
    if (els.clearActivityBtn) els.clearActivityBtn.addEventListener('click', () => { state.activity = []; renderActivity() })
    if (els.openProfileLink) els.openProfileLink.addEventListener('click', e => { e.preventDefault(); sendRuntime({ type: 'OPEN_PROFILE' }) })
    if (els.openHubLink) els.openHubLink.addEventListener('click', e => { e.preventDefault(); sendRuntime({ type: 'OPEN_HUB' }) })
    if (els.openAgentLink) els.openAgentLink.addEventListener('click', e => { e.preventDefault(); goToFormlee('/apply/agent') })
    if (els.openDemoLink) els.openDemoLink.addEventListener('click', e => { e.preventDefault(); goToFormlee('/apply/agent/demo-form') })
    if (els.disconnectBtn) els.disconnectBtn.addEventListener('click', disconnect)

    chrome.tabs.onActivated.addListener(activeInfo => {
      refreshCurrentPage()
      handleTabActivated(activeInfo && typeof activeInfo.tabId === 'number' ? activeInfo.tabId : null)
    })
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        // A navigation on the scanned tab invalidates the plan (the service
        // worker clears its plan context too).
        markPlanStaleForTab(tabId)
        refreshCurrentPage()
      }
    })
  }

  /* ----------------------------- init ----------------------------- */

  async function init() {
    if (els.petAvatar && PetCore) {
      els.petAvatar.innerHTML = PetCore.mascotSVG()
    }
    wireButtons()
    window.setInterval(refreshExpiryCountdown, 1000)
    window.setInterval(() => {
      if (state.connected) checkConnection(false)
    }, 60_000)
    setPetSurface('panel')
    await checkConnection(true)
    await refreshCurrentPage()
    if (state.connected) {
      await tryResumePlan()
    }
    await loadReadiness()
    logActivity('info', 'Side panel initialized.')
  }

  // Leaving the panel (closing it by reloading the extension, or navigating
  // away) hands the floating pet back as the primary surface.
  window.addEventListener('pagehide', () => setPetSurface('floating'))
  window.addEventListener('beforeunload', () => setPetSurface('floating'))

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
