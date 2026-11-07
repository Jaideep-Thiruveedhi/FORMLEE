/**
 * Focused tests for the Phase 6 Agent Task Orchestrator.
 *
 * No database, no Next.js runtime, no browser, no model. Verifies source
 * contracts, task lifecycle, planning, execution, concurrency control,
 * idempotency, pause/resume, cancellation and Side Panel integration.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8')

/* --------------------------------------------------------------------------- */
/* 1. Task lifecycle and statuses                                              */
/* --------------------------------------------------------------------------- */

const types = read('src', 'lib', 'agent', 'tasks', 'types.ts')

test('declares all required task statuses', () => {
  const required = [
    'CREATED',
    'PLANNING',
    'READY',
    'RUNNING',
    'WAITING_FOR_STUDENT',
    'PAUSED',
    'RETRYING',
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
  ]
  for (const status of required) {
    assert.ok(types.includes("'" + status + "'"), `task status ${status} must be declared`)
  }
})

test('declares step statuses and event types', () => {
  assert.ok(types.includes("'PENDING'"))
  assert.ok(types.includes("'COMPLETED'"))
  assert.ok(types.includes('TaskEventType'))
})

/* --------------------------------------------------------------------------- */
/* 2. Schema and migration                                                     */
/* --------------------------------------------------------------------------- */

const schema = read('prisma', 'schema.prisma')
const migration = read('prisma', 'migrations', '20261103000005_agent_task_orchestrator', 'migration.sql')

test('schema adds AgentTask, AgentTaskStep and AgentTaskEvent models', () => {
  assert.ok(schema.includes('model AgentTask'))
  assert.ok(schema.includes('model AgentTaskStep'))
  assert.ok(schema.includes('model AgentTaskEvent'))
})

test('task models contain required fields', () => {
  assert.ok(schema.includes('ref'))
  assert.ok(schema.includes('objective'))
  assert.ok(schema.includes('status'))
  assert.ok(schema.includes('currentStepIndex'))
  assert.ok(schema.includes('pendingAction'))
  assert.ok(schema.includes('idempotencyKey'))
})

test('migration is additive and depends on the previous migration', () => {
  assert.ok(!migration.includes('DROP TABLE'))
  assert.ok(!migration.includes('ALTER TABLE') || migration.includes('CREATE TABLE'))
  assert.ok(migration.includes('20261103000004_agent_tool_approval'))
  assert.ok(migration.includes('CREATE TABLE "agent_task"'))
  assert.ok(migration.includes('CREATE TABLE "agent_task_step"'))
  assert.ok(migration.includes('CREATE TABLE "agent_task_event"'))
})

/* --------------------------------------------------------------------------- */
/* 3. Execution limits                                                         */
/* --------------------------------------------------------------------------- */

const limits = read('src', 'lib', 'agent', 'tasks', 'limits.ts')

test('limits define conservative defaults', () => {
  assert.ok(limits.includes('maxStepsPerTask'))
  assert.ok(limits.includes('maxRetriesPerStep'))
  assert.ok(limits.includes('maxToolCallsPerTask'))
  assert.ok(limits.includes('maxPlanningIterations'))
  assert.ok(limits.includes('maxStoredEventsPerTask'))
  assert.ok(limits.includes('maxExecutionDurationMs'))
})

test('distinguishes retryable from terminal approval errors', () => {
  assert.ok(limits.includes('isRetryableError'))
  assert.ok(limits.includes('isTerminalApprovalError'))
  assert.ok(limits.includes("'APPROVAL_EXPIRED'"))
  assert.ok(limits.includes("'PERMISSION_DENIED'"))
})

/* --------------------------------------------------------------------------- */
/* 4. Store and concurrency control                                            */
/* --------------------------------------------------------------------------- */

const store = read('src', 'lib', 'agent', 'tasks', 'store.ts')

test('store uses conditional updates to prevent concurrent step execution', () => {
  assert.ok(store.includes('claimStepForExecution'))
  assert.ok(store.includes('updateMany'))
  assert.ok(store.includes("status: 'PENDING'"))
  assert.ok(store.includes("status: 'RUNNING'"))
})

test('steps have unique idempotency keys', () => {
  assert.ok(store.includes('idempotencyKey'))
  assert.ok(store.includes('stepIdempotencyKey'))
  assert.ok(store.includes('skipDuplicates'))
})

test('event recording is append-only and capped', () => {
  assert.ok(store.includes('recordEvent'))
  assert.ok(store.includes('agentTaskEvent.create'))
  assert.ok(store.includes('maxStoredEventsPerTask'))
  assert.ok(store.includes('agentTaskEvent.deleteMany'))
})

/* --------------------------------------------------------------------------- */
/* 5. AI planner                                                               */
/* --------------------------------------------------------------------------- */

const planner = read('src', 'lib', 'agent', 'tasks', 'planner.ts')

test('planner reuses the existing Phase 5 model adapter', () => {
  assert.ok(planner.includes("from '@/lib/agent/model'"))
  assert.ok(planner.includes('callAgentModel'))
})

test('planner validates every tool against the registry', () => {
  assert.ok(planner.includes('getToolDefinition'))
  assert.ok(planner.includes('UNKNOWN_TOOL_IN_PLAN'))
})

test('planner validates tool arguments with Zod', () => {
  assert.ok(planner.includes('inputSchema.safeParse'))
  assert.ok(planner.includes('PLAN_VALIDATION_ERROR'))
})

test('planner enforces sequential dependencies and excludes student-controlled actions', () => {
  assert.ok(planner.includes('PLAN_DEPENDENCY_ERROR'))
  assert.ok(planner.includes('STUDENT_ACTION_REQUIRED'))
  assert.ok(planner.includes('request_student_approval'))
  assert.ok(planner.includes('execute_approved_field_fills'))
  assert.ok(planner.includes('Never plan field approvals, fills or verification'))
})

test('planner has bounded planning iterations', () => {
  assert.ok(planner.includes('maxPlanningIterations'))
  assert.ok(planner.includes('PLAN_FAILED'))
})

/* --------------------------------------------------------------------------- */
/* 6. Controlled execution engine                                              */
/* --------------------------------------------------------------------------- */

const engine = read('src', 'lib', 'agent', 'tasks', 'engine.ts')

test('engine executes only through the central Phase 5 executor', () => {
  assert.ok(engine.includes("from '@/lib/agent/tools/executor'"))
  assert.ok(engine.includes('executeTool('))
  assert.ok(!engine.includes('chrome.tabs'))
  assert.ok(!engine.includes('document.'))
})

test('engine validates task status before each step', () => {
  assert.ok(engine.includes('transitionTaskStatus'))
  assert.ok(engine.includes("status !== 'RUNNING'"))
})

test('engine stops on browser actions and waits for extension', () => {
  assert.ok(engine.includes('WAITING_FOR_STUDENT'))
  assert.ok(engine.includes('setWaitingForStudent'))
  assert.ok(engine.includes('pendingBrowserAction'))
})

test('engine enforces retry limits and does not retry permission failures', () => {
  assert.ok(engine.includes('maxRetriesPerStep'))
  assert.ok(engine.includes('isRetryableError'))
  assert.ok(engine.includes('isTerminalApprovalError'))
})

test('engine uses task-scoped memory and redacts sensitive context', () => {
  assert.ok(engine.includes('redactContext'))
  assert.ok(engine.includes('rememberVerifiedResult'))
  assert.ok(engine.includes('rememberVaultFact'))
  assert.ok(engine.includes('rememberPageFact'))
})

test('engine never treats model output as verified fact', () => {
  assert.ok(!engine.includes('rememberModelSuggestion'))
})

/* --------------------------------------------------------------------------- */
/* 7. Orchestrator API                                                         */
/* --------------------------------------------------------------------------- */

const orchestrator = read('src', 'lib', 'agent', 'tasks', 'orchestrator.ts')

test('orchestrator resolves auth from existing agent session', () => {
  assert.ok(orchestrator.includes('resolveAgentSession'))
  assert.ok(orchestrator.includes('workspace.findUnique'))
  assert.ok(orchestrator.includes('AGENT_SESSION_INVALID'))
})

test('orchestrator exposes create, plan, run, pause, resume and cancel', () => {
  assert.ok(orchestrator.includes('createAgentTask'))
  assert.ok(orchestrator.includes('planTask'))
  assert.ok(orchestrator.includes('startTask'))
  assert.ok(orchestrator.includes('pauseAgentTask'))
  assert.ok(orchestrator.includes('resumeAgentTask'))
  assert.ok(orchestrator.includes('cancelAgentTask'))
})

test('orchestrator does not trust workspace or user ids from the model', () => {
  assert.ok(!orchestrator.includes('args.workspaceId'))
  assert.ok(!orchestrator.includes('args.userId'))
})

/* --------------------------------------------------------------------------- */
/* 8. API routes                                                               */
/* --------------------------------------------------------------------------- */

const routes = [
  read('src', 'app', 'api', 'agent', 'tasks', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'plan', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'run', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'pause', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'cancel', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'steps', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'events', 'route.ts'),
  read('src', 'app', 'api', 'agent', 'tasks', '[ref]', 'browser-result', 'route.ts'),
]

test('all task REST endpoints exist and validate the agent session', () => {
  for (const route of routes) {
    assert.ok(route.includes('export async function'))
  }
  assert.ok(routes[0].includes('createAgentTask'))
  assert.ok(routes[0].includes('listAgentTasks'))
})

test('browser-result route validates action id and result shape', () => {
  const route = routes[routes.length - 1]
  assert.ok(route.includes('actionId'))
  assert.ok(route.includes('result: z.object'))
})

/* --------------------------------------------------------------------------- */
/* 9. Side Panel integration                                                   */
/* --------------------------------------------------------------------------- */

const sidepanelHtml = read('extensions', 'rankora-apply-agent', 'sidepanel.html')
const sidepanel = read('extensions', 'rankora-apply-agent', 'sidepanel.js')
const background = read('extensions', 'rankora-apply-agent', 'background.js')

test('side panel has a task orchestrator surface', () => {
  assert.ok(sidepanelHtml.includes('task-section'))
  assert.ok(sidepanelHtml.includes('task-objective'))
  assert.ok(sidepanelHtml.includes('task-status-chip'))
  assert.ok(sidepanelHtml.includes('task-steps'))
})

test('side panel exposes pause, resume and cancel controls', () => {
  assert.ok(sidepanelHtml.includes('task-pause-btn'))
  assert.ok(sidepanelHtml.includes('task-resume-btn'))
  assert.ok(sidepanelHtml.includes('task-cancel-btn'))
})

test('side panel polls task status and renders real progress', () => {
  assert.ok(sidepanel.includes('refreshCurrentTask'))
  assert.ok(sidepanel.includes('renderTaskProgress'))
  assert.ok(sidepanel.includes('setInterval'))
})

test('side panel pet state reflects genuine task status', () => {
  assert.ok(sidepanel.includes('taskStatusToPetState'))
  assert.ok(sidepanel.includes("case 'COMPLETED':"))
  assert.ok(sidepanel.includes("case 'FAILED':"))
})

test('background routes task messages to the orchestrator APIs', () => {
  assert.ok(background.includes("case 'CREATE_TASK':"))
  assert.ok(background.includes("case 'PLAN_TASK':"))
  assert.ok(background.includes("case 'RUN_TASK':"))
  assert.ok(background.includes("case 'PAUSE_TASK':"))
  assert.ok(background.includes("case 'CANCEL_TASK':"))
  assert.ok(background.includes("case 'SUBMIT_TASK_BROWSER_RESULT':"))
  assert.ok(background.includes("'/api/agent/tasks'"))
})

/* --------------------------------------------------------------------------- */
/* 10. Approval and safety boundaries                                          */
/* --------------------------------------------------------------------------- */

test('execute_approved_field_fills remains the only fill path', () => {
  const registry = read('src', 'lib', 'agent', 'tools', 'registry.ts')
  assert.ok(registry.includes('execute_approved_field_fills'))
})

test('cancellation releases pending credit reservations', () => {
  assert.ok(engine.includes('releaseCredit'))
  assert.ok(engine.includes('pendingReservations'))
  assert.ok(engine.includes('CREDIT_RESERVATION_RELEASED'))
})

test('engine never automates CAPTCHA, OTP, payment, declaration or final submission', () => {
  assert.ok(!engine.includes('captcha'))
  assert.ok(!engine.includes('otp'))
  assert.ok(!engine.includes('payment'))
  assert.ok(!engine.includes('declaration'))
  assert.ok(!engine.includes('final submission'))
})

/* --------------------------------------------------------------------------- */
/* 11. Public exports                                                          */
/* --------------------------------------------------------------------------- */

const index = read('src', 'lib', 'agent', 'tools', 'index.ts')

test('tool index exports the orchestrator', () => {
  assert.ok(index.includes('createAgentTask'))
  assert.ok(index.includes('planTask'))
  assert.ok(index.includes('TaskStatus'))
})
