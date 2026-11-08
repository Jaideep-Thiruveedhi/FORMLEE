/**
 * Formlee Pet — floating student assistant (Manifest V3 content script).
 *
 * Runs only on the explicitly matched examination pages defined in
 * manifest.json. It is a pure UI layer: scan/fill/value logic stays in the
 * existing service worker and content/agent.js. The pet never reads form
 * values, never fills without explicit approval, and never submits.
 */

;(function () {
  'use strict'

  const AgentCore = globalThis.AgentCore || globalThis.FormleeAgentCore || globalThis.RankoraAgentCore || null
  // Shared UI vocabulary — the panel and popup use the same table, so the
  // floating pet never describes a field differently from the side panel.
  const AgentUI = typeof FormleeAgentUI !== 'undefined' ? FormleeAgentUI : null

  const STORAGE_KEY = 'formleePetState'
  const LEGACY_STORAGE_KEY = 'formlyPetState'
  const SURFACE_KEY = 'formleePetSurface'
  const LEGACY_SURFACE_KEY = 'formlyPetSurface'
  const MENU_ITEMS = [
    { id: 'scan', label: 'Scan this form' },
    { id: 'fill', label: 'Fill application' },
    { id: 'view', label: 'View detected fields' },
    { id: 'explain', label: 'Explain selected field' },
    { id: 'resume', label: 'Resume interrupted task' },
    { id: 'readiness', label: 'Application readiness' },
    { id: 'missing', label: 'Missing information' },
    { id: 'profile', label: 'Review my profile' },
    { id: 'hub', label: 'Open Application Hub' },
    { id: 'settings', label: 'Settings' },
    { id: 'hide', label: 'Hide pet' },
  ]
  const FILLABLE_FIELD_NAMES_FALLBACK = {
    fullName: 'Full name',
    gender: 'Gender',
    dateOfBirth: 'Date of birth',
    dateOfBirthDay: 'Date of birth — day',
    dateOfBirthMonth: 'Date of birth — month',
    dateOfBirthYear: 'Date of birth — year',
    email: 'Email address',
    mobileNumber: 'Mobile number',
    nationality: 'Nationality',
    fatherName: "Father's name",
    motherName: "Mother's name",
    guardianName: 'Guardian name',
    guardianRelation: 'Guardian relation',
    permanentAddressLine: 'Permanent address',
    permanentCity: 'Permanent city',
    permanentState: 'Permanent state',
    permanentPinCode: 'Permanent PIN code',
    currentAddressLine: 'Current address',
    currentCity: 'Current city',
    currentState: 'Current state',
    currentPinCode: 'Current PIN code',
    addressLine: 'Address',
    city: 'City',
    state: 'State',
    pinCode: 'PIN code',
    class10Board: 'Class 10 board',
    class10SchoolName: 'Class 10 school',
    class10PassingYear: 'Class 10 passing year',
    class10RollNumber: 'Class 10 roll number',
    class10MarksKind: 'Class 10 marks format',
    class10Marks: 'Class 10 marks',
    class12Status: 'Class 12 status',
    class12Board: 'Class 12 board',
    class12SchoolName: 'Class 12 school',
    class12ExamYear: 'Class 12 exam year',
    class12PassingYear: 'Class 12 passing year',
    class12RollNumber: 'Class 12 roll number',
    class12MarksKind: 'Class 12 marks format',
    class12Marks: 'Class 12 marks',
    category: 'Category',
    pwdStatus: 'PwD status',
    homeState: 'Home state',
    preferredExamCities: 'Preferred exam cities',
  }
  const PAGE_KIND_NAMES_FALLBACK = {
    personal: 'Personal Details',
    qualification: 'Qualification Details',
    exam: 'Examination choices',
    documents: 'Document uploads',
    declaration: 'Declaration',
    login: 'Login / registration',
    unknown: 'Unrecognised page',
    generic: 'Generic form',
  }

  const FILLABLE_FIELD_NAMES = AgentUI ? AgentUI.FIELD_NAMES : FILLABLE_FIELD_NAMES_FALLBACK
  const PAGE_KIND_NAMES = AgentUI ? AgentUI.PAGE_KIND_LABELS : PAGE_KIND_NAMES_FALLBACK

  let host = null
  let shadow = null
  let wrapper = null
  let petEl = null
  let panelEl = null
  let menuEl = null

  const state = {
    mounted: false,
    hidden: false,
    /** When the side panel is open it is the primary Pet surface; the
     *  floating pet suppresses itself so there is never a duplicate mascot. */
    panelSurface: 'floating',
    minimized: false,
    reducedMotion: false,
    panelOpen: false,
    menuOpen: false,
    activeTab: 'plan',
    position: { right: 24, bottom: 24 },
    session: { connected: false, expiresAt: null },
    page: null,
    petState: 'idle',
    statusText: 'Hello — I\'m Formlee.',
    plan: null,
    values: {},
    missing: [],
    profileStatus: null,
    readiness: null,
    readinessLoading: false,
    documents: null,
    documentsLoading: false,
    scanError: null,
    fillResult: null,
    scanning: false,
    filling: false,
    explaining: null,
  }

  /* ------------------------------------------------------------------ */
  /* runtime bridge                                                     */
  /* ------------------------------------------------------------------ */

  function sendRuntime(message) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: 'The Formlee extension bridge is not available.' })
        return
      }
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError
        resolve(error ? { ok: false, error: error.message } : (response || { ok: false, error: 'No response.' }))
      })
    })
  }

  /* ------------------------------------------------------------------ */
  /* storage / persistence                                              */
  /* ------------------------------------------------------------------ */

  function readStorage() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome || !chrome.storage || !chrome.storage.local) {
        resolve({})
        return
      }
      chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY], result => {
        const saved = result[STORAGE_KEY] ?? result[LEGACY_STORAGE_KEY]
        if (saved && !result[STORAGE_KEY]) {
          chrome.storage.local.set({ [STORAGE_KEY]: saved }, () => {
            chrome.storage.local.remove(LEGACY_STORAGE_KEY)
          })
        }
        resolve(saved || {})
      })
    })
  }

  function writeStorage(patch) {
    if (typeof chrome === 'undefined' || !chrome || !chrome.storage || !chrome.storage.local) return
    chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY], result => {
      const next = { ...(result[STORAGE_KEY] || result[LEGACY_STORAGE_KEY] || {}), ...patch }
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
        chrome.storage.local.remove(LEGACY_STORAGE_KEY)
      })
    })
  }

  /* ------------------------------------------------------------------ */
  /* safe helpers                                                       */
  /* ------------------------------------------------------------------ */

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function fieldName(canonical) {
    return FILLABLE_FIELD_NAMES[canonical] || canonical
  }

  function pageKindName(kind) {
    return PAGE_KIND_NAMES[kind] || kind || 'This page'
  }

  function formatDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(iso)
  }

  /* ------------------------------------------------------------------ */
  /* state machine                                                      */
  /* ------------------------------------------------------------------ */

  function setPetState(next, text) {
    state.petState = next
    if (typeof text === 'string') state.statusText = text
    updatePetClasses()
    updateStatusAnnouncement()
  }

  function computePageState() {
    if (!AgentCore) return
    const classified = AgentCore.classifyUrl(location.href)
    if (classified.adapter === 'none') {
      state.page = null
      return
    }
    const kind = AgentCore.classifyPageKind({
      adapter: classified.adapter,
      headings: [],
      labels: [],
      hasPasswordField: !!document.querySelector('input[type="password"]'),
    })
    state.page = {
      adapter: classified.adapter,
      official: classified.official,
      fixture: classified.fixture,
      kind,
      supported: AgentCore.isFillablePageKind(kind),
      url: AgentCore.sanitizeUrl(location.href),
    }
  }

  /* ------------------------------------------------------------------ */
  /* shadow DOM markup                                                  */
  /* ------------------------------------------------------------------ */

  function buildStyles() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      #formlee-pet-wrapper {
        position: fixed;
        right: 0; bottom: 0;
        width: 0; height: 0;
        z-index: 2147483640;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
        color: #111827;
        --fp-primary: #4f46e5;
        --fp-primary-light: #6366f1;
        --fp-primary-ghost: #eef2ff;
        --fp-good: #16a34a;
        --fp-warn: #d97706;
        --fp-error: #dc2626;
        --fp-surface: #ffffff;
        --fp-border: #e5e7eb;
        --fp-muted: #6b7280;
        --fp-shadow: 0 20px 50px rgba(0,0,0,0.15);
      }
      #formlee-pet {
        position: absolute;
        right: 0; bottom: 0;
        width: 64px; height: 64px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--fp-primary), #818cf8);
        box-shadow: 0 10px 25px rgba(79,70,229,0.35);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        user-select: none;
        transition: transform .2s ease, box-shadow .2s ease, opacity .2s ease, filter .2s ease;
        pointer-events: auto;
      }
      #formlee-pet:hover { transform: scale(1.05); box-shadow: 0 14px 34px rgba(79,70,229,0.42); }
      #formlee-pet:active { transform: scale(0.97); }
      #formlee-pet.minimized { transform: scale(0.5); }
      #formlee-pet.minimized:hover { transform: scale(0.58); }

      .pet-face { width: 44px; height: 44px; overflow: visible; }
      .pet-body { }
      .pet-antenna-line { stroke: #ffffff; stroke-width: 3; fill: none; stroke-linecap: round; }
      .pet-antenna-bulb { fill: #c7d2fe; }
      .pet-eye { fill: #1f2937; }
      .pet-mouth { stroke: #4b5563; stroke-width: 2.8; fill: none; stroke-linecap: round; }
      .pet-cap { filter: drop-shadow(0 1px 1px rgba(0,0,0,0.15)); }
      .pet-cap-tassel { animation: tasselSway 2.5s ease-in-out infinite; transform-origin: 34px 35px; }

      /* states */
      .state-scanning .pet-antenna-bulb { animation: antennaPulse 1s infinite; fill: #a5b4fc; }
      .state-scanning .pet-eye { animation: lookAround 1.4s infinite; }
      .state-scanning .pet-cap-tassel { animation: tasselSway 0.6s ease-in-out infinite; }
      .state-analyzing .pet-eye { transform: scaleY(0.5); transform-origin: center; }
      .state-reviewing .pet-mouth { d: path("M26 46 Q32 44 38 46"); }
      .state-waiting .pet-eye { opacity: 0.6; }
      .state-filling .pet-eye { transform: scaleY(0.4); transform-origin: center; }
      .state-filling .pet-mouth { stroke: #374151; }
      .state-verifying .pet-eye { transform: scaleY(0.6); transform-origin: center; }
      .state-completed { background: linear-gradient(135deg, var(--fp-good), #4ade80); box-shadow: 0 10px 25px rgba(22,163,74,0.35); }
      .state-completed .pet-mouth { d: path("M24 43 Q32 51 40 43"); stroke: #14532d; }
      .state-completed .pet-eye { fill: #14532d; }
      .state-needs-attention { background: linear-gradient(135deg, var(--fp-warn), #fbbf24); box-shadow: 0 10px 25px rgba(217,119,6,0.35); }
      .state-needs-attention .pet-eye { fill: #78350f; }
      .state-needs-attention .pet-mouth { stroke: #78350f; }
      .state-unsupported { background: linear-gradient(135deg, #9ca3af, #d1d5db); box-shadow: 0 10px 25px rgba(107,114,128,0.25); }
      .state-unsupported .pet-eye { fill: #4b5563; }
      .state-unsupported .pet-mouth { stroke: #4b5563; }
      .state-error { background: linear-gradient(135deg, var(--fp-error), #f87171); box-shadow: 0 10px 25px rgba(220,38,38,0.35); }
      .state-error .pet-eye { fill: #7f1d1d; }
      .state-error .pet-mouth { stroke: #7f1d1d; }

      @keyframes antennaPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      @keyframes lookAround { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
      @keyframes gentleBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      @keyframes tasselSway { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
      .state-idle, .state-greeting, .state-ready { animation: gentleBob 3s ease-in-out infinite; }
      .state-scanning::after {
        content: ''; position: absolute; inset: -8px;
        border-radius: 50%; border: 2px solid rgba(255,255,255,0.5);
        animation: radar 1.5s linear infinite;
      }
      @keyframes radar { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }

      .pet-badge {
        position: absolute; top: -2px; right: -2px;
        min-width: 18px; height: 18px; padding: 0 5px;
        border-radius: 9px; background: var(--fp-error); color: #fff;
        font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
        border: 2px solid #fff; display: none;
      }
      .pet-badge.visible { display: block; }

      /* panel */
      #formlee-pet-panel {
        position: absolute;
        right: 0; bottom: 76px;
        width: 360px; max-width: calc(100vw - 32px);
        max-height: min(640px, calc(100vh - 120px));
        background: var(--fp-surface);
        border: 1px solid var(--fp-border);
        border-radius: 16px;
        box-shadow: var(--fp-shadow);
        display: none; flex-direction: column;
        overflow: hidden;
      }
      #formlee-pet-panel.open { display: flex; }
      #formlee-pet-panel.panel-left { right: auto; left: 0; }

      .panel-header {
        padding: 14px 16px; border-bottom: 1px solid var(--fp-border);
        display: flex; align-items: flex-start; gap: 10px;
      }
      .panel-brand {
        width: 28px; height: 28px; border-radius: 50%;
        background: linear-gradient(135deg, var(--fp-primary), #818cf8);
        color: #fff; display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 14px;
      }
      .panel-title { flex: 1; }
      .panel-title h2 { margin: 0; font-size: 15px; font-weight: 700; }
      .panel-title p { margin: 2px 0 0; font-size: 12px; color: var(--fp-muted); }
      .panel-close {
        background: transparent; border: none; cursor: pointer; color: var(--fp-muted);
        font-size: 20px; line-height: 1; padding: 4px; border-radius: 6px;
      }
      .panel-close:hover, .panel-close:focus { background: #f3f4f6; color: #111827; }
      .panel-tabs {
        display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--fp-border);
      }
      .panel-tab {
        flex: 1; padding: 8px 4px; background: transparent; border: none;
        border-bottom: 2px solid transparent; cursor: pointer; font-size: 12px; font-weight: 600;
        color: var(--fp-muted);
      }
      .panel-tab.active { color: var(--fp-primary); border-bottom-color: var(--fp-primary); }
      .panel-tab:focus-visible { outline: 2px solid var(--fp-primary); outline-offset: -2px; border-radius: 4px; }
      .panel-body { padding: 12px 14px; overflow-y: auto; flex: 1; }
      .panel-footer { padding: 10px 14px; border-top: 1px solid var(--fp-border); font-size: 11px; color: var(--fp-muted); }

      .status-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
      }
      .status-chip.connected { background: #dcfce7; color: #166534; }
      .status-chip.disconnected { background: #fee2e2; color: #991b1b; }
      .status-chip.adapter { background: #eef2ff; color: #3730a3; }

      .panel-section { margin-bottom: 14px; }
      .panel-section-title { font-size: 12px; font-weight: 700; color: #374151; margin: 0 0 8px; }
      .panel-hint { font-size: 12px; color: var(--fp-muted); line-height: 1.45; }
      .panel-error { font-size: 12px; color: var(--fp-error); background: #fef2f2; padding: 8px 10px; border-radius: 8px; }
      .panel-success { font-size: 12px; color: var(--fp-good); background: #f0fdf4; padding: 8px 10px; border-radius: 8px; }

      .action-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .fp-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 8px 12px; border-radius: 8px; border: 1px solid var(--fp-border);
        background: #fff; color: #111827; font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .fp-btn:hover, .fp-btn:focus { background: #f9fafb; }
      .fp-btn.primary { background: var(--fp-primary); border-color: var(--fp-primary); color: #fff; }
      .fp-btn.primary:hover, .fp-btn.primary:focus { background: var(--fp-primary-dark, #4338ca); }
      .fp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .plan-summary { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
      .plan-chip {
        font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #f3f4f6; color: #374151;
      }
      .plan-chip.mapped { background: #dcfce7; color: #166534; }
      .plan-chip.ambiguous { background: #fef3c7; color: #92400e; }
      .plan-chip.unsafe { background: #fee2e2; color: #991b1b; }

      .plan-item {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 8px 0; border-bottom: 1px solid #f3f4f6;
      }
      .plan-item:last-child { border-bottom: none; }
      .plan-status {
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
        padding: 2px 6px; border-radius: 4px; white-space: nowrap;
      }
      .plan-status.mapped { background: #dcfce7; color: #166534; }
      .plan-status.ambiguous { background: #fef3c7; color: #92400e; }
      .plan-status.manual { background: #f3f4f6; color: #4b5563; }
      .plan-status.unsafe { background: #fee2e2; color: #991b1b; }
      .plan-status.unmapped { background: #f3f4f6; color: #6b7280; }
      .plan-item-main { flex: 1; min-width: 0; }
      .plan-label { font-size: 12px; font-weight: 600; color: #111827; }
      .plan-kind { font-weight: 400; color: var(--fp-muted); }
      .plan-group { font-size: 11px; color: var(--fp-muted); }
      .plan-mapping { font-size: 11px; color: #374151; margin-top: 2px; }
      .plan-value { font-size: 11px; color: var(--fp-primary); font-weight: 600; }
      .plan-check { margin-top: 2px; }
      .plan-check input { cursor: pointer; }

      .missing-list { list-style: none; margin: 0; padding: 0; }
      .missing-list li { padding: 6px 0; font-size: 12px; border-bottom: 1px solid #f3f4f6; }

      .readiness-app { border: 1px solid var(--fp-border); border-radius: 10px; padding: 10px; margin-bottom: 10px; }
      .readiness-app-title { font-size: 12px; font-weight: 700; margin: 0 0 4px; display: flex; align-items: center; gap: 6px; }
      .readiness-state { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 999px; }
      .readiness-state.ready { background: #dcfce7; color: #166534; }
      .readiness-state.partially { background: #fef3c7; color: #92400e; }
      .readiness-state.missing { background: #ffedd5; color: #9a3412; }
      .readiness-state.confirmation { background: #e0f2fe; color: #075985; }
      .readiness-state.document { background: #fee2e2; color: #991b1b; }
      .readiness-state.na { background: #f3f4f6; color: #4b5563; }
      .readiness-list { list-style: none; margin: 8px 0 0; padding: 0; }
      .readiness-list li { padding: 4px 0; font-size: 11px; color: #374151; border-bottom: 1px solid #f3f4f6; }
      .readiness-list li:last-child { border-bottom: none; }
      .readiness-severity { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; margin-right: 4px; }
      .readiness-severity.urgent { background: #fee2e2; color: #991b1b; }
      .readiness-severity.warning { background: #fef3c7; color: #92400e; }
      .readiness-severity.info { background: #e0f2fe; color: #075985; }

      .setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
      .setting-row label { font-size: 12px; }

      .doc-group { margin-bottom: 12px; }
      .doc-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; margin: 0 0 4px; }
      .doc-list { list-style: none; margin: 0; padding: 0; }
      .doc-list li { padding: 5px 0; font-size: 12px; border-bottom: 1px solid #f3f4f6; }
      .doc-current { font-size: 10px; font-weight: 700; color: #16a34a; background: #dcfce7; padding: 1px 5px; border-radius: 999px; margin-left: 6px; }

      /* context menu */
      #formlee-pet-menu {
        position: absolute;
        right: 0; bottom: 76px;
        width: 220px; max-width: calc(100vw - 32px);
        background: var(--fp-surface);
        border: 1px solid var(--fp-border);
        border-radius: 12px;
        box-shadow: var(--fp-shadow);
        display: none; flex-direction: column;
        padding: 6px;
      }
      #formlee-pet-menu.open { display: flex; }
      .menu-item {
        padding: 8px 12px; border-radius: 8px; cursor: pointer;
        font-size: 13px; color: #111827; background: transparent; border: none; text-align: left;
      }
      .menu-item:hover, .menu-item:focus {
        background: var(--fp-primary-ghost); color: var(--fp-primary); outline: none;
      }
      .menu-item.danger:hover, .menu-item.danger:focus { background: #fef2f2; color: var(--fp-error); }
      .menu-sep { height: 1px; background: var(--fp-border); margin: 4px 6px; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
      }
    `
  }

  function buildMarkup() {
    return `
      <div id="formlee-pet-wrapper" aria-live="polite" aria-atomic="true">
        <div id="formlee-pet" role="button" tabindex="0" aria-label="Formlee Pet" aria-haspopup="menu" aria-expanded="false">
          <span class="pet-badge" aria-hidden="true"></span>
          <svg class="pet-face" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <linearGradient id="petBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#eef2ff;stop-opacity:1" />
              </linearGradient>
              <linearGradient id="petCapGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#3730a3;stop-opacity:1" />
              </linearGradient>
            </defs>
            <!-- left ear -->
            <circle class="pet-body" cx="11" cy="34" r="6" fill="url(#petBodyGrad)"/>
            <!-- right ear -->
            <circle class="pet-body" cx="53" cy="34" r="6" fill="url(#petBodyGrad)"/>
            <!-- antenna -->
            <line class="pet-antenna-line" x1="32" y1="12" x2="32" y2="4"/>
            <circle class="pet-antenna-bulb" cx="32" cy="4" r="3"/>
            <!-- head -->
            <rect class="pet-body" x="12" y="16" width="40" height="38" rx="18" ry="18" fill="url(#petBodyGrad)"/>
            <!-- graduation cap -->
            <path class="pet-cap" d="M14 22 L32 14 L50 22 L32 30 Z" fill="url(#petCapGrad)"/>
            <rect class="pet-cap" x="30" y="28" width="4" height="7" fill="#312e81"/>
            <circle class="pet-cap-tassel" cx="34" cy="35" r="1.8" fill="#fbbf24"/>
            <!-- eyes -->
            <ellipse class="pet-eye" cx="24" cy="36" rx="3.8" ry="4.8"/>
            <ellipse class="pet-eye" cx="40" cy="36" rx="3.8" ry="4.8"/>
            <!-- blush -->
            <circle cx="19" cy="43" r="2.2" fill="#fca5a5" opacity="0.6"/>
            <circle cx="45" cy="43" r="2.2" fill="#fca5a5" opacity="0.6"/>
            <!-- mouth -->
            <path class="pet-mouth" d="M27 47 Q32 52 37 47"/>
            <!-- F emblem -->
            <text x="32" y="30" text-anchor="middle" font-size="8" font-weight="800" fill="#4f46e5" font-family="ui-sans-serif, system-ui, sans-serif">F</text>
          </svg>
        </div>
        <div id="formlee-pet-panel" role="dialog" aria-modal="true" aria-label="Formlee assistant panel" tabindex="-1">
          <div class="panel-header">
            <div class="panel-brand" aria-hidden="true">F</div>
            <div class="panel-title">
              <h2>Formlee AI</h2>
              <p id="fp-page-line">Checking page…</p>
            </div>
            <button class="panel-close" aria-label="Close panel">×</button>
          </div>
          <div class="panel-tabs" role="tablist" aria-label="Assistant tabs">
            <button class="panel-tab active" data-tab="plan" role="tab" aria-selected="true">Plan</button>
            <button class="panel-tab" data-tab="readiness" role="tab" aria-selected="false">Ready</button>
            <button class="panel-tab" data-tab="documents" role="tab" aria-selected="false">Docs</button>
            <button class="panel-tab" data-tab="missing" role="tab" aria-selected="false">Missing</button>
            <button class="panel-tab" data-tab="settings" role="tab" aria-selected="false">…</button>
          </div>
          <div class="panel-body" id="fp-panel-body"></div>
          <div class="panel-footer">Formlee never submits, pays, uploads, or bypasses CAPTCHA/OTP.</div>
        </div>
        <div id="formlee-pet-menu" role="menu" aria-label="Formlee actions"></div>
      </div>
    `
  }

  /* ------------------------------------------------------------------ */
  /* mount                                                              */
  /* ------------------------------------------------------------------ */

  async function mount() {
    if (host) return
    host = document.createElement('div')
    host.id = 'formlee-pet-host'
    host.style.all = 'initial'
    shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>' + buildStyles() + '</style>' + buildMarkup()
    document.body.appendChild(host)

    wrapper = shadow.getElementById('formlee-pet-wrapper')
    petEl = shadow.getElementById('formlee-pet')
    panelEl = shadow.getElementById('formlee-pet-panel')
    menuEl = shadow.getElementById('formlee-pet-menu')

    wirePetInteractions()
    wirePanelInteractions()
    wireMenuInteractions()

    state.mounted = true
    applyStoredState()
    computePageState()
    refreshSession()
    refreshProfileStatus()
    updatePetClasses()
    renderPanel()
    updateHostVisibility()
    setPetState(state.page ? 'ready' : 'unsupported', state.page ? 'Ready on a supported page.' : 'This page is not supported.')
  }

  function applyStoredState() {
    readStorage().then(saved => {
      if (saved && typeof saved === 'object') {
        if (saved.hidden === true) setHidden(true)
        if (saved.minimized === true) setMinimized(true)
        if (saved.reducedMotion === true) setReducedMotion(true)
        if (saved.position && typeof saved.position === 'object') {
          state.position = saved.position
          applyPosition()
        }
      }
    })
  }

  function applyPosition() {
    if (!wrapper) return
    const pos = state.position
    if (typeof pos.left === 'number' || typeof pos.top === 'number') {
      wrapper.style.left = (typeof pos.left === 'number' ? pos.left + 'px' : 'auto')
      wrapper.style.top = (typeof pos.top === 'number' ? pos.top + 'px' : 'auto')
      wrapper.style.right = 'auto'
      wrapper.style.bottom = 'auto'
    } else {
      wrapper.style.left = 'auto'
      wrapper.style.top = 'auto'
      wrapper.style.right = (typeof pos.right === 'number' ? pos.right + 'px' : '24px')
      wrapper.style.bottom = (typeof pos.bottom === 'number' ? pos.bottom + 'px' : '24px')
    }
  }

  /* ------------------------------------------------------------------ */
  /* interactions                                                       */
  /* ------------------------------------------------------------------ */

  function wirePetInteractions() {
    let dragging = false
    let hasDragged = false
    let startX = 0
    let startY = 0
    let startRect = null

    petEl.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      dragging = true
      hasDragged = false
      startX = event.clientX
      startY = event.clientY
      startRect = wrapper.getBoundingClientRect()
      petEl.setPointerCapture(event.pointerId)
      petEl.style.cursor = 'grabbing'
    })

    petEl.addEventListener('pointermove', event => {
      if (!dragging) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true
      const x = Math.min(Math.max(0, startRect.left + dx), window.innerWidth - 64)
      const y = Math.min(Math.max(0, startRect.top + dy), window.innerHeight - 64)
      wrapper.style.left = x + 'px'
      wrapper.style.top = y + 'px'
      wrapper.style.right = 'auto'
      wrapper.style.bottom = 'auto'
      state.position = { left: x, top: y }
    })

    petEl.addEventListener('pointerup', event => {
      if (!dragging) return
      dragging = false
      petEl.releasePointerCapture(event.pointerId)
      petEl.style.cursor = 'pointer'
      if (hasDragged) {
        writeStorage({ position: state.position })
      }
    })

    petEl.addEventListener('click', event => {
      if (hasDragged) return
      if (state.menuOpen) { closeMenu(); return }
      if (state.minimized) { setMinimized(false); return }
      togglePanel()
    })

    petEl.addEventListener('contextmenu', event => {
      event.preventDefault()
      openMenu(event.clientX, event.clientY)
    })

    petEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        togglePanel()
      } else if (event.key === 'ArrowDown' || event.key === 'ContextMenu') {
        event.preventDefault()
        openMenu()
      }
    })
  }

  function wirePanelInteractions() {
    const closeBtn = shadow.querySelector('.panel-close')
    closeBtn.addEventListener('click', closePanel)

    shadow.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab
        renderPanel()
      })
    })

    panelEl.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closePanel()
        petEl.focus()
      }
    })

    const body = shadow.getElementById('fp-panel-body')
    body.addEventListener('change', event => {
      if (event.target && event.target.classList.contains('fp-approve-check')) {
        updateFillButton()
      }
    })
    body.addEventListener('click', event => {
      const btn = event.target.closest('[data-action]')
      if (!btn) return
      handlePanelAction(btn.dataset.action, btn)
    })
  }

  function wireMenuInteractions() {
    menuEl.addEventListener('keydown', event => {
      const items = Array.from(menuEl.querySelectorAll('.menu-item'))
      const active = shadow.activeElement
      const idx = items.indexOf(active)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = items[(idx + 1) % items.length]
        next.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const prev = items[(idx - 1 + items.length) % items.length]
        prev.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        items[0].focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (event.key === 'Escape') {
        closeMenu()
        petEl.focus()
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        active.click()
      }
    })

    menuEl.addEventListener('click', event => {
      const item = event.target.closest('.menu-item')
      if (!item) return
      handleMenuAction(item.dataset.action)
      closeMenu()
    })
  }

  function closeMenuOnOutside(event) {
    if (!state.menuOpen) return
    const path = event.composedPath ? event.composedPath() : []
    if (!path.includes(menuEl) && !path.includes(petEl)) {
      closeMenu()
    }
  }

  /* ------------------------------------------------------------------ */
  /* menu / panel actions                                               */
  /* ------------------------------------------------------------------ */

  function handleMenuAction(action) {
    switch (action) {
      case 'scan':
        openPanel('plan')
        runScan()
        break
      case 'fill':
        if (state.plan && !state.fillResult) {
          openPanel('plan')
        } else {
          openPanel('plan')
          runScan()
        }
        break
      case 'view':
        if (state.plan) {
          openPanel('plan')
        } else {
          openPanel('plan')
          runScan()
        }
        break
      case 'explain':
        openPanel('plan')
        explainSelectedField()
        break
      case 'resume':
        openPanel('plan')
        resumeInterruptedTask()
        break
      case 'readiness':
        openPanel('readiness')
        refreshReadiness()
        break
      case 'missing':
        openPanel('missing')
        refreshMissing()
        break
      case 'profile':
        sendRuntime({ type: 'OPEN_PROFILE' })
        break
      case 'hub':
        sendRuntime({ type: 'OPEN_HUB' })
        break
      case 'settings':
        openPanel('settings')
        break
      case 'hide':
        setHidden(true)
        break
    }
  }

  function handlePanelAction(action, btn) {
    if (action === 'scan') {
      runScan()
    } else if (action === 'fill') {
      runFill()
    } else if (action === 'discard') {
      state.plan = null
      state.values = {}
      state.fillResult = null
      setPetState('ready', 'Plan discarded. Scan again when you are ready.')
      renderPanel()
    } else if (action === 'close-results') {
      state.fillResult = null
      renderPanel()
    } else if (action === 'close-explanation') {
      state.explaining = null
      renderPanel()
    } else if (action === 'explain-field') {
      const index = Number(btn.dataset.index)
      if (state.plan && state.plan.items) {
        state.explaining = state.plan.items.find(item => item.index === index) || null
      }
      renderPanel()
    } else if (action === 'check-missing') {
      refreshMissing()
    } else if (action === 'check-readiness') {
      refreshReadiness()
    } else if (action === 'check-documents') {
      refreshDocuments()
    } else if (action === 'open-application') {
      sendRuntime({ type: 'OPEN_APPLICATION', applicationId: btn.dataset.id })
    } else if (action === 'reset-position') {
      state.position = { right: 24, bottom: 24 }
      applyPosition()
      writeStorage({ position: state.position })
    } else if (action === 'toggle-reduced-motion') {
      setReducedMotion(!state.reducedMotion)
    } else if (action === 'unhide') {
      sendRuntime({ type: 'SHOW_PET' })
      setHidden(false)
    }
  }

  /* ------------------------------------------------------------------ */
  /* visual state helpers                                               */
  /* ------------------------------------------------------------------ */

  function setHidden(hidden) {
    state.hidden = hidden
    writeStorage({ hidden })
    updateHostVisibility()
  }

  /** Visibility = user "hide" choice + panel-primary suppression combined. */
  function updateHostVisibility() {
    if (!host) return
    const suppressed = state.panelSurface === 'panel'
    const hidden = state.hidden || suppressed
    host.style.display = hidden ? 'none' : 'block'
  }

  function setPanelSurface(surface) {
    state.panelSurface = surface === 'panel' ? 'panel' : 'floating'
    updateHostVisibility()
    if (suppressed()) closeMenu()
  }

  function suppressed() {
    return state.panelSurface === 'panel'
  }

  function listenForPanelSurface() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return
        const change = changes[SURFACE_KEY] || changes[LEGACY_SURFACE_KEY]
        if (!change) return
        setPanelSurface(change.newValue)
      })
      chrome.storage.local.get([SURFACE_KEY, LEGACY_SURFACE_KEY], result => {
        const surface = result && (result[SURFACE_KEY] || result[LEGACY_SURFACE_KEY])
        setPanelSurface(surface)
        if (surface && !result[SURFACE_KEY]) {
          chrome.storage.local.set({ [SURFACE_KEY]: surface }, () => {
            chrome.storage.local.remove(LEGACY_SURFACE_KEY)
          })
        }
      })
    } catch (error) {
      // Without the surface flag the floating pet keeps its default
      // behaviour; suppression is a nicety, not a safety requirement.
    }
  }

  function setMinimized(minimized) {
    state.minimized = minimized
    petEl.classList.toggle('minimized', minimized)
    writeStorage({ minimized })
  }

  function setReducedMotion(on) {
    state.reducedMotion = on
    if (on) {
      wrapper.classList.add('reduce-motion')
      const style = document.createElement('style')
      style.id = 'fp-reduce-motion'
      style.textContent = '#formlee-pet-host * { animation: none !important; transition: none !important; }'
      shadow.appendChild(style)
    } else {
      wrapper.classList.remove('reduce-motion')
      const existing = shadow.getElementById('fp-reduce-motion')
      if (existing) existing.remove()
    }
    writeStorage({ reducedMotion: on })
    renderPanel()
  }

  function openPanel(tab) {
    state.activeTab = tab || 'plan'
    state.panelOpen = true
    panelEl.classList.add('open')
    petEl.setAttribute('aria-expanded', 'true')
    positionPanel()
    renderPanel()
  }

  function closePanel() {
    state.panelOpen = false
    panelEl.classList.remove('open')
    petEl.setAttribute('aria-expanded', 'false')
  }

  function togglePanel() {
    if (state.panelOpen) closePanel()
    else openPanel('plan')
  }

  function openMenu(clientX, clientY) {
    renderMenu()
    state.menuOpen = true
    menuEl.classList.add('open')
    petEl.setAttribute('aria-expanded', 'true')
    positionMenu(clientX, clientY)
    const first = menuEl.querySelector('.menu-item')
    if (first) setTimeout(() => first.focus(), 0)
    document.addEventListener('click', closeMenuOnOutside, { capture: true, once: false })
    document.addEventListener('scroll', closeMenu, { capture: true, once: true })
  }

  function closeMenu() {
    state.menuOpen = false
    menuEl.classList.remove('open')
    petEl.setAttribute('aria-expanded', String(state.panelOpen))
    document.removeEventListener('click', closeMenuOnOutside, { capture: true })
    document.removeEventListener('scroll', closeMenu, { capture: true })
  }

  function positionPanel() {
    const rect = wrapper.getBoundingClientRect()
    const panelWidth = 360
    if (rect.left + panelWidth > window.innerWidth - 16) {
      panelEl.classList.add('panel-left')
    } else {
      panelEl.classList.remove('panel-left')
    }
  }

  function positionMenu(clientX, clientY) {
    const rect = wrapper.getBoundingClientRect()
    menuEl.style.right = 'auto'
    menuEl.style.left = 'auto'
    menuEl.style.bottom = '76px'
    const menuWidth = 220
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      // menu near cursor relative to wrapper
      const relX = clientX - rect.left
      const relY = clientY - rect.top
      if (relX < 0) menuEl.style.left = Math.max(8, relX) + 'px'
      else menuEl.style.right = Math.max(8, rect.width - relX) + 'px'
      menuEl.style.bottom = Math.max(76, rect.height - relY) + 'px'
    }
    if (rect.left + menuWidth > window.innerWidth - 16) {
      menuEl.classList.add('panel-left')
    } else {
      menuEl.classList.remove('panel-left')
    }
  }

  function updatePetClasses() {
    if (!petEl) return
    const classes = [
      'state-idle', 'state-greeting', 'state-ready', 'state-scanning', 'state-analyzing',
      'state-reviewing', 'state-waiting', 'state-filling', 'state-verifying',
      'state-completed', 'state-needs-attention', 'state-unsupported', 'state-error',
    ]
    petEl.classList.remove(...classes)
    petEl.classList.add('state-' + state.petState)
  }

  function updateStatusAnnouncement() {
    if (!wrapper) return
    wrapper.setAttribute('aria-label', state.statusText)
  }

  /* ------------------------------------------------------------------ */
  /* agent operations                                                   */
  /* ------------------------------------------------------------------ */

  async function refreshSession() {
    const response = await sendRuntime({ type: 'STATUS' })
    state.session.connected = !!(response && response.connected)
    state.session.expiresAt = response && response.expiresAt ? response.expiresAt : null
    updateConnectionUI()
    if (!state.session.connected) {
      setPetState('needs-attention', 'Not connected — pair the agent from the Formlee assistant page.')
    }
  }

  async function refreshProfileStatus() {
    const response = await sendRuntime({ type: 'PROFILE_STATUS' })
    if (response && response.ok && response.evaluation) {
      state.profileStatus = response.evaluation
      state.missing = (response.evaluation.missingLabels || []).concat(response.evaluation.needsConfirmationLabels || [])
    }
    updateBadge()
  }

  function updateBadge() {
    const badge = petEl.querySelector('.pet-badge')
    let count = 0
    if (state.profileStatus) {
      count += (state.profileStatus.missingLabels || []).length
      count += (state.profileStatus.needsConfirmationLabels || []).length
    }
    if (state.readiness) {
      for (const app of state.readiness) {
        if (app.readinessState !== 'READY' && app.readinessState !== 'NOT_APPLICABLE') count++
      }
    }
    badge.textContent = count > 9 ? '9+' : String(count)
    badge.classList.toggle('visible', count > 0)
  }

  function updateConnectionUI() {
    if (!panelEl) return
    const pageLine = shadow.getElementById('fp-page-line')
    if (!pageLine) return
    const page = state.page
    const connected = state.session.connected
    const chips = []
    if (connected) chips.push('<span class="status-chip connected">● Connected</span>')
    else chips.push('<span class="status-chip disconnected">● Not connected</span>')
    if (page) chips.push('<span class="status-chip adapter">' + escapeText(page.adapter) + '</span>')
    let text = chips.join(' ')
    if (page) text += ' · ' + escapeText(pageKindName(page.kind))
    pageLine.innerHTML = text
  }

  async function explainSelectedField() {
    if (state.plan && state.plan.items && state.plan.items.length > 0) {
      const target =
        state.plan.items.find(item => item.status === 'ambiguous') ||
        state.plan.items.find(item => item.status === 'mapped')
      if (target) {
        state.explaining = target
        renderPanel()
        setPetState('reviewing', 'Here is what I know about the selected field.')
        return
      }
    }
    setPetState('needs-attention', 'Scan the form first, then ask me to explain a field.')
    state.scanError = 'Scan the form first to see explainable fields.'
    renderPanel()
  }

  async function resumeInterruptedTask() {
    if (state.plan) {
      openPanel('plan')
      setPetState('reviewing', 'Resumed your previous plan. Review and approve when ready.')
      return
    }
    const response = await sendRuntime({ type: 'GET_PLAN_CONTEXT' })
    if (response && response.ok && response.plan) {
      state.plan = response.plan
      state.page = response.page || state.page
      await fetchPlanValues()
      setPetState('reviewing', 'Resumed your previous plan. Review and approve when ready.')
      renderPanel()
    } else {
      runScan()
    }
  }

  async function runScan() {
    if (state.scanning || state.filling) return
    state.scanning = true
    state.plan = null
    state.values = {}
    state.fillResult = null
    state.explaining = null
    setPetState('scanning', 'Scanning this form…')
    renderPanel()

    const response = await sendRuntime({ type: 'SCAN' })
    state.scanning = false

    if (!response || !response.ok) {
      setPetState('error', response.error || 'Scan failed.')
      state.scanError = response.error || 'Scan failed.'
      renderPanel()
      return
    }

    state.page = response.page || state.page
    if (!response.plan) {
      const note = response.note || 'No fillable fields were found on this page.'
      setPetState(response.page && response.page.supported ? 'needs-attention' : 'unsupported', note)
      state.plan = null
      state.scanError = note
      renderPanel()
      return
    }

    state.plan = response.plan
    state.scanError = null
    setPetState('analyzing', 'Analyzing detected fields…')
    await fetchPlanValues()
    setPetState('reviewing', response.plan.counts.mapped + ' field' + (response.plan.counts.mapped === 1 ? '' : 's') + ' ready to review.')
    renderPanel()
  }

  async function fetchPlanValues() {
    if (!state.plan) return
    const mapped = state.plan.items.filter(item => item.status === 'mapped' && typeof item.canonical === 'string')
    if (mapped.length === 0) return
    const canonicals = mapped.map(item => item.canonical)
    const response = await sendRuntime({ type: 'VALUES', fields: canonicals })
    if (response && response.ok && response.values) {
      state.values = response.values
    }
  }

  async function refreshMissing() {
    state.missing = []
    const response = await sendRuntime({ type: 'PROFILE_STATUS' })
    if (response && response.ok && response.evaluation) {
      state.profileStatus = response.evaluation
      state.missing = (response.evaluation.missingLabels || []).concat(response.evaluation.needsConfirmationLabels || [])
    }
    updateBadge()
    renderPanel()
  }

  async function refreshReadiness() {
    state.readinessLoading = true
    state.readiness = null
    renderPanel()
    const response = await sendRuntime({ type: 'READINESS_SUMMARY' })
    state.readinessLoading = false
    if (response && response.ok && Array.isArray(response.applications)) {
      state.readiness = response.applications
    }
    renderPanel()
  }

  async function refreshDocuments() {
    state.documentsLoading = true
    state.documents = null
    renderPanel()
    const response = await sendRuntime({ type: 'DOCUMENTS_LIST' })
    state.documentsLoading = false
    if (response && response.ok && Array.isArray(response.documents)) {
      state.documents = response.documents
    }
    renderPanel()
  }

  function approvedItems() {
    if (!state.plan || state.fillResult) return []
    const checked = new Set(
      Array.from(shadow.querySelectorAll('.fp-approve-check:checked')).map(input => Number(input.dataset.index))
    )
    return state.plan.items.filter(item => item.status === 'mapped' && checked.has(item.index))
  }

  function updateFillButton() {
    const btn = shadow.getElementById('fp-fill-btn')
    if (!btn) return
    const count = approvedItems().length
    btn.disabled = count === 0 || state.filling
    btn.textContent = count === 0 ? 'Select fields to fill' : 'Fill ' + count + ' approved field' + (count === 1 ? '' : 's')
  }

  async function runFill() {
    const approved = approvedItems()
    if (approved.length === 0 || state.filling) return
    state.filling = true
    setPetState('filling', 'Filling approved fields…')
    renderPanel()

    const response = await sendRuntime({
      type: 'FILL',
      approved: approved.map(item => ({ index: item.index, canonical: item.canonical })),
    })

    state.filling = false
    state.plan = null // Plan is single-use; clear it locally after fill attempt.
    state.explaining = null
    if (!response || !response.ok) {
      setPetState('error', response.error || 'Fill failed.')
      state.fillResult = { error: response.error || 'Fill failed.', results: [] }
      renderPanel()
      return
    }

    setPetState('verifying', 'Verifying filled values…')
    await new Promise(resolve => setTimeout(resolve, state.reducedMotion ? 0 : 400))
    state.fillResult = response
    const filled = response.filled || 0
    const total = response.results ? response.results.length : 0
    setPetState('completed', 'Filled ' + filled + ' of ' + total + ' fields. Nothing was submitted.')
    renderPanel()
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                          */
  /* ------------------------------------------------------------------ */

  function renderPanel() {
    if (!panelEl) return
    updateConnectionUI()
    shadow.querySelectorAll('.panel-tab').forEach(tab => {
      const active = tab.dataset.tab === state.activeTab
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
    })
    const body = shadow.getElementById('fp-panel-body')
    if (state.activeTab === 'plan') body.innerHTML = buildPlanTab()
    else if (state.activeTab === 'readiness') body.innerHTML = buildReadinessTab()
    else if (state.activeTab === 'documents') body.innerHTML = buildDocumentsTab()
    else if (state.activeTab === 'missing') body.innerHTML = buildMissingTab()
    else body.innerHTML = buildSettingsTab()
    if (state.activeTab === 'plan') updateFillButton()
  }

  function buildPlanTab() {
    if (!state.session.connected) {
      return `
        <div class="panel-section">
          <p class="panel-hint">The agent is not connected. Open the Formlee assistant page, generate a pairing code, and pair this browser.</p>
          <div class="action-row"><button class="fp-btn primary" data-action="profile">Open assistant page</button></div>
        </div>
      `
    }
    if (state.scanning) {
      return '<div class="panel-section"><p class="panel-hint">Scanning the current page and building a fill plan…</p></div>'
    }
    if (state.fillResult && state.fillResult.error) {
      return `
        <div class="panel-section">
          <p class="panel-error">${escapeText(state.fillResult.error)}</p>
          <div class="action-row"><button class="fp-btn" data-action="scan">Scan again</button></div>
        </div>
      `
    }
    if (state.fillResult && state.fillResult.results) {
      const filled = state.fillResult.filled || 0
      const total = state.fillResult.results.length
      let html = '<div class="panel-section"><p class="panel-success">Filled ' + filled + ' of ' + total + ' approved fields. Nothing was submitted.</p>'
      html += '<div class="action-row"><button class="fp-btn" data-action="close-results">Close results</button><button class="fp-btn primary" data-action="scan">Scan again</button></div></div>'
      return html
    }
    if (!state.plan) {
      return `
        <div class="panel-section">
          <p class="panel-hint">${state.scanError ? escapeText(state.scanError) : 'Scan this form to see which fields Formlee can fill from your Student Information Vault.'}</p>
          <div class="action-row">
            <button class="fp-btn primary" data-action="scan" ${state.scanning ? 'disabled' : ''}>Scan this form</button>
          </div>
        </div>
      `
    }

    if (state.explaining) {
      const item = state.explaining
      let explanation = '<p><strong>' + escapeText(item.label || 'Field') + '</strong></p>'
      explanation += '<p>Status: ' + escapeText(item.status) + (item.required ? ' · required' : '') + '</p>'
      if (item.status === 'mapped' && item.canonical) {
        explanation += '<p>This field maps to <strong>' + escapeText(fieldName(item.canonical)) + '</strong> in your Student Information Vault.</p>'
        const value = state.values[item.canonical]
        if (value !== undefined && value !== null && value !== '') {
          explanation += '<p>The value that would be filled is: <strong>' + escapeText(String(value)) + '</strong></p>'
        } else {
          explanation += '<p class="panel-error">No saved value was found. Add it in your profile first.</p>'
        }
        if (item.needsReview) {
          explanation += '<p class="panel-hint">This mapping was flagged for review because the label is ambiguous or the adapter is not fully confident. Please confirm before filling.</p>'
        }
      } else if (item.status === 'ambiguous') {
        explanation += '<p>Formlee is not sure which vault field this corresponds to. It could be one of: ' + escapeText((item.ambiguous || []).map(fieldName).join(' / ')) + '.</p>'
        explanation += '<p class="panel-hint">Leave this field for manual entry or update your vault with clearer labels.</p>'
      } else if (item.status === 'unsafe') {
        explanation += '<p>This field is treated as unsafe and will never be filled automatically. Examples include CAPTCHA, OTP, password, payment and declaration fields.</p>'
      } else {
        explanation += '<p>' + escapeText(item.reason || 'No mapping was found for this field.') + '</p>'
      }
      return `
        <div class="panel-section">
          <h3 class="panel-section-title">Field explanation</h3>
          ${explanation}
          <div class="action-row"><button class="fp-btn" data-action="close-explanation">Back to plan</button></div>
        </div>
      `
    }

    const plan = state.plan
    let html = '<div class="plan-summary">'
    html += '<span class="plan-chip">' + plan.counts.detected + ' detected</span>'
    html += '<span class="plan-chip mapped">' + plan.counts.mapped + ' will fill</span>'
    if (plan.counts.ambiguous > 0) html += '<span class="plan-chip ambiguous">' + plan.counts.ambiguous + ' ambiguous</span>'
    if (plan.counts.unsafe > 0) html += '<span class="plan-chip unsafe">' + plan.counts.unsafe + ' skipped</span>'
    html += '</div>'
    if (plan.aiNote) html += '<p class="panel-hint">' + escapeText(plan.aiNote) + '</p>'
    if (plan.adapterNote) html += '<p class="panel-hint">' + escapeText(plan.adapterNote) + '</p>'

    const sorted = (plan.items || []).slice().sort((a, b) => a.index - b.index)
    html += '<div class="plan-items">'
    for (const item of sorted) {
      html += buildPlanItem(item)
    }
    html += '</div>'
    html += '<div class="action-row">'
    html += '<button id="fp-fill-btn" class="fp-btn primary" data-action="fill" disabled>Fill approved fields</button>'
    html += '<button class="fp-btn" data-action="discard">Discard plan</button>'
    html += '</div>'
    return html
  }

  function buildPlanItem(item) {
    const statusClass = item.status
    let mappingText = ''
    if (item.status === 'mapped' && item.canonical) {
      const value = state.values[item.canonical]
      mappingText = '→ ' + escapeText(fieldName(item.canonical))
      if (item.needsReview) mappingText += ' <span style="color:#b45309">(review)</span>'
      if (value !== undefined && value !== null && value !== '') {
        mappingText += '<div class="plan-value">Value: ' + escapeText(String(value)) + '</div>'
      } else {
        mappingText += '<div class="plan-value" style="color:#991b1b">No saved value</div>'
      }
    } else if (item.status === 'ambiguous') {
      mappingText = '→ choose: ' + escapeText((item.ambiguous || []).map(fieldName).join(' / '))
    } else {
      mappingText = escapeText(item.reason || '')
    }
    const checkbox = item.status === 'mapped'
      ? '<label class="plan-check"><input type="checkbox" class="fp-approve-check" data-index="' + item.index + '"' + (item.needsReview ? '' : ' checked') + '> <span>Fill</span></label>'
      : ''
    const explainButton = item.status !== 'unmapped'
      ? '<button class="fp-btn" style="padding:4px 8px;font-size:10px;margin-top:4px;" data-action="explain-field" data-index="' + item.index + '">Explain</button>'
      : ''
    return `
      <div class="plan-item">
        <span class="plan-status ${statusClass}">${item.status}</span>
        <div class="plan-item-main">
          <div class="plan-label">${escapeText(item.label || '(no label)')} <span class="plan-kind">${item.kind}${item.required ? ' · required' : ''}</span></div>
          ${item.group ? '<div class="plan-group">group: ' + escapeText(item.group) + '</div>' : ''}
          <div class="plan-mapping">${mappingText}</div>
          ${explainButton}
        </div>
        ${checkbox}
      </div>
    `
  }

  function buildMissingTab() {
    if (state.missing.length === 0 && !state.profileStatus) {
      return `
        <div class="panel-section">
          <p class="panel-hint">Check which profile fields still need your attention.</p>
          <div class="action-row"><button class="fp-btn primary" data-action="check-missing">Check missing information</button></div>
        </div>
      `
    }
    if (state.missing.length === 0) {
      return '<div class="panel-section"><p class="panel-success">No missing information in your vault.</p></div>'
    }
    let html = '<div class="panel-section"><h3 class="panel-section-title">Missing or unconfirmed</h3><ul class="missing-list">'
    for (const label of state.missing) {
      html += '<li>' + escapeText(label) + '</li>'
    }
    html += '</ul><div class="action-row"><button class="fp-btn primary" data-action="profile">Open profile</button></div></div>'
    return html
  }

  function readinessStateClass(state) {
    switch (state) {
      case 'READY': return 'ready'
      case 'PARTIALLY_READY': return 'partially'
      case 'MISSING_INFORMATION': return 'missing'
      case 'NEEDS_CONFIRMATION': return 'confirmation'
      case 'DOCUMENT_ATTENTION_REQUIRED': return 'document'
      default: return 'na'
    }
  }

  function readinessStateLabel(state) {
    switch (state) {
      case 'READY': return 'Ready'
      case 'PARTIALLY_READY': return 'Partially ready'
      case 'MISSING_INFORMATION': return 'Missing information'
      case 'NEEDS_CONFIRMATION': return 'Needs confirmation'
      case 'DOCUMENT_ATTENTION_REQUIRED': return 'Document attention'
      case 'NOT_APPLICABLE': return 'Not applicable'
      default: return state
    }
  }

  function buildDocumentsTab() {
    if (state.documentsLoading) {
      return '<div class="panel-section"><p class="panel-hint">Loading your document vault…</p></div>'
    }
    if (!state.documents) {
      return `
        <div class="panel-section">
          <p class="panel-hint">See which documents are already saved in your Student Information Vault and which ones are still needed.</p>
          <div class="action-row"><button class="fp-btn primary" data-action="check-documents">Show my documents</button></div>
        </div>
      `
    }
    if (state.documents.length === 0) {
      return `
        <div class="panel-section">
          <p class="panel-success">No documents uploaded yet.</p>
          <p class="panel-hint">Upload your photograph, signature and marksheets so Formlee can use them across applications.</p>
          <div class="action-row"><button class="fp-btn primary" data-action="profile">Upload documents</button></div>
        </div>
      `
    }

    const byType = {}
    for (const doc of state.documents) {
      const type = doc.documentType || 'Other'
      if (!byType[type]) byType[type] = []
      byType[type].push(doc)
    }

    let html = '<div class="panel-section"><h3 class="panel-section-title">Available documents</h3>'
    for (const type of Object.keys(byType).sort()) {
      html += '<div class="doc-group">'
      html += '<p class="doc-type">' + escapeText(type.replace(/_/g, ' ')) + '</p>'
      html += '<ul class="doc-list">'
      for (const doc of byType[type]) {
        const current = doc.isCurrent ? '<span class="doc-current">current</span>' : ''
        html += '<li>' + escapeText(doc.displayLabel || doc.originalName || 'Document') + ' ' + current + '</li>'
      }
      html += '</ul></div>'
    }
    html += '<div class="action-row"><button class="fp-btn primary" data-action="profile">Manage documents</button></div>'
    html += '</div>'
    return html
  }

  function buildReadinessTab() {
    if (state.readinessLoading) {
      return '<div class="panel-section"><p class="panel-hint">Loading application readiness…</p></div>'
    }
    if (!state.readiness) {
      return `
        <div class="panel-section">
          <p class="panel-hint">See what is missing, inconsistent or needs attention across your tracked applications before you start filling any form.</p>
          <div class="action-row"><button class="fp-btn primary" data-action="check-readiness">Check readiness</button></div>
        </div>
      `
    }
    if (state.readiness.length === 0) {
      return '<div class="panel-section"><p class="panel-success">No applications tracked yet. Open the Application Hub to add one.</p></div>'
    }

    const counts = { ready: 0, attention: 0 }
    for (const app of state.readiness) {
      if (app.readinessState === 'READY') counts.ready++
      else counts.attention++
    }

    let html = '<div class="panel-section">'
    html += '<p class="panel-hint">' + counts.ready + ' ready · ' + counts.attention + ' need attention</p>'

    for (const app of state.readiness) {
      html += '<div class="readiness-app">'
      html += '<p class="readiness-app-title"><span>' + escapeText(app.examIcon || '') + '</span> ' + escapeText(app.examName) + ' <span class="readiness-state ' + readinessStateClass(app.readinessState) + '">' + escapeText(readinessStateLabel(app.readinessState)) + '</span></p>'
      if (app.progressPercent !== null) {
        html += '<p class="panel-hint">' + app.progressPercent + '% of published requirements complete</p>'
      }

      const items = []
      for (const label of app.missingProfileLabels || []) items.push({ severity: 'warning', text: 'Missing profile: ' + label })
      for (const label of app.missingDocumentLabels || []) items.push({ severity: 'warning', text: 'Missing document: ' + label })
      for (const label of app.needsConfirmationLabels || []) items.push({ severity: 'info', text: 'Confirm: ' + label })
      for (const issue of app.documentIssues || []) items.push({ severity: issue.severity, text: issue.message })
      for (const issue of app.certificateIssues || []) items.push({ severity: issue.severity, text: issue.message })
      for (const issue of app.consistencyIssues || []) items.push({ severity: 'warning', text: issue.field + ' differs from vault' })
      if (app.awaitingResultsCount > 0) items.push({ severity: 'info', text: 'Class 12 result awaited — no marks required yet' })
      if (app.snapshotStale) items.push({ severity: 'warning', text: 'Vault snapshot is newer — review mapping' })

      if (items.length > 0) {
        html += '<ul class="readiness-list">'
        for (const item of items.slice(0, 5)) {
          html += '<li><span class="readiness-severity ' + escapeText(item.severity) + '">' + escapeText(item.severity) + '</span>' + escapeText(item.text) + '</li>'
        }
        if (items.length > 5) html += '<li>+' + (items.length - 5) + ' more items</li>'
        html += '</ul>'
      } else if (app.readinessState === 'READY') {
        html += '<p class="panel-success">All checked requirements are satisfied.</p>'
      }

      html += '<div class="action-row">'
      html += '<button class="fp-btn" data-action="open-application" data-id="' + escapeText(app.id) + '">Open application</button>'
      if (app.officialWebsite) {
        html += '<a class="fp-btn" href="' + escapeText(app.officialWebsite) + '" target="_blank" rel="noreferrer">Official portal</a>'
      }
      html += '</div>'

      html += '</div>'
    }

    html += '<div class="action-row"><button class="fp-btn primary" data-action="check-readiness">Refresh readiness</button></div>'
    html += '</div>'
    return html
  }

  function buildSettingsTab() {
    return `
      <div class="panel-section">
        <h3 class="panel-section-title">Appearance</h3>
        <div class="setting-row">
          <label for="fp-reduce-motion">Reduce motion</label>
          <input id="fp-reduce-motion" type="checkbox" ${state.reducedMotion ? 'checked' : ''} data-action="toggle-reduced-motion">
        </div>
      </div>
      <div class="panel-section">
        <h3 class="panel-section-title">Position</h3>
        <p class="panel-hint">Drag the pet to move it. Reset to the default bottom-right corner here.</p>
        <div class="action-row"><button class="fp-btn" data-action="reset-position">Reset position</button></div>
      </div>
      ${state.hidden ? '<div class="panel-section"><div class="action-row"><button class="fp-btn primary" data-action="unhide">Unhide pet</button></div></div>' : ''}
      <div class="panel-section">
        <h3 class="panel-section-title">Connection</h3>
        <p class="panel-hint">The assistant uses a workspace-scoped agent session. Pairing codes expire in 15 minutes.</p>
        <div class="action-row"><button class="fp-btn" data-action="profile">Open Formlee assistant</button></div>
      </div>
    `
  }

  function renderMenu() {
    let html = ''
    for (const item of MENU_ITEMS) {
      const danger = item.id === 'hide' ? ' danger' : ''
      html += '<button class="menu-item' + danger + '" data-action="' + item.id + '" role="menuitem">' + escapeText(item.label) + '</button>'
      if (item.id === 'settings') html += '<div class="menu-sep" role="separator"></div>'
    }
    menuEl.innerHTML = html
  }

  /* ------------------------------------------------------------------ */
  /* init                                                               */
  /* ------------------------------------------------------------------ */

  function listenForRuntimeMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'FORMLEE_CLEAR_PRIVATE_STATE' || message.type === 'RANKORA_CLEAR_PRIVATE_STATE') {
        state.plan = null
        state.values = {}
        state.fillResult = null
        state.profileStatus = null
        state.readiness = null
        state.documents = null
        state.missing = []
        state.page = null
        state.session = { connected: false, expiresAt: null }
        state.scanError = null
        setPetState('needs-attention', 'Disconnected. Pair the assistant again before viewing workspace information.')
        renderPanel()
        return
      }
      if (message.type === 'FORMLEE_SHOW_PET' || message.type === 'RANKORA_SHOW_PET') {
        // An explicit SHOW_PET hands the floating pet back, clearing the
        // side panel's primary-surface claim.
        setPanelSurface('floating')
        try {
          chrome.storage.local.set({ [SURFACE_KEY]: 'floating' })
        } catch (surfaceError) {
          // Storage write is best-effort; the in-memory surface already flipped.
        }
        setHidden(false)
        setPetState('greeting', 'Here I am — right-click me for actions.')
        sendResponse({ ok: true })
      }
    })
  }

  function init() {
    if (!AgentCore) {
      console.warn('[Formlee Pet] Agent core not loaded — pet will not mount.')
      return
    }
    const classified = AgentCore.classifyUrl(location.href)
    if (classified.adapter === 'none') {
      // Do not inject on unsupported pages.
      return
    }
    listenForRuntimeMessages()
    listenForPanelSurface()
    mount()
    const refreshSessionWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshSession()
    }
    document.addEventListener('visibilitychange', refreshSessionWhenVisible)
    window.addEventListener('focus', refreshSessionWhenVisible)
    document.addEventListener('keydown', event => {
      // Ctrl/Cmd + Shift + F toggles the assistant.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        togglePanel()
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
