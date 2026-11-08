/**
 * Phase 8 — focused end-to-end integration tests.
 *
 * These tests verify that the existing Phase 4-7 systems are wired together
 * into one coherent Formlee Agent without duplication. They use file inspection
 * and synthetic boundaries; they do not require a live Chrome portal or model.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import './support/register-ts-alias-loader.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const { parseTaskAction } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'agent', 'action-parser.ts')).href)
const { evaluateProfile } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'apply-ai', 'requirements.ts')).href)
const { recognizeFields } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'agent', 'recognition', 'pipeline.ts')).href)
const registrySource = read('src', 'lib', 'agent', 'tools', 'registry.ts')
const hasRegisteredTool = name => registrySource.includes(`'${name}'`)

/* --------------------------------------------------------------------------- */
/* 1. Unified architecture                                                     */
/* --------------------------------------------------------------------------- */

test('unified agent entry point exists and wraps the bounded runner', () => {
  const agent = read('src', 'lib', 'agent', 'agent.ts')
  assert.ok(agent.includes('handleAgentMessage'))
  assert.ok(agent.includes('runAgent'))
  assert.ok(agent.includes('create_agent_task'))
})

test('chat endpoint routes through the unified agent', () => {
  const route = read('src', 'app', 'api', 'agent', 'chat', 'route.ts')
  assert.ok(route.includes('handleAgentMessage'))
  assert.ok(route.includes("role: z.enum(['user', 'assistant'])"))
  assert.ok(!route.includes('tool_calls'), 'clients cannot submit fabricated tool transcripts')
})

test('task lifecycle tools are registered and linked to the orchestrator', () => {
  assert.ok(hasRegisteredTool('create_agent_task'))
  assert.ok(hasRegisteredTool('resume_agent_task'))
  assert.ok(hasRegisteredTool('list_agent_tasks'))
  assert.ok(hasRegisteredTool('get_agent_task'))
})

test('planner excludes task-lifecycle tools to prevent recursive tasks', () => {
  const planner = read('src', 'lib', 'agent', 'tasks', 'planner.ts')
  assert.ok(planner.includes('EXCLUDED_FROM_PLANS'))
  assert.ok(planner.includes("'create_agent_task'"))
})

/* --------------------------------------------------------------------------- */
/* 2. Student Vault integration                                                */
/* --------------------------------------------------------------------------- */

test('registry includes Student Vault read tools', () => {
  assert.ok(hasRegisteredTool('get_student_profile_summary'))
  assert.ok(hasRegisteredTool('get_student_profile_section'))
  assert.ok(hasRegisteredTool('list_uploaded_documents'))
})

test('profile summary tool returns only redacted metadata, not raw values', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes('getStudentProfileSummary'))
  assert.ok(!handlers.includes('rawProfileValues'))
})

test('synthetic JEE readiness returns missing fields without touching credits', () => {
  const readiness = evaluateProfile({})
  assert.equal(readiness.status, 'INCOMPLETE')
  assert.ok(readiness.missingLabels.length > 0)
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  const start = handlers.indexOf('export async function getApplicationReadiness')
  const end = handlers.indexOf('\nexport async function getApplicationChecklist', start)
  const readinessHandler = handlers.slice(start, end)
  assert.ok(readinessHandler.includes('withEvaluation'))
  assert.ok(!readinessHandler.includes('reserveCredit'))
})

test('synthetic ambiguous field yields a review-required AI suggestion', async () => {
  globalThis.__FORMLEE_MOCK_AGENT_RESPONSE__ = {
    ok: true,
    text: JSON.stringify({
      fields: [{
        index: 37,
        detectedFieldMeaning: 'Applicant name',
        suggestedVaultField: 'fullName',
        confidence: 'MEDIUM',
        reasoningCategory: 'CONTEXT_INFERENCE',
        ambiguity: ['The label is unfamiliar'],
        warnings: [],
      }],
    }),
    toolCalls: [],
    nativeToolSupport: false,
  }
  try {
    const { results } = await recognizeFields([{
      index: 37,
      label: 'QX-17 Applicant Datum',
      kind: 'text',
      inputName: 'applicantDatum',
      inputId: 'applicant-datum',
      required: false,
      options: [],
      group: '',
    }], { pageKind: 'personal' })
    assert.equal(results[0].source, 'AI_SUGGESTION')
    assert.equal(results[0].canonical, 'fullName')
    assert.equal(results[0].needsReview, true)
  } finally {
    delete globalThis.__FORMLEE_MOCK_AGENT_RESPONSE__
  }
})

/* --------------------------------------------------------------------------- */
/* 3. Application Hub integration                                              */
/* --------------------------------------------------------------------------- */

test('registry includes Application Hub tools', () => {
  assert.ok(hasRegisteredTool('get_application_details'))
  assert.ok(hasRegisteredTool('get_application_readiness'))
  assert.ok(hasRegisteredTool('get_application_checklist'))
  assert.ok(hasRegisteredTool('get_application_deadlines'))
})

test('application readiness tool reuses existing evaluation service', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes('getApplicationReadiness'))
  assert.ok(handlers.includes('withEvaluation'))
})

/* --------------------------------------------------------------------------- */
/* 4. Field-recognition integration                                            */
/* --------------------------------------------------------------------------- */

test('the full mapping chain is present in the registry', () => {
  assert.ok(hasRegisteredTool('detect_supported_exam'))
  assert.ok(hasRegisteredTool('scan_supported_application_page'))
  assert.ok(hasRegisteredTool('map_application_fields'))
  assert.ok(hasRegisteredTool('generate_field_preview'))
  assert.ok(hasRegisteredTool('get_field_mapping_conflicts'))
})

test('mapper routes through Phase 7 recognition pipeline', () => {
  const mapper = read('src', 'lib', 'agent', 'mapper.ts')
  assert.ok(mapper.includes('recognizeFields'))
})

test('field review surface displays source, confidence and warnings', () => {
  const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')
  assert.ok(sidepanel.includes('sourceLabel'))
  assert.ok(sidepanel.includes('confidenceTone'))
  assert.ok(sidepanel.includes('sp-plan-warnings'))
})

/* --------------------------------------------------------------------------- */
/* 5. Browser-agent integration                                                */
/* --------------------------------------------------------------------------- */

test('browser actions are dispatched through the existing extension', () => {
  const background = read('extensions', 'formlee-apply-agent', 'background.js')
  assert.ok(background.includes('SCAN_PAGE'))
  assert.ok(background.includes('FILL'))
  assert.ok(background.includes('VERIFY'))
  assert.ok(background.includes('dispatchBrowserAction'))
})

function extractAsyncFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  assert.ok(start >= 0, `${name} must exist`)
  const open = source.indexOf('{', start)
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`Could not find the end of ${name}`)
}

async function simulateReviewedFill({ stalePlan = false, readbackFails = false, readbackValue = 'Synthetic Student' } = {}) {
  const source = read('extensions', 'formlee-apply-agent', 'background.js')
  const fnSource = extractAsyncFunction(source, 'runFillFromAction')
  const tab = { id: 7, url: 'https://jeemain.nta.nic.in/application' }
  const context = {
    tabId: tab.id,
    adapter: 'jee-main-2027',
    url: tab.url,
    fingerprint: 'synthetic-page-fingerprint',
    plan: { items: [{ index: 3, status: 'mapped', canonical: 'fullName' }] },
  }
  const calls = { tab: [], tools: [], consumed: 0, released: 0, cleared: 0 }
  const runFill = runInNewContext(`${fnSource}; runFillFromAction`, {
    AgentCore: {
      isPlanFresh: () => !stalePlan,
      isFillablePageKind: kind => kind === 'personal',
    },
    readPlanContext: async () => context,
    clearPlanContext: async () => { calls.cleared += 1 },
    activeTab: async () => ({ ok: true, tab }),
    gateTab: currentTab => ({ ok: true, classified: { adapter: context.adapter, sanitizedUrl: currentTab.url } }),
    approvedAgainstPlan: approved => ({ ok: true, approved }),
    sendToTab: async (_tabId, message) => {
      calls.tab.push(message.type)
      if (message.type === 'FORMLEE_PAGE') {
        return { ok: true, page: { adapter: context.adapter, url: context.url, fingerprint: context.fingerprint, kind: 'personal' } }
      }
      if (message.type === 'FORMLEE_FILL') return { ok: true, results: [{ index: 3, status: 'filled', value: 'Synthetic Student' }] }
      if (message.type === 'FORMLEE_VERIFY') {
        return readbackFails
          ? { ok: false, error: 'Synthetic readback failure' }
          : { ok: true, fingerprint: context.fingerprint, results: [{ index: 3, canonical: 'fullName', status: 'filled', value: readbackValue }] }
      }
      return { ok: false, error: 'Unexpected synthetic browser message' }
    },
    fetchAgentValues: async fields => ({ ok: true, values: Object.fromEntries(fields.map(field => [field, 'Synthetic Student'])) }),
    agentApi: async () => ({ ok: true, body: { approval: { id: 'synthetic-approval' } } }),
    hashValueFingerprint: async value => 'synthetic-sha256-' + String(value),
    executeTool: async (tool, args, studentAction) => {
      calls.tools.push({ tool, args, studentAction })
      const verifiedCount = Array.isArray(args.results) ? args.results.filter(item => item.status === 'filled').length : 0
      return { ok: true, body: { result: { ok: true, data: { verifiedCount, unverifiedCount: (args.results || []).length - verifiedCount } } } }
    },
    Credits: {
      trackReservation: async () => ({ ok: true }),
      confirmConsumption: async () => { calls.consumed += 1; return { ok: true } },
      releaseCredit: async () => { calls.released += 1; return { ok: true } },
    },
  })
  const result = await runFill(tab, {
    approvalRef: 'a'.repeat(64),
    reservationId: 'synthetic-reservation',
    approved: [{ index: 3, canonical: 'fullName' }],
  })
  return { result, calls }
}

test('synthetic approved-fill scenario reads back the exact approved field before consuming credit', async () => {
  const { result, calls } = await simulateReviewedFill()
  assert.equal(result.ok, true)
  assert.equal(result.filled, 1)
  assert.deepEqual(calls.tab, ['FORMLEE_PAGE', 'FORMLEE_FILL', 'FORMLEE_VERIFY'])
  assert.equal(calls.tools[0].tool, 'verify_filled_fields')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.tools[0].args.results)), [{ index: 3, canonical: 'fullName', status: 'filled', valueHash: 'synthetic-sha256-Synthetic Student' }])
  assert.equal(calls.tools[0].args.pageFingerprint, 'synthetic-page-fingerprint')
  assert.equal(calls.consumed, 1)
  assert.equal(calls.released, 0)
})

test('synthetic interrupted workflow releases its reservation and does not write on a stale plan', async () => {
  const { result, calls } = await simulateReviewedFill({ stalePlan: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STALE_PLAN')
  assert.deepEqual(calls.tab, [])
  assert.equal(calls.consumed, 0)
  assert.equal(calls.released, 1)
})

test('synthetic readback failure releases the reservation and never retries the browser write', async () => {
  const { result, calls } = await simulateReviewedFill({ readbackFails: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'FIELD_VERIFICATION_FAILED')
  assert.deepEqual(calls.tab, ['FORMLEE_PAGE', 'FORMLEE_FILL', 'FORMLEE_VERIFY'])
  assert.equal(calls.consumed, 0)
  assert.equal(calls.released, 1)
})

test('synthetic changed readback is not counted as a verified fill', async () => {
  const { result, calls } = await simulateReviewedFill({ readbackValue: 'Different value' })
  assert.equal(result.ok, true)
  assert.equal(result.filled, 0)
  assert.equal(result.unverified, 1)
  assert.equal(calls.consumed, 0)
  assert.equal(calls.released, 1)
  assert.equal(calls.tools[0].args.results[0].status, 'unverified')
})

test('server never declares direct Chrome tab or DOM access', () => {
  const agentTools = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(!agentTools.includes('chrome.tabs'))
  assert.ok(!agentTools.includes('document.querySelector'))
})

/* --------------------------------------------------------------------------- */
/* 6. Human-controlled operations                                              */
/* --------------------------------------------------------------------------- */

test('registry does not contain tools for CAPTCHA, OTP, payment or final submission', () => {
  const names = [...registrySource.matchAll(/^\s*'([a-z_]+)'\s*,?\s*$/gm)].map(match => match[1]).join(' ')
  assert.ok(!/captcha/i.test(names))
  assert.ok(!/otp/i.test(names))
  assert.ok(!/payment/i.test(names))
  assert.ok(!/submit/i.test(names))
})

test('side panel explains manual-only operations', () => {
  const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')
  const html = read('extensions', 'formlee-apply-agent', 'sidepanel.html')
  assert.ok(sidepanel.includes('CAPTCHA'))
  assert.ok(sidepanel.includes('OTP'))
  assert.ok(sidepanel.includes('payment'))
  assert.ok(html.includes('id="your-turn-notice"'))
  assert.ok(html.includes('final submission'))
})

/* --------------------------------------------------------------------------- */
/* 7. Credit Wallet integration                                                */
/* --------------------------------------------------------------------------- */

test('credit boundary uses existing reserve/consume/release APIs', () => {
  const credits = read('extensions', 'formlee-apply-agent', 'credits.js')
  assert.ok(credits.includes('/api/billing/reserve'))
  assert.ok(credits.includes("action === 'consume' ? 'consume' : 'release'"))
  assert.ok(credits.includes('idempotencyKey'))
})

test('credit is only reserved after explicit fill approval', () => {
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  assert.ok(handlers.includes('executeApprovedFieldFills'))
  assert.ok(handlers.includes('reserveCredit'))
})

/* --------------------------------------------------------------------------- */
/* 8. Pet and Side Panel integration                                           */
/* --------------------------------------------------------------------------- */

test('side panel contains conversation, application, task, field review and activity surfaces', () => {
  const html = read('extensions', 'formlee-apply-agent', 'sidepanel.html')
  assert.ok(html.includes('chat-section'))
  assert.ok(html.includes('task-section'))
  assert.ok(html.includes('plan-container'))
  assert.ok(html.includes('activity-list'))
})

test('pet state reflects genuine task status', () => {
  const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')
  assert.ok(sidepanel.includes('taskStatusToPetState'))
  assert.ok(sidepanel.includes("case 'RUNNING':"))
  assert.ok(sidepanel.includes("case 'WAITING_FOR_STUDENT':"))
})

/* --------------------------------------------------------------------------- */
/* 9. Natural-language task creation                                           */
/* --------------------------------------------------------------------------- */

test('agent parses CREATE_TASK action from model text fallback', () => {
  const action = parseTaskAction('{"action":"CREATE_TASK","objective":"Prepare my JEE Main application"}')
  assert.ok(action)
  assert.equal(action.objective, 'Prepare my JEE Main application')
})

test('agent ignores malformed inline JSON', () => {
  const action = parseTaskAction('Here is your plan { not valid json }')
  assert.equal(action, null)
})

/* --------------------------------------------------------------------------- */
/* 10. Safety boundaries                                                       */
/* --------------------------------------------------------------------------- */

test('no model or tool can approve its own fills', () => {
  const approval = read('src', 'lib', 'agent', 'approval.ts')
  const registry = read('src', 'lib', 'agent', 'tools', 'registry.ts')
  const runner = read('src', 'lib', 'agent', 'runner.ts')
  const executor = read('src', 'lib', 'agent', 'tools', 'executor.ts')
  assert.ok(approval.includes('student action'))
  assert.ok(registry.includes('!isStudentActionTool(definition.name)'))
  assert.ok(runner.includes('STUDENT_ACTION_REQUIRED'))
  assert.ok(executor.includes('options.studentAction && isStudentActionTool(options.toolName)'))
})

test('approval verification checks page fingerprint and approved field list', () => {
  const approval = read('src', 'lib', 'agent', 'approval.ts')
  assert.ok(approval.includes('pageFingerprint'))
  assert.ok(approval.includes('approvedFieldIds'))
})
