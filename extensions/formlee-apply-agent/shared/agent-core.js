/**
 * Formlee Apply Agent — shared, dependency-free policy for the MV3 extension.
 *
 * Loaded by the service worker (importScripts), the content script (injected
 * before content/agent.js) and the popup (<script> tag). It contains no DOM
 * access and no student values: URL allowlisting, page-kind detection,
 * structure fingerprints, plan freshness, approval filtering and write
 * verification only.
 *
 * Node-compatible UMD wrapper so the same rules can be unit-tested.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  // Formlee is the canonical name. Keep the Rankora alias for extensions or
  // already-injected content scripts that still expect the historical global.
  root.AgentCore = api
  root.FormleeAgentCore = api
  root.RankoraAgentCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const ADAPTERS = [
    {
      id: 'jee-main-2027',
      name: 'JEE Main 2027 (Session 1)',
      statusLabel: 'Beta — documentation-backed adapter; live portal not verified',
      officialOrigin: 'https://examinationservices.nic.in',
      pathPrefix: '/JeeMaink2027/',
      fixturePath: '/apply/agent/jee-main-2027-demo',
    },
    {
      id: 'viteee-2027',
      name: 'VITEEE 2027',
      statusLabel: 'Documentation-backed / demo only — live VITEEE portal not verified',
      officialOrigin: 'https://viteee.vit.ac.in',
      pathPrefix: '/',
      fixturePath: '/apply/agent/viteee-2027-demo',
    },
  ]

  const GENERIC_DEMO_PATH = '/apply/agent/demo-form'
  const PLAN_TTL_MS = 10 * 60 * 1000
  // Replaced in generated packages; fixtures must never be accepted by the
  // production extension even if a user manually opens a localhost page.
  const BUILD_MODE = 'development'

  function parseUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''))
      if (url.username || url.password) return null
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
      return url
    } catch (error) {
      return null
    }
  }

  function sanitizeUrl(rawUrl) {
    const url = parseUrl(rawUrl)
    return url ? url.origin + url.pathname : null
  }

  function isSanitizedUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.indexOf('?') !== -1 || rawUrl.indexOf('#') !== -1) return false
    return sanitizeUrl(rawUrl) === rawUrl
  }

  function normalizedLocalPath(pathname) {
    const trimmed = String(pathname || '').replace(/\/+$/, '')
    return trimmed.length > 0 ? trimmed : '/'
  }

  function classifyOfficial(url, adapter) {
    if (
      url.protocol === 'https:' &&
      url.hostname === adapter.officialOrigin.replace(/^https?:\/\//, '') &&
      url.port === '' &&
      url.pathname.indexOf(adapter.pathPrefix) === 0
    ) {
      return {
        adapter: adapter.id,
        sanitizedUrl: url.origin + url.pathname,
        official: true,
        fixture: false,
        reason: 'OFFICIAL_' + adapter.id.toUpperCase().replace(/-/g, '_'),
      }
    }
    return null
  }

  function classifyFixture(url, adapter) {
    const localPath = normalizedLocalPath(url.pathname)
    if (localPath === adapter.fixturePath || localPath.indexOf(adapter.fixturePath + '/') === 0) {
      return {
        adapter: adapter.id,
        sanitizedUrl: url.origin + url.pathname,
        official: false,
        fixture: true,
        reason: 'SYNTHETIC_' + adapter.id.toUpperCase().replace(/-/g, '_') + '_FIXTURE',
      }
    }
    return null
  }

  /**
   * Returns the first adapter whose official origin + path prefix matches,
   * then falls back to local synthetic fixtures, then generic demo, then
   * unsupported. Exact host + path matching only.
   */
  function classifyUrl(rawUrl) {
    const url = parseUrl(rawUrl)
    if (!url) {
      return { adapter: 'none', sanitizedUrl: null, official: false, fixture: false, reason: 'INVALID_URL' }
    }

    const sanitizedUrl = url.origin + url.pathname

    for (const adapter of ADAPTERS) {
      const official = classifyOfficial(url, adapter)
      if (official) return official
    }

    if (
      BUILD_MODE === 'development' &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port === '3000'
    ) {
      for (const adapter of ADAPTERS) {
        const fixture = classifyFixture(url, adapter)
        if (fixture) return fixture
      }
      if (normalizedLocalPath(url.pathname) === GENERIC_DEMO_PATH) {
        return {
          adapter: 'generic',
          sanitizedUrl,
          official: false,
          fixture: true,
          reason: 'SYNTHETIC_GENERIC_DEMO',
        }
      }
    }

    return {
      adapter: 'none',
      sanitizedUrl,
      official: false,
      fixture: false,
      reason: 'UNSUPPORTED_ORIGIN',
    }
  }

  function adapterById(id) {
    return ADAPTERS.find(adapter => adapter.id === id) || null
  }

  function isFillablePageKind(kind) {
    return kind === 'personal' || kind === 'qualification'
  }

  function pageNotice(adapterId, kind) {
    const adapter = adapterById(adapterId)
    const name = adapter ? adapter.name : 'This examination'
    switch (kind) {
      case 'login':
        return name + ' login/registration gate. Log in yourself first; the agent starts only on the Personal Details or Qualification Details pages.'
      case 'exam':
        return name + ' exam preferences, session and city choices are not autofilled. Choose them yourself on the official portal.'
      case 'documents':
        return 'Document uploads are never automated. Choose and upload your own photograph, signature and certificates on the official portal.'
      case 'declaration':
        return 'The declaration, consent, payment and final submission are yours. The agent never ticks declarations or submits an application.'
      case 'unknown':
        return name + ' page is not one of the documented autofill sections. Nothing will be filled; open Personal Details or Qualification Details.'
      case 'personal':
      case 'qualification':
        return name + ' page is supported by the documentation-backed adapter.'
      case 'generic':
        return 'This is not an examination-specific page.'
      default:
        return name + ' adapter does not support this page.'
    }
  }

  function normalizeText(raw) {
    return String(raw == null ? '' : raw)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  /**
   * Content-script signals in, page kind out. Headings carry three times the
   * weight of field labels; a close tie or no clear evidence returns
   * "unknown" so the agent refuses instead of guessing.
   *
   * The same patterns are used for every examination adapter; this is
   * intentional: page-kind detection is structural and does not depend on
   * exact portal copy. Adapters then decide whether the detected kind is
   * fillable.
   */
  function classifyPageKind(signals) {
    const input = signals || {}
    const adapterId = input.adapter
    const adapter = adapterById(adapterId)
    if (!adapter) return 'generic'

    const headings = Array.isArray(input.headings) ? input.headings : []
    const labels = Array.isArray(input.labels) ? input.labels : []
    const headingText = normalizeText(headings.join(' '))
    const labelText = normalizeText(labels.join(' '))
    const allText = headingText + ' ' + labelText

    const hasPassword = input.hasPasswordField === true
    const hasPersonalEvidence =
      /personal details|personal information|candidate s name|candidates name|candidate date of birth|father guardian|mother guardian/.test(
        allText
      )
    const loginSignals =
      (/application\s*(no|number)/.test(allText) && /captcha/.test(allText)) ||
      /new registration|registered candidate login|candidate login|forgot password|login to/.test(allText) ||
      (hasPassword && !hasPersonalEvidence)
    if (loginSignals) return 'login'

    function score(headingPattern, labelPattern) {
      const h = headingPattern.test(headingText) ? 3 : 0
      const l = labelPattern.test(labelText) ? 2 : 0
      return h + l
    }

    const scores = {
      personal: score(
        /personal details|personal information/,
        /candidate s name|candidates name|candidate date of birth|father guardian|mother guardian|place of residence/
      ),
      qualification: score(
        /educational qualification|qualification details|academic details/,
        /school board|year of passing|qualifying exam|registration no|class 10|class 12/
      ),
      exam: score(
        /examination details|choice of examination|exam city|examination city/,
        /apply for|question paper medium|session of exam|exam state|examination city/
      ),
      documents: score(
        /upload documents|document upload|documents/,
        /upload photograph|upload signature|upload certificate/
      ),
      declaration: score(
        /declaration|undertaking/,
        /i hereby declare|i agree|consent|declaration/
      ),
    }

    const ranked = Object.keys(scores)
      .map(kind => ({ kind, score: scores[kind] }))
      .sort((a, b) => b.score - a.score)

    const top = ranked[0]
    const second = ranked[1]
    if (!top || top.score < 3) return 'unknown'
    if (second && second.score === top.score) return 'unknown'
    return top.kind
  }

  /**
   * Structural fingerprint over field metadata only. Never reads values.
   * Any label/group/kind/required/option-count change invalidates a plan.
   */
  function computeFingerprint(fields) {
    const parts = (Array.isArray(fields) ? fields : []).map(field => {
      const f = field || {}
      const options = Array.isArray(f.options) ? f.options.length : 0
      return [
        String(f.kind || ''),
        normalizeText(f.label || ''),
        normalizeText(f.group || ''),
        f.required === true ? '1' : '0',
        String(options),
      ].join('~')
    })
    const input = parts.join('||')
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return ('00000000' + hash.toString(16)).slice(-8)
  }

  function isSamePageContext(a, b) {
    if (!a || !b) return false
    if (a.tabId != null && b.tabId != null && a.tabId !== b.tabId) return false
    if (!a.url || !b.url || a.url !== b.url) return false
    if (!a.fingerprint || !b.fingerprint || a.fingerprint !== b.fingerprint) return false
    return true
  }

  function isPlanFresh(context, now, ttlMs) {
    if (!context || typeof context.createdAt !== 'number') return false
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : PLAN_TTL_MS
    return now - context.createdAt >= 0 && now - context.createdAt < ttl
  }

  /**
   * Returns only the items the student actually checked, and only when they
   * were mapped. A completed fill or a discarded plan yields no approvals.
   */
  function approvedPlanItems(plan, checkedIndexes, filledAt) {
    if (!plan || filledAt) return []
    const checked = checkedIndexes instanceof Set ? checkedIndexes : new Set(checkedIndexes || [])
    return (Array.isArray(plan.items) ? plan.items : []).filter(
      item => item && item.status === 'mapped' && typeof item.canonical === 'string' && checked.has(item.index)
    )
  }

  /** Read-back verification of the agent's own write. Never logs values. */
  function verifyWrite(kind, expected, actual) {
    if (kind === 'radio' || kind === 'checkbox') return expected === true && actual === true
    if (typeof expected !== 'string') return false
    return typeof actual === 'string' && actual === expected
  }

  return {
    ADAPTERS,
    GENERIC_DEMO_PATH,
    PLAN_TTL_MS,
    BUILD_MODE,
    sanitizeUrl,
    isSanitizedUrl,
    classifyUrl,
    adapterById,
    isFillablePageKind,
    pageNotice,
    classifyPageKind,
    computeFingerprint,
    isSamePageContext,
    isPlanFresh,
    approvedPlanItems,
    verifyWrite,
  }
})
