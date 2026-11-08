/**
 * Focused tests for the Phase 5 AI tool-calling loop and browser-action
 * dispatch. No database, no browser, no model required. Verifies source
 * contracts, iteration limits, registry validation, and extension-side
 * browser-action wiring.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8')

/* --------------------------------------------------------------------------- */
/* 1. Model adapter                                                            */
/* --------------------------------------------------------------------------- */

const model = read('src', 'lib', 'agent', 'model.ts')

test('model adapter reuses existing Ollama configuration', () => {
  assert.ok(model.includes("from './ollama'"), 'model adapter must reuse ollama.ts')
  assert.ok(model.includes('ollamaBaseUrl()'))
  assert.ok(model.includes('ollamaModel()'))
})

test('model adapter supports native Ollama tool calling and prompt-based fallback', () => {
  assert.ok(model.includes('/api/chat'), 'native Ollama chat endpoint required')
  assert.ok(model.includes('/api/generate'), 'prompt-based fallback required')
  assert.ok(model.includes('format: \'json\''), 'prompt-based mode requests JSON output')
})

test('model adapter never includes sensitive data in prompts', () => {
  assert.ok(model.includes('Privacy contract'))
  assert.ok(model.includes('Never ask for or expose'))
  assert.ok(!model.includes('x-formlee-agent-session'))
})

test('model adapter validates and parses tool calls', () => {
  assert.ok(model.includes('AgentToolCall'))
  assert.ok(model.includes('tool_calls'))
})

/* --------------------------------------------------------------------------- */
/* 2. Execution runner                                                         */
/* --------------------------------------------------------------------------- */

const runner = read('src', 'lib', 'agent', 'runner.ts')

test('runner validates every requested tool against the registry', () => {
  assert.ok(runner.includes('getToolDefinition'))
  assert.ok(runner.includes('UNKNOWN_TOOL'))
})

test('runner executes tools through the central executor', () => {
  assert.ok(runner.includes("from './tools/executor'"))
  assert.ok(runner.includes('executeTool('))
})

test('runner enforces an iteration limit', () => {
  assert.ok(runner.includes('maxIterations'))
  assert.ok(runner.includes('ITERATION_LIMIT'))
})

test('runner stops and returns browser-action envelopes without executing them server-side', () => {
  assert.ok(runner.includes('pendingBrowserAction'))
  assert.ok(runner.includes('browserAction'))
})

test('runner records tool call history', () => {
  assert.ok(runner.includes('ToolCallRecord'))
  assert.ok(runner.includes('toolCalls: ToolCallRecord'))
})

/* --------------------------------------------------------------------------- */
/* 3. Chat endpoint                                                            */
/* --------------------------------------------------------------------------- */

const chatRoute = read('src', 'app', 'api', 'agent', 'chat', 'route.ts')

test('chat endpoint requires an agent session', () => {
  assert.ok(chatRoute.includes('resolveAgentSession'))
  assert.ok(chatRoute.includes("'AGENT_SESSION_INVALID'"))
})

test('chat endpoint validates the message body', () => {
  assert.ok(chatRoute.includes('chatRequestSchema'))
  assert.ok(chatRoute.includes("'VALIDATION_ERROR'"))
})

test('chat endpoint runs the unified agent message handler', () => {
  assert.ok(chatRoute.includes('handleAgentMessage'))
})

/* --------------------------------------------------------------------------- */
/* 4. Browser-action dispatch in extension                                     */
/* --------------------------------------------------------------------------- */

const background = read('extensions', 'formlee-apply-agent', 'background.js')
const contentAgent = read('extensions', 'formlee-apply-agent', 'content', 'agent.js')

test('background accepts only explicitly supported browser-action types', () => {
  assert.ok(background.includes('ALLOWED_BROWSER_ACTIONS'))
  for (const action of ['GET_TAB_CONTEXT', 'SCAN_PAGE', 'VERIFY', 'FILL']) {
    assert.ok(background.includes("'" + action + "'"), `${action} must be allowed`)
  }
})

test('background rejects invalid browser-action messages', () => {
  assert.ok(background.includes("'INVALID_ACTION'"))
  assert.ok(background.includes("'UNSUPPORTED_ACTION'"))
})

test('background validates active tab and adapter before any browser action', () => {
  assert.ok(background.includes('dispatchBrowserAction'))
  assert.ok(background.includes('activeTab()'))
  assert.ok(background.includes('gateTab(active.tab)'))
})

test('background handles GET_TAB_CONTEXT, SCAN_PAGE, VERIFY and FILL', () => {
  assert.ok(background.includes("case 'GET_TAB_CONTEXT':"))
  assert.ok(background.includes("case 'SCAN_PAGE':"))
  assert.ok(background.includes("case 'VERIFY':"))
  assert.ok(background.includes("case 'FILL':"))
})

test('background has a chat message router', () => {
  assert.ok(background.includes("case 'CHAT':"))
  assert.ok(background.includes("'/api/agent/chat'"))
})

test('background fill from action consumes or releases credit by reservation id', () => {
  assert.ok(background.includes('runFillFromAction'))
  assert.ok(background.includes('Credits.confirmConsumption'))
  assert.ok(background.includes('Credits.releaseCredit'))
})

test('content script implements VERIFY readback', () => {
  assert.ok(contentAgent.includes("message.type === 'FORMLEE_VERIFY'"))
  assert.ok(contentAgent.includes('verifyFields('))
  assert.ok(contentAgent.includes('readEntryValue'))
})

test('content script never executes arbitrary JavaScript from messages', () => {
  assert.ok(!contentAgent.includes('eval('))
  assert.ok(!contentAgent.includes('new Function'))
  assert.ok(!contentAgent.includes('setAttribute("onclick"'))
})

/* --------------------------------------------------------------------------- */
/* 5. Side Panel chat integration                                              */
/* --------------------------------------------------------------------------- */

const sidepanelHtml = read('extensions', 'formlee-apply-agent', 'sidepanel.html')
const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')

test('side panel has a chat input surface', () => {
  assert.ok(sidepanelHtml.includes('chat-messages'))
  assert.ok(sidepanelHtml.includes('chat-input'))
  assert.ok(sidepanelHtml.includes('chat-send'))
})

test('side panel sends chat messages through the background router', () => {
  assert.ok(sidepanel.includes("type: 'CHAT'"))
  assert.ok(!sidepanel.includes('fetch('), 'panel must not call APIs directly')
})

test('side panel renders browser-action buttons for pending actions', () => {
  assert.ok(sidepanel.includes('renderBrowserAction'))
  assert.ok(sidepanel.includes('pendingBrowserAction'))
  assert.ok(sidepanel.includes("type: 'RUN_BROWSER_ACTION'"))
})

test('side panel logs real tool activity, not fabricated progress', () => {
  assert.ok(sidepanel.includes('logActivity'))
  assert.ok(sidepanel.includes('Tool ${tc.name}'))
})

/* --------------------------------------------------------------------------- */
/* 6. Approval integrity                                                       */
/* --------------------------------------------------------------------------- */

test('request_student_approval remains the only path to create an approval', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes('requestStudentApproval'))
  assert.ok(handlers.includes('createApproval'))
})

test('execute_approved_field_fills still verifies approval and reserves credit', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes('verifyApproval'))
  assert.ok(handlers.includes('reserveCredit'))
})

test('verify_filled_fields returns data when results are supplied, otherwise asks the extension', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes("browserAction: {\n      type: 'VERIFY'"))
  assert.ok(handlers.includes('verified: args.results'))
})
