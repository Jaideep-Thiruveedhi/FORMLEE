/**
 * Formlee credit-authorization boundary.
 *
 * The extension never modifies balances. It asks the Formly backend to:
 *   1. Reserve one application credit when the student approves a fill.
 *   2. Consume the reservation after at least one approved field is verified filled.
 *   3. Release the reservation if the fill fails or is cancelled.
 *
 * Scanning, mapping preview and editing mappings remain free.
 */

const Credits = (function () {
  'use strict'

  const SESSION_HEADER = 'x-rankora-agent-session'
  const PENDING_KEY = 'pendingCreditFinalizations'

  function getBaseUrl() {
    if (typeof FormleeConfig !== 'undefined' && FormleeConfig) {
      return FormleeConfig.getBaseUrl()
    }
    return Promise.resolve(null)
  }

  function storedSession() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return resolve(null)
      }
      chrome.storage.local.get(['agentToken', 'agentExpiresAt'], result => {
        const token = typeof result.agentToken === 'string' ? result.agentToken : ''
        resolve(token)
      })
    })
  }

  async function api(path, options) {
    const token = await storedSession()
    if (!token) {
      return { ok: false, body: { error: 'Not paired.' } }
    }
    try {
      const baseUrl = await getBaseUrl()
      if (!baseUrl) {
        return {
          ok: false,
          status: 0,
          body: { error: typeof FormleeConfig !== 'undefined' && FormleeConfig.getConfigurationError ? FormleeConfig.getConfigurationError() : 'Formlee API origin is not configured.' },
        }
      }
      const response = await fetch(baseUrl + path, {
        ...options,
        headers: { ...(options && options.headers), [SESSION_HEADER]: token },
      })
      const body = await response.json().catch(() => null)
      return { ok: response.ok, status: response.status, body }
    } catch (error) {
      return { ok: false, body: { error: error.message || 'Network error' } }
    }
  }

  function readPending() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve([])
      chrome.storage.local.get([PENDING_KEY], result => {
        resolve(Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY] : [])
      })
    })
  }

  function writePending(items) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return reject(new Error('Extension storage is unavailable.'))
      chrome.storage.local.set({ [PENDING_KEY]: items }, () => {
        if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || 'Could not persist the reservation.'))
        else resolve()
      })
    })
  }

  async function storeReservation(reservationId, approvalRef, action, pageFingerprint) {
    const pending = await readPending()
    const existing = pending.find(item => item && item.reservationId === reservationId)
    if (existing) {
      existing.action = action
      if (approvalRef) existing.approvalRef = approvalRef
      if (pageFingerprint) existing.pageFingerprint = pageFingerprint
      existing.updatedAt = Date.now()
    } else {
      pending.push({ action, reservationId, approvalRef: approvalRef || null, pageFingerprint: pageFingerprint || null, queuedAt: Date.now() })
    }
    await writePending(pending)
  }

  async function trackReservation(reservationId, approvalRef) {
    if (typeof reservationId !== 'string' || !reservationId) return { ok: false, error: 'Missing reservation.' }
    try {
      await storeReservation(reservationId, approvalRef, 'pending')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message || 'Could not persist the reservation reference.' }
    }
  }

  async function finalize(action, reservationId, approvalRef, pageFingerprint) {
    try {
      await storeReservation(reservationId, approvalRef, action, pageFingerprint)
    } catch (error) {
      return { ok: false, pending: true, error: error.message || 'Could not persist the credit finalization.' }
    }
    const suffix = action === 'consume' ? 'consume' : 'release'
    const body = action === 'consume'
      ? { approvalRef, pageFingerprint }
      : { approvalRef: approvalRef || undefined }
    const res = await api('/api/billing/reserve/' + encodeURIComponent(reservationId) + '/' + suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const pending = await readPending()
      await writePending(pending.filter(item => item && item.reservationId !== reservationId))
      return { ok: true }
    }
    return {
      ok: false,
      pending: true,
      error: (res.body && res.body.error) || ('Could not ' + action + ' the reserved credit.'),
    }
  }

  function shouldRetryFinalization(res) {
    // Network failures, expired pairing, throttling and server errors can be
    // retried later. A terminal conflict or missing reservation cannot.
    return typeof res.status !== 'number' || res.status === 401 || res.status === 408 ||
      res.status === 429 || res.status >= 500
  }

  async function flushPendingOperations() {
    const pending = await readPending()
    const remaining = []
    for (const item of pending) {
      if (!item || typeof item.reservationId !== 'string') continue
      if (!['consume', 'release'].includes(item.action)) {
        remaining.push(item)
        continue
      }
      if (item.action === 'consume' && typeof item.approvalRef !== 'string') {
        // Old pending consumes have no server-validated receipt reference.
        // Keep them discoverable for explicit owner recovery; never infer a
        // successful fill from an old client-side finalization flag.
        remaining.push({ ...item, action: 'recovery' })
        continue
      }
      const suffix = item.action === 'consume' ? 'consume' : 'release'
      const res = await api('/api/billing/reserve/' + encodeURIComponent(item.reservationId) + '/' + suffix, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.action === 'consume'
          ? { approvalRef: item.approvalRef, pageFingerprint: item.pageFingerprint }
          : { approvalRef: item.approvalRef || undefined }),
      })
      if (!res.ok) {
        remaining.push(shouldRetryFinalization(res) ? item : { ...item, action: 'recovery' })
      }
    }
    await writePending(remaining)
    return { ok: remaining.length === 0, pending: remaining.length }
  }

  async function listRecoverableReservations() {
    const res = await api('/api/billing/reserve/recover', { method: 'GET' })
    if (!res.ok) return { ok: false, error: (res.body && res.body.error) || 'Could not load outstanding reservations.' }
    return { ok: true, reservations: Array.isArray(res.body && res.body.reservations) ? res.body.reservations : [] }
  }

  async function releaseRecoveredReservation(reservationId) {
    if (typeof reservationId !== 'string' || !reservationId) return { ok: false, error: 'Reservation id is required.' }
    const res = await api('/api/billing/reserve/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', reservationId }),
    })
    if (!res.ok) return { ok: false, error: (res.body && res.body.error) || 'Could not release the outstanding reservation.' }
    const pending = await readPending()
    await writePending(pending.filter(item => item && item.reservationId !== reservationId))
    return { ok: true }
  }

  async function checkAvailableCredits() {
    const res = await api('/api/billing/account', { method: 'GET' })
    if (!res.ok) {
      // If the server is unreachable or the billing endpoint is unavailable,
      // fail closed so filling cannot proceed without a confirmed balance.
      return { ok: false, error: (res.body && res.body.error) || 'Could not check credit balance.' }
    }
    return { ok: true, balance: (res.body && res.body.balance) || 0 }
  }

  async function reserveCredit(idempotencyKey) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
      return { ok: false, error: 'Approval reference is required for an idempotent credit reservation.', code: 'IDEMPOTENCY_KEY_REQUIRED' }
    }
    const res = await api('/api/billing/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey }),
    })
    if (!res.ok) {
      const code = res.body && res.body.code
      const error = (res.body && res.body.error) || 'Could not reserve a credit.'
      return { ok: false, error, code }
    }
    const reservation = (res.body && res.body.reservation) || {}
    const stored = await trackReservation(reservation.id, idempotencyKey)
    if (!stored.ok) return { ok: false, error: stored.error, code: 'RESERVATION_STORAGE_FAILED', reservationId: reservation.id }
    return { ok: true, reservationId: reservation.id }
  }

  async function authorizeFill(idempotencyKey) {
    const balanceRes = await checkAvailableCredits()
    if (!balanceRes.ok) return balanceRes
    if (balanceRes.balance < 1) {
      return {
        ok: false,
        error: 'You do not have any application credits. Buy a credit package in Formly to continue.',
        code: 'INSUFFICIENT_CREDITS',
      }
    }
    const reserveRes = await reserveCredit(idempotencyKey)
    if (!reserveRes.ok) return reserveRes
    return { ok: true, auth: { reservationId: reserveRes.reservationId, approvalRef: idempotencyKey } }
  }

  async function confirmConsumption(auth) {
    if (!auth || !auth.reservationId) return { ok: false, error: 'Missing reservation.' }
    return finalize('consume', auth.reservationId, auth.approvalRef, auth.pageFingerprint)
  }

  async function releaseCredit(auth) {
    if (!auth || !auth.reservationId) return { ok: true }
    return finalize('release', auth.reservationId, auth.approvalRef, auth.pageFingerprint)
  }

  return {
    checkAvailableCredits,
    reserveCredit,
    trackReservation,
    authorizeFill,
    confirmConsumption,
    releaseCredit,
    flushPendingOperations,
    listRecoverableReservations,
    releaseRecoveredReservation,
  }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = Credits
