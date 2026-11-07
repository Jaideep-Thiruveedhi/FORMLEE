/**
 * Build-time API origin for the Formlee extension.
 *
 * scripts/build-extension.mjs rewrites BUILD_MODE and DEFAULT_BASE_URL in
 * generated packages. Development stays on localhost. Production packages
 * use the configured HTTPS application origin, or a reserved .invalid
 * placeholder that fails closed until deployment configuration is supplied.
 * No credentials or API keys belong in this module.
 */
const FormleeConfig = (function () {
  'use strict'

  const BUILD_MODE = 'development'
  const DEFAULT_BASE_URL = 'http://localhost:3000'
  const REQUIRED_PRODUCTION_ORIGIN = 'https://replace-with-confirmed-formlee-origin.invalid'

  function isLocalHost(hostname) {
    if (typeof hostname !== 'string') return false
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' ||
      host === '0.0.0.0' || /^127\./.test(host)
  }

  function sanitizeBaseUrl(raw) {
    if (raw == null) return null
    const candidate = String(raw).trim().replace(/\/+$/, '')
    if (!candidate) return null
    let parsed
    try {
      parsed = new URL(candidate)
    } catch (error) {
      return null
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) return null
    if (parsed.pathname && parsed.pathname !== '/') return null
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return null
    return parsed.origin
  }

  function isConfiguredProductionOrigin(raw) {
    const sanitized = sanitizeBaseUrl(raw)
    if (!sanitized || !sanitized.startsWith('https://')) return false
    const hostname = new URL(sanitized).hostname.toLowerCase()
    return !isLocalHost(hostname) && !hostname.endsWith('.invalid')
  }

  function isProductionBuild() {
    return BUILD_MODE === 'production'
  }

  function isDevelopmentBuild() {
    return BUILD_MODE === 'development'
  }

  function isProductionOriginConfigured() {
    return !isProductionBuild() || isConfiguredProductionOrigin(DEFAULT_BASE_URL)
  }

  async function getBaseUrl() {
    if (isProductionBuild() && !isProductionOriginConfigured()) return null
    return DEFAULT_BASE_URL
  }

  function getConfigurationError() {
    return isProductionBuild() && !isProductionOriginConfigured()
      ? 'The production Formlee API origin is not configured. Set FORMLEE_PRODUCTION_API_ORIGIN and rebuild the extension.'
      : null
  }

  return Object.freeze({
    BUILD_MODE,
    DEFAULT_BASE_URL,
    REQUIRED_PRODUCTION_ORIGIN,
    sanitizeBaseUrl,
    isLocalHost,
    isProductionBuild,
    isDevelopmentBuild,
    isProductionOriginConfigured,
    getConfigurationError,
    getBaseUrl,
  })
})()

if (typeof module !== 'undefined' && module.exports) module.exports = FormleeConfig
