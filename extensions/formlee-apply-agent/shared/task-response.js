/** Normalizes the service worker's HTTP response envelope for the side panel. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.FormleeTaskResponse = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function taskFrom(response) {
    const task = response && response.ok && response.body && response.body.task
    return task && typeof task === 'object' ? task : null
  }

  function stepsFrom(response) {
    const steps = response && response.ok && response.body && response.body.steps
    return Array.isArray(steps) ? steps : null
  }

  function failureMessage(response, fallback) {
    const body = response && response.body && typeof response.body === 'object' ? response.body : {}
    if (typeof (response && response.error) === 'string' && response.error) return response.error
    if (typeof body.error === 'string' && body.error) return body.error
    if (typeof body.message === 'string' && body.message) return body.message
    if (typeof body.errorCode === 'string' && body.errorCode) return `${fallback} (${body.errorCode}).`
    if (Number.isInteger(response && response.status) && response.status > 0) return `${fallback} (HTTP ${response.status}).`
    return fallback
  }

  return Object.freeze({ taskFrom, stepsFrom, failureMessage })
})
