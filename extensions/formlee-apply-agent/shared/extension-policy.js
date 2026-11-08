/** Small, dependency-free security checks shared with the service worker tests. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.FormleeExtensionPolicy = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const CONTENT_SCRIPT_MESSAGES = new Set([
    'OPEN_PROFILE',
    'OPEN_HUB',
    'OPEN_APPLICATION',
    'SHOW_PET',
    'STATUS',
    'PROFILE_STATUS',
    'GET_PLAN_CONTEXT',
    'SCAN',
    'VALUES',
    'READINESS_SUMMARY',
    'DOCUMENTS_LIST',
    'FILL',
  ])

  function isSessionExpired(expiresAt, now = Date.now()) {
    if (typeof expiresAt !== 'string' || !expiresAt) return true
    const expiry = Date.parse(expiresAt)
    return !Number.isFinite(expiry) || expiry <= now
  }

  function isAllowedMessageSender(sender, extensionId, message, classifyUrl, isDevelopmentBuild) {
    if (!sender || sender.id !== extensionId || !message || typeof message.type !== 'string') return false

    let senderUrl
    try {
      senderUrl = new URL(String(sender.url || ''))
    } catch (error) {
      return false
    }

    if (senderUrl.protocol === 'chrome-extension:' && senderUrl.hostname === extensionId &&
        !senderUrl.username && !senderUrl.password && !senderUrl.port) {
      return senderUrl.pathname === '/sidepanel.html' || senderUrl.pathname === '/popup.html'
    }

    if (!sender.tab || typeof sender.tab.id !== 'number' || sender.frameId !== 0) return false
    if (!CONTENT_SCRIPT_MESSAGES.has(message.type) || typeof classifyUrl !== 'function') return false

    let tabUrl
    try {
      tabUrl = new URL(String(sender.tab.url || ''))
    } catch (error) {
      return false
    }
    const senderPage = classifyUrl(senderUrl.href)
    const tabPage = classifyUrl(tabUrl.href)
    if (!senderPage || !tabPage || senderPage.adapter === 'none' || tabPage.adapter === 'none') return false
    if (senderPage.sanitizedUrl !== tabPage.sanitizedUrl) return false
    if (!isDevelopmentBuild && (senderPage.fixture || tabPage.fixture)) return false
    return true
  }

  return Object.freeze({ CONTENT_SCRIPT_MESSAGES, isSessionExpired, isAllowedMessageSender })
})
