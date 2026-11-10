/** Keep MV3 runtime message channels alive until async work has completed. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.FormleeMessageResponse = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function respondAsync(handler, sendResponse) {
    Promise.resolve()
      .then(handler)
      .then(response => sendResponse(response))
      .catch(() => {
        try {
          sendResponse({
            ok: false,
            error: 'The extension could not complete this request. Reload the page or extension and try again.',
            code: 'MESSAGE_HANDLER_FAILED',
          })
        } catch (error) {
          // Chrome may already have closed the message channel.
        }
      })
    return true
  }

  return Object.freeze({ respondAsync })
})
