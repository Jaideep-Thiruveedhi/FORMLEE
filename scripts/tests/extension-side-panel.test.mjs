/**
 * Focused checks for the Chrome Side Panel integration (Phase 4).
 *
 * Pure module imports + source-contract assertions — no browser, no
 * database, no network. Verifies:
 *   - manifest validity and Side Panel registration
 *   - action-click opening configuration and popup fallback
 *   - popup functionality migrated into the panel (pairing vocabulary)
 *   - shared modules: URL config, UI vocabulary, pet core
 *   - the single-message-router architecture (no second fill mechanism)
 *   - pet surface suppression (no duplicate mascots)
 *   - adapter honesty language
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXT = path.join(ROOT, 'extensions', 'rankora-apply-agent')

const read = (...parts) => readFileSync(path.join(EXT, ...parts), 'utf8')
const manifest = JSON.parse(read('manifest.json'))

/* ------------------------------ shared modules ------------------------------ */

const { default: FormleeConfig } = await import(pathToFileURL(path.join(EXT, 'shared', 'formlee-config.js')).href)
const { default: FormleeAgentUI } = await import(pathToFileURL(path.join(EXT, 'shared', 'agent-ui.js')).href)
const { default: FormleePetCore } = await import(pathToFileURL(path.join(EXT, 'shared', 'pet-core.js')).href)

/* ------------------------------ manifest ------------------------------ */

test('manifest registers the side panel as the primary surface', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.ok(manifest.permissions.includes('sidePanel'), 'sidePanel permission required')
  assert.equal(manifest.side_panel && manifest.side_panel.default_path, 'sidepanel.html')
  assert.ok(!('default_popup' in manifest.action), 'default_popup must not compete with the side panel')
  assert.equal(manifest.action.default_title, 'Formlee Apply Agent')
})

test('content scripts load the shared vocabulary before the pet', () => {
  const js = manifest.content_scripts[0].js
  for (const required of ['shared/agent-core.js', 'shared/agent-ui.js', 'shared/pet-core.js', 'content/pet.js']) {
    assert.ok(js.includes(required), `${required} must be registered`)
  }
  assert.ok(js.indexOf('shared/agent-ui.js') < js.indexOf('content/pet.js'))
  assert.ok(js.indexOf('shared/pet-core.js') < js.indexOf('content/pet.js'))
})

test('host and demo coverage in the manifest is preserved', () => {
  assert.ok(manifest.host_permissions.includes('http://localhost:3000/*'))
  assert.ok(manifest.host_permissions.includes('https://examinationservices.nic.in/JeeMaink2027/*'))
  assert.ok(manifest.host_permissions.includes('https://viteee.vit.ac.in/*'))
})

/* ------------------------------ background ------------------------------ */

const background = read('background.js')

test('background opens the panel on action click and keeps the popup as fallback', () => {
  assert.ok(background.includes("setPanelBehavior({ openPanelOnActionClick: true })"), 'panel behaviour required')
  assert.ok(background.includes("chrome.action.setPopup({ popup: 'popup.html' })"), 'popup fallback required')
})

test('background keeps exactly one runtime message router', () => {
  const count = background.split('chrome.runtime.onMessage.addListener').length - 1
  assert.equal(count, 1, 'no duplicate action/message listeners are allowed')
})

test('background resolves the base URL through the shared config only', () => {
  assert.ok(background.includes("importScripts('shared/formlee-config.js'"), 'config must load first')
  assert.ok(!background.includes("http://localhost:3000'"), 'no hardcoded base URL may remain')
  assert.ok(background.includes('FormleeConfig.getBaseUrl()'))
})

test('GET_PLAN_CONTEXT exposes the scanned tab id', () => {
  assert.match(background, /tabId: context\.tabId/)
})

/* ------------------------------ credits ------------------------------ */

const credits = read('credits.js')

test('credits module uses the shared config and never hardcodes the origin', () => {
  assert.ok(credits.includes('FormleeConfig.getBaseUrl()'))
  assert.equal(credits.split('http://localhost:3000').length - 1, 0, 'billing must fail closed when central config is unavailable')
  assert.match(credits, /typeof FormleeConfig !== 'undefined' && FormleeConfig/)
  // The fill-credit boundary verbs must remain exactly these four call sites.
  assert.ok(credits.includes("'/api/billing/account'"))
  assert.ok(credits.includes("'/api/billing/reserve'"))
  assert.ok(credits.includes("+ '/' + suffix"), 'consume and release share the reservation boundary')
  assert.ok(credits.includes("action === 'consume' ? 'consume' : 'release'"))
})

test('credit finalization retains unconfirmed operations until the server confirms them', async () => {
  const memory = { agentToken: 'synthetic-agent-session' }
  const requests = []
  let status = 409
  const fakeChrome = {
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.map(key => [key, memory[key]])))
        },
        set(values, callback) {
          Object.assign(memory, values)
          if (callback) callback()
        },
      },
    },
  }
  const fakeModule = { exports: {} }
  runInNewContext(credits + '\nmodule.exports = Credits', {
    module: fakeModule,
    chrome: fakeChrome,
    FormleeConfig: { getBaseUrl: async () => 'https://formlee.example' },
    fetch: async (url, options) => {
      requests.push({ url, options })
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => status === 200
          ? { reservation: { id: 'reservation-1' } }
          : { error: 'Synthetic billing response' },
      }
    },
  })
  const client = fakeModule.exports

  const conflict = await client.confirmConsumption({ reservationId: 'reservation-1' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.pending, true)
  assert.equal(memory.pendingCreditFinalizations.length, 1, 'unconfirmed finalization stays durably recoverable')

  status = 503
  const transient = await client.releaseCredit({ reservationId: 'reservation-1' })
  assert.equal(transient.pending, true)
  assert.equal(memory.pendingCreditFinalizations.length, 1)

  status = 200
  const flushed = await client.flushPendingOperations()
  assert.deepEqual({ ok: flushed.ok, pending: flushed.pending }, { ok: true, pending: 0 })
  assert.equal(memory.pendingCreditFinalizations.length, 0)

  const reserveRequest = requests.find(request => request.url.endsWith('/api/billing/reserve'))
  assert.equal(reserveRequest, undefined, 'finalization recovery never creates another reservation')
})

/* ------------------------------ side panel ------------------------------ */

const sidepanel = read('sidepanel.js')
const sidepanelHtml = read('sidepanel.html')

test('panel HTML carries pairing, honesty and missing-info surfaces', () => {
  for (const id of ['pair-code', 'pair-btn', 'adapter-banner', 'missing-list', 'connection-chip', 'pet-avatar']) {
    assert.ok(sidepanelHtml.includes(`id="${id}"`), `#${id} must exist`)
  }
  assert.ok(sidepanelHtml.includes('shared/formlee-config.js'))
  assert.ok(sidepanelHtml.includes('shared/agent-ui.js'))
  assert.ok(sidepanelHtml.includes('shared/pet-core.js'))
})

test('panel supports the full workflow through the background router only', () => {
  for (const message of ['PAIR', 'STATUS', 'SCAN', 'CREATE_APPROVAL', 'FILL', 'VALUES', 'READINESS_SUMMARY', 'OPEN_PROFILE', 'OPEN_HUB', 'CLEAR_PLAN', 'GET_PLAN_CONTEXT', 'DISCONNECT']) {
    assert.ok(sidepanel.includes(`type: '${message}'`), `panel must use the ${message} router message`)
  }
})

test('panel keeps the scan-scoped missing-profile flow (VALUES.missing), not a global vault diff', () => {
  assert.ok(sidepanel.includes('state.missing = Array.isArray(valuesResponse.missing)'))
  assert.ok(sidepanel.includes('renderMissingSection()'))
})

test('panel implements no second agent or direct API access', () => {
  assert.ok(!sidepanel.includes('fetch('), 'the panel must never call APIs itself')
  assert.ok(!sidepanel.includes('x-rankora-agent-session'), 'session token stays in the service worker')
})

test('panel is the primary pet surface and hands back on unload', () => {
  assert.ok(sidepanel.includes("formleePetSurface"), 'surface flag required')
  assert.ok(sidepanel.includes("setPetSurface('panel')"))
  assert.ok(sidepanel.includes("setPetSurface('floating')"))
})

test('panel marks plans stale when the scanned tab navigates', () => {
  assert.ok(sidepanel.includes('markPlanStaleForTab'))
  assert.ok(sidepanel.includes("'Your plan is waiting on the other tab."))
})

test('API origin is fixed by the selected build and is never requested at runtime', () => {
  assert.ok(!sidepanel.includes('chrome.permissions.request'))
  assert.ok(sidepanel.includes('FormleeConfig.getBaseUrl()'))
})

/* ------------------------------ shared: config ------------------------------ */

test('config accepts localhost http origins including custom ports', () => {
  assert.equal(FormleeConfig.sanitizeBaseUrl('http://localhost:3000'), 'http://localhost:3000')
  assert.equal(FormleeConfig.sanitizeBaseUrl('http://127.0.0.1:5000/'), 'http://127.0.0.1:5000')
  assert.equal(FormleeConfig.sanitizeBaseUrl('http://localhost:3000/api//'), null, 'path components are rejected')
})

test('config requires https for non-localhost origins and rejects junk', () => {
  assert.equal(FormleeConfig.sanitizeBaseUrl('https://api.formlee.example'), 'https://api.formlee.example')
  assert.equal(FormleeConfig.sanitizeBaseUrl('http://api.formlee.example'), null, 'plaintext http outside localhost is rejected')
  assert.equal(FormleeConfig.sanitizeBaseUrl('ftp://localhost:3000'), null)
  assert.equal(FormleeConfig.sanitizeBaseUrl('not a url'), null)
  assert.equal(FormleeConfig.sanitizeBaseUrl(''), null)
  assert.equal(FormleeConfig.sanitizeBaseUrl(null), null)
  assert.equal(FormleeConfig.sanitizeBaseUrl('https://user:pass@example.com'), null, 'credentials cannot hide in the origin')
})

test('config exposes configuration only, never credentials', () => {
  const source = read('shared', 'formlee-config.js')
  assert.ok(!source.includes('Authorization'), 'no auth headers may live in the config module')
  assert.ok(!/apiKey|api_key|clientSecret|sk-[A-Za-z0-9]/.test(source), 'no key-like material in the config module')
})

/* ------------------------------ shared: agent UI ------------------------------ */

test('UI vocabulary maps vault canonicals to human names', () => {
  assert.equal(FormleeAgentUI.fieldName('fullName'), 'Full name')
  assert.equal(FormleeAgentUI.fieldName('class10SchoolName'), 'Class 10 school')
  assert.equal(FormleeAgentUI.fieldName('somethingNew'), 'somethingNew')
})

test('adapter honesty language is reduced to consistent badges', () => {
  assert.equal(FormleeAgentUI.clearStatusLabel('Beta adapter (fully tested on the demo)'), 'Fully tested')
  assert.equal(FormleeAgentUI.clearStatusLabel('Documentation-backed, demo only'), 'Demo only')
  assert.equal(FormleeAgentUI.clearStatusLabel('gibberish'), null)
  assert.equal(FormleeAgentUI.adapterTone('Unsupported'), 'error')
  assert.ok(FormleeAgentUI.adapterSummary('Demo only', 'personal').includes('demo only'))
})

test('result lines stay honest about verification', () => {
  assert.match(FormleeAgentUI.resultLine('filled'), /verified/)
  assert.match(FormleeAgentUI.resultLine('unverified'), /could not be verified/)
  assert.match(FormleeAgentUI.resultLine('no-saved-value'), /left blank/)
})

/* ------------------------------ shared: pet core ------------------------------ */

test('pet core ships the full lifecycle state set', () => {
  const required = ['idle', 'greeting', 'ready', 'scanning', 'thinking', 'reviewing', 'waiting', 'filling', 'verifying', 'success', 'warning', 'unsupported', 'error']
  for (const id of required) {
    assert.ok(FormleePetCore.STATES[id], `state ${id} missing`)
    assert.ok(FormleePetCore.DEFAULT_MESSAGES[id], `default message for ${id} missing`)
  }
})

test('pet mascot is a single shared drawing with the graduation cap', () => {
  const svg = FormleePetCore.mascotSVG()
  assert.ok(svg.includes('petCapGrad'), 'graduation cap gradient present')
  assert.ok(svg.includes('pet-eye'))
  assert.ok(svg.includes('pet-mouth'))
  assert.ok(!svg.includes('<script'), 'no script may ride along in the markup')
})

/* ------------------------------ floating pet ------------------------------ */

const pet = read('content', 'pet.js')

test('floating pet reuses the shared vocabulary and suppresses itself for the panel', () => {
  assert.ok(pet.includes('AgentUI ? AgentUI.FIELD_NAMES : FILLABLE_FIELD_NAMES_FALLBACK'))
  assert.ok(pet.includes('AgentUI ? AgentUI.PAGE_KIND_LABELS : PAGE_KIND_NAMES_FALLBACK'))
  assert.ok(pet.includes("panelSurface: 'floating'"))
  assert.ok(pet.includes("state.panelSurface === 'panel'"), 'suppression check present')
  assert.ok(pet.includes("chrome.storage.local.set({ formleePetSurface: 'floating' })"),
    'explicit SHOW_PET must clear the panel claim')
})

test('floating pet keeps its runtime-show path for the transparent handover', () => {
  assert.ok(pet.includes("message.type === 'RANKORA_SHOW_PET'"))
  assert.ok(pet.includes('updateHostVisibility'))
})

/* ------------------------------ popup fallback ------------------------------ */

const popupJs = read('popup.js')
const popupHtml = read('popup.html')

test('popup reuses the shared vocabulary instead of private copies', () => {
  assert.ok(popupJs.includes('AgentUI ? AgentUI.FIELD_NAMES : {}'))
  assert.ok(popupJs.includes('AgentUI ? AgentUI.RESULT_LINES : {}'))
  assert.ok(popupJs.includes('AgentUI.adapterTone') || popupJs.includes('adapterTone(adapterStatus)'))
  assert.ok(popupJs.includes('type: \'SHOW_PET\''), 'show-pet remains from the popup')
})

test('popup html loads the shared modules before the controller', () => {
  const scripts = [...popupHtml.matchAll(/src="([^"]+)"/g)].map(m => m[1])
  assert.ok(scripts.includes('shared/agent-ui.js'))
  assert.ok(scripts.indexOf('shared/agent-ui.js') < scripts.indexOf('popup.js'))
})
