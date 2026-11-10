import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXT = path.join(ROOT, 'extensions', 'formlee-apply-agent')
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8')
const require = createRequire(import.meta.url)
const MessageResponse = require(path.join(EXT, 'shared', 'message-response.js'))
const TaskResponse = require(path.join(EXT, 'shared', 'task-response.js'))
const background = read('extensions', 'formlee-apply-agent', 'background.js')
const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')
const sidepanelHtml = read('extensions', 'formlee-apply-agent', 'sidepanel.html')
const contentAgent = read('extensions', 'formlee-apply-agent', 'content', 'agent.js')
const policy = read('extensions', 'formlee-apply-agent', 'shared', 'extension-policy.js')

test('async MV3 messages keep their channel open and return successful handler values', async () => {
  let value
  const keepOpen = MessageResponse.respondAsync(() => Promise.resolve({ ok: true, value: 42 }), response => { value = response })
  assert.equal(keepOpen, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(value, { ok: true, value: 42 })
})

test('rejected message handlers return a structured safe error instead of closing silently', async () => {
  let value
  const keepOpen = MessageResponse.respondAsync(() => Promise.reject(new Error('private internal detail')), response => { value = response })
  assert.equal(keepOpen, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(value.ok, false)
  assert.equal(value.code, 'MESSAGE_HANDLER_FAILED')
  assert.match(value.error, /Reload/)
  assert.doesNotMatch(value.error, /private internal detail/)
})

test('message delivery tolerates a response channel that closes before completion', async () => {
  const keepOpen = MessageResponse.respondAsync(() => Promise.reject(new Error('late failure')), () => { throw new Error('port closed') })
  assert.equal(keepOpen, true)
  await new Promise(resolve => setImmediate(resolve))
})

test('background keeps sender validation before async dispatch and imports response helper before listener use', () => {
  assert.ok(background.indexOf("'shared/message-response.js'") < background.indexOf('chrome.runtime.onMessage.addListener'))
  const validation = background.indexOf('FormleeExtensionPolicy.isAllowedMessageSender(')
  const dispatch = background.indexOf('FormleeMessageResponse.respondAsync(() => handleAgentMessage(message), sendResponse)')
  assert.ok(validation >= 0 && validation < dispatch)
})

test('side panel normalizes the actual task and step API envelopes', () => {
  const task = { ref: 'task_demo', status: 'WAITING_FOR_STUDENT', pendingAction: { type: 'SCAN_PAGE' }, pendingActionId: 'act_demo' }
  assert.deepEqual(TaskResponse.taskFrom({ ok: true, body: { task } }), task)
  assert.deepEqual(TaskResponse.stepsFrom({ ok: true, body: { steps: [{ stepIndex: 0 }] } }), [{ stepIndex: 0 }])
  assert.equal(TaskResponse.taskFrom({ ok: true, task }), null)
  assert.equal(TaskResponse.stepsFrom({ ok: true, steps: [] }), null)
  assert.match(sidepanel, /TaskResponse\.taskFrom\(response\)/)
  assert.match(sidepanel, /TaskResponse\.stepsFrom\(response\)/)
  assert.ok(sidepanelHtml.includes('shared/task-response.js'))
})

test('task start creates, plans, and runs READY work while browser actions remain student-confirmed', () => {
  assert.match(sidepanel, /await onPlanTask\(\)[\s\S]*if \(state\.task && state\.task\.status === 'READY'\) await onRunTask\(\)/)
  assert.match(sidepanel, /state\.task\.pendingActionId/)
  assert.match(background, /case 'SUBMIT_TASK_BROWSER_RESULT':/)
})

test('task API failures display backend messages, codes, or HTTP status', () => {
  assert.equal(TaskResponse.failureMessage({ ok: false, status: 409, body: { message: 'Task is waiting for student.' } }, 'Task failed.'), 'Task is waiting for student.')
  assert.equal(TaskResponse.failureMessage({ ok: false, status: 422, body: { errorCode: 'NO_STEPS' } }, 'Planning failed.'), 'Planning failed. (NO_STEPS).')
  assert.equal(TaskResponse.failureMessage({ ok: false, status: 503, body: {} }, 'Task failed.'), 'Task failed. (HTTP 503).')
  assert.match(sidepanel, /TaskResponse\.failureMessage\(response, 'Task run failed\.'\)/)
})

test('scan is gated by the active tab adapter, injects only after a missing receiver, then validates scan identity', () => {
  assert.match(background, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/)
  assert.match(background, /response\.error === 'NO_CONTENT_SCRIPT'/)
  assert.match(background, /files: \['shared\/agent-core\.js', 'content\/agent\.js'\]/)
  assert.match(background, /page\.url !== gate\.classified\.sanitizedUrl/)
  assert.match(background, /const scanTool = await executeTool\('scan_supported_application_page'/)
  assert.match(background, /const mapResponse = await executeTool\('map_application_fields'/)
  assert.match(policy, /isAllowedMessageSender/)
})

test('unsupported scan pages are refused before content script injection', () => {
  const gate = background.indexOf('const gate = gateTab(active.tab)')
  const inject = background.indexOf('chrome.scripting.executeScript', gate)
  assert.ok(gate >= 0 && inject > gate)
  assert.match(background.slice(gate, inject), /if \(!gate\.ok\) return gate/)
  assert.match(background, /only runs on Formlee demo pages and supported examination portals/)
})

test('page scanner extracts labels and supports text, select, radio, and checkbox controls', () => {
  for (const fragment of ["querySelectorAll('input, textarea, select')", "kind: 'radio'", "kind: 'checkbox'", "kind: 'select'", 'labels: descriptors']) {
    assert.ok(contentAgent.includes(fragment), `scan extractor must include ${fragment}`)
  }
})

test('Formlee JEE adapter remains beta pending real portal verification', () => {
  const core = read('extensions', 'formlee-apply-agent', 'shared', 'agent-core.js')
  assert.match(core, /Beta — documentation-backed adapter; live portal not verified|Beta adapter/)
})
