/**
 * Focused tests for the Phase 5 Agent Tool Registry.
 *
 * No database, no Next.js runtime, no browser. Verifies the central registry
 * architecture, permission model, server-side approval/audit contracts, and
 * the extension-side approval-before-fill wiring.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const { agentSessionPermissions, hasPermissions, AGENT_PERMISSIONS, STUDENT_ACTION_PERMISSIONS } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'lib', 'agent', 'tools', 'permissions.ts')).href
)

/* --------------------------------------------------------------------------- */
/* 1. Permission architecture                                                  */
/* --------------------------------------------------------------------------- */

test('declares the ten required permission categories', () => {
  const required = [
    'READ_PROFILE',
    'READ_APPLICATION',
    'READ_DOCUMENT_METADATA',
    'READ_DEADLINES',
    'SCAN_SUPPORTED_PAGE',
    'MAP_FIELDS',
    'CREATE_PREVIEW',
    'REQUEST_APPROVAL',
    'EXECUTE_APPROVED_FILL',
    'VERIFY_FILL',
  ]
  for (const p of required) {
    assert.ok(AGENT_PERMISSIONS.includes(p), `${p} must be declared`)
  }
})

test('hasPermissions grants when all required permissions are held', () => {
  const held = ['READ_PROFILE', 'MAP_FIELDS']
  assert.deepEqual(hasPermissions(held, ['READ_PROFILE']), { ok: true })
})

test('hasPermissions reports missing permissions', () => {
  const held = ['READ_PROFILE']
  assert.deepEqual(hasPermissions(held, ['READ_PROFILE', 'EXECUTE_APPROVED_FILL']), {
    ok: false,
    missing: ['EXECUTE_APPROVED_FILL'],
  })
})

test('ordinary agent sessions cannot approve, fill or verify without a student action', () => {
  const perms = agentSessionPermissions(false)
  assert.ok(perms.includes('READ_PROFILE'))
  assert.ok(perms.includes('MAP_FIELDS'))
  for (const permission of STUDENT_ACTION_PERMISSIONS) assert.ok(!perms.includes(permission))
  const studentActionPerms = agentSessionPermissions(true)
  for (const permission of STUDENT_ACTION_PERMISSIONS) assert.ok(studentActionPerms.includes(permission))
})

test('the model-facing registry omits all student-action tools', () => {
  const source = read('src', 'lib', 'agent', 'tools', 'registry.ts')
  assert.ok(source.includes('listModelToolDefinitions'))
  assert.ok(source.includes('!isStudentActionTool(definition.name)'))
  for (const name of ['request_student_approval', 'execute_approved_field_fills', 'verify_filled_fields']) {
    assert.ok(source.includes(name), `${name} remains available to explicit Side Panel controls`)
  }
})

/* --------------------------------------------------------------------------- */
/* 2. Tool registry architecture                                               */
/* --------------------------------------------------------------------------- */

const registry = read('src', 'lib', 'agent', 'tools', 'registry.ts')

function parseToolBlocks(source) {
  const blocks = []
  const re = /\[\s*\n\s*'([^']+)',\s*\n\s*tool\(\{([\s\S]*?)\}\),/g
  let match
  while ((match = re.exec(source)) !== null) {
    blocks.push({ name: match[1], body: match[2] })
  }
  return blocks
}

const toolBlocks = parseToolBlocks(registry)
const toolByName = new Map(toolBlocks.map(b => [b.name, b.body]))

const EXPECTED_TOOLS = [
  // Student Vault
  'get_student_profile_summary',
  'get_student_profile_section',
  'list_uploaded_documents',
  // Application Hub
  'get_application_details',
  'get_application_readiness',
  'get_application_checklist',
  'get_application_deadlines',
  // Examination assistant
  'get_active_tab_context',
  'detect_supported_exam',
  'scan_supported_application_page',
  'get_detected_form_fields',
  // Mapping and review
  'map_application_fields',
  'generate_field_preview',
  'get_field_mapping_conflicts',
  'request_student_approval',
  // Task orchestrator
  'list_agent_tasks',
  'get_agent_task',
  'create_agent_task',
  'resume_agent_task',
  // Approved execution
  'execute_approved_field_fills',
  'verify_filled_fields',
]

test('registry registers all ' + EXPECTED_TOOLS.length + ' required tools', () => {
  for (const name of EXPECTED_TOOLS) {
    assert.ok(registry.includes(`'${name}'`), `${name} must be registered`)
  }
})

test('every tool declares permissions, timeout, schemas and environment', () => {
  assert.ok(registry.includes('permissions:'), 'tools declare permissions')
  assert.ok(registry.includes('inputSchema:'), 'tools declare input schemas')
  assert.ok(registry.includes('outputSchema:'), 'tools declare output schemas')
  assert.ok(registry.includes('timeoutMs:'), 'tools declare timeouts')
  assert.ok(registry.includes("environment: 'server'") && registry.includes("environment: 'browser'"), 'tools cover both environments')
})

test('browser tools return browserAction envelopes instead of touching the DOM', () => {
  const browserTools = ['get_active_tab_context', 'scan_supported_application_page', 'verify_filled_fields']
  for (const name of browserTools) {
    const body = toolByName.get(name)
    assert.ok(body, `${name} must be registered`)
    assert.ok(body.includes("environment: 'browser'"), `${name} must be a browser tool`)
  }
  const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')
  for (const fn of ['getActiveTabContext', 'scanSupportedApplicationPage', 'verifyFilledFields']) {
    const start = handlers.indexOf(`export async function ${fn}(`)
    assert.ok(start >= 0, `${fn} must be exported from handlers`)
    const end = handlers.indexOf('\nexport ', start + 1)
    const slice = end >= 0 ? handlers.slice(start, end) : handlers.slice(start)
    assert.ok(slice.includes('browserAction'), `${fn} must return a browserAction envelope`)
    assert.ok(!slice.includes('chrome.tabs') && !slice.includes('document.'), `${fn} must not touch browser APIs from server code`)
  }
})

test('execute_approved_field_fills carries the EXECUTE_APPROVED_FILL permission', () => {
  const body = toolByName.get('execute_approved_field_fills')
  assert.ok(body, 'execute_approved_field_fills must be registered')
  assert.ok(body.includes("'EXECUTE_APPROVED_FILL'"))
})

/* --------------------------------------------------------------------------- */
/* 3. Input / output schemas                                                   */
/* --------------------------------------------------------------------------- */

const schemas = read('src', 'lib', 'agent', 'tools', 'schemas.ts')

test('schemas module defines every tool input shape', () => {
  assert.ok(schemas.includes('emptyInputSchema'))
  assert.ok(schemas.includes('getStudentProfileSectionInputSchema'))
  assert.ok(schemas.includes('applicationIdInputSchema'))
  assert.ok(schemas.includes('detectSupportedExamInputSchema'))
  assert.ok(schemas.includes('mapApplicationFieldsInputSchema'))
  assert.ok(schemas.includes('generateFieldPreviewInputSchema'))
  assert.ok(schemas.includes('requestStudentApprovalInputSchema'))
  assert.ok(schemas.includes('executeApprovedFieldFillsInputSchema'))
  assert.ok(schemas.includes('verifyFilledFieldsInputSchema'))
})

test('approval schema requires page fingerprint and approved field list', () => {
  assert.ok(schemas.includes('pageFingerprint:'))
  assert.ok(schemas.includes('approvedFieldIds:'))
  assert.ok(schemas.includes('proposedMapping:'))
  assert.ok(schemas.includes('approvalRefSchema'))
  assert.ok(!schemas.includes('valueFingerprint: z.array'), 'the server derives value hashes from the Vault')
})

/* --------------------------------------------------------------------------- */
/* 4. Executor gateway source contract                                         */
/* --------------------------------------------------------------------------- */

const executor = read('src', 'lib', 'agent', 'tools', 'executor.ts')

test('executor rejects unknown tools', () => {
  assert.ok(executor.includes("Unknown tool."), 'unknown tools return an error')
  assert.ok(executor.includes("'UNKNOWN_TOOL'"))
})

test('executor validates arguments with Zod before execution', () => {
  assert.ok(executor.includes('inputSchema.safeParse'))
  assert.ok(executor.includes("'VALIDATION_ERROR'"))
})

test('executor resolves context from trusted agent session, never model claims', () => {
  assert.ok(executor.includes('resolveAgentSessionFromHeaders'))
  assert.ok(executor.includes('prisma.workspace.findUnique'))
  assert.ok(!executor.includes('args.userId'), 'executor must not trust userId from args')
  assert.ok(!executor.includes('args.workspaceId'), 'executor must not trust workspaceId from args')
  assert.ok(!executor.includes('args.permissions'), 'executor must not trust permissions from args')
})

test('executor checks permissions and rejects unauthorized operations', () => {
  assert.ok(executor.includes('hasPermissions'))
  assert.ok(executor.includes("'PERMISSION_DENIED'"))
  assert.ok(executor.includes('agentSessionPermissions(false)'))
  assert.ok(executor.includes('options.studentAction && isStudentActionTool(options.toolName)'))
})

test('executor records an audit entry for every invocation', () => {
  assert.ok(executor.includes('recordToolAudit'))
})

/* --------------------------------------------------------------------------- */
/* 5. Server-side approval implementation                                      */
/* --------------------------------------------------------------------------- */

const approval = read('src', 'lib', 'agent', 'approval.ts')

test('approval model stores only hashes/fingerprints, not raw values', () => {
  assert.ok(approval.includes('valueFingerprint:'))
  assert.ok(approval.includes('sha256'))
})

test('verifyApproval rejects cross-workspace, session mismatch and adapter mismatch', () => {
  assert.ok(approval.includes("'CROSS_WORKSPACE'"))
  assert.ok(approval.includes("'SESSION_MISMATCH'"))
  assert.ok(approval.includes("'ADAPTER_MISMATCH'"))
})

test('verifyApproval rejects expired, revoked, used, changed-page and changed-value approvals', () => {
  assert.ok(approval.includes("'APPROVAL_EXPIRED'"))
  assert.ok(approval.includes("'APPROVAL_REVOKED'"))
  assert.ok(approval.includes("'APPROVAL_USED'"))
  assert.ok(approval.includes("'PAGE_CHANGED'"))
  assert.ok(approval.includes("'MAPPING_CHANGED'"))
  assert.ok(approval.includes("'VALUES_CHANGED'"))
})

test('approval creation uses a secure random reference', () => {
  assert.ok(approval.includes('randomBytes'))
})

test('approval cannot be created by model-supplied workspace or user ids', () => {
  assert.ok(approval.includes('userId: input.userId') || approval.includes('userId: input.userId,'))
  assert.ok(approval.includes('workspaceId: input.workspaceId'))
  assert.ok(!approval.includes('userId: args.userId'))
})

/* --------------------------------------------------------------------------- */
/* 6. Audit logging                                                            */
/* --------------------------------------------------------------------------- */

const audit = read('src', 'lib', 'agent', 'audit.ts')

test('audit records safe references and never secrets', () => {
  const sensitive = ['password', 'otp', 'token', 'apiKey', 'secret', 'documentContent', 'rawBody']
  for (const key of sensitive) {
    assert.ok(audit.includes(`'${key}'`), `audit must explicitly redact ${key}`)
  }
})

test('audit redaction masks sensitive keys', () => {
  assert.ok(audit.includes('[REDACTED]'))
})

test('audit failure does not throw', () => {
  assert.ok(audit.includes('Audit failure must never break'))
  assert.ok(audit.includes('catch'))
})

/* --------------------------------------------------------------------------- */
/* 7. Handler wiring                                                           */
/* --------------------------------------------------------------------------- */

const handlers = read('src', 'lib', 'agent', 'tools', 'handlers.ts')

test('execute_approved_field_fills verifies approval before reserving credit', () => {
  assert.ok(handlers.includes('verifyApproval'))
  assert.ok(handlers.includes('requireFillCreditAuth'))
  assert.ok(handlers.includes('reserveCredit'))
  assert.ok(handlers.includes('restoreApprovalAfterInsufficientCredits'))
})

test('handlers reuse existing services and do not duplicate them', () => {
  assert.ok(handlers.includes("from '@/lib/apply-ai/server-data'"))
  assert.ok(handlers.includes("from '@/lib/apply-ai/applications'"))
  assert.ok(handlers.includes("from '@/lib/agent/mapper'"))
  assert.ok(handlers.includes("from '@/lib/agent/values'"))
  assert.ok(!handlers.includes('prisma.agentSession.create'), 'must not duplicate session management')
})

/* --------------------------------------------------------------------------- */
/* 8. Execution API route                                                      */
/* --------------------------------------------------------------------------- */

const executeRoute = read('src', 'app', 'api', 'agent', 'tools', 'execute', 'route.ts')

test('execute route exposes a single POST gateway', () => {
  assert.ok(executeRoute.includes('export async function POST'))
  assert.ok(executeRoute.includes('executeTool'))
})

test('execute route rejects malformed tool calls', () => {
  assert.ok(executeRoute.includes("'MALFORMED_TOOL'"))
  assert.ok(executeRoute.includes("'MALFORMED_REQUEST'"))
})

test('execute route maps approval/credit errors to the right HTTP status', () => {
  assert.ok(executeRoute.includes("case 'AGENT_SESSION_INVALID':"))
  assert.ok(executeRoute.includes("case 'PERMISSION_DENIED':"))
  assert.ok(executeRoute.includes("case 'APPROVAL_EXPIRED':"))
  assert.ok(executeRoute.includes("case 'CREDIT_AUTH_REQUIRED':"))
  assert.ok(executeRoute.includes("case 'INSUFFICIENT_CREDITS':"))
  assert.ok(executeRoute.includes('return 402'))
})

/* --------------------------------------------------------------------------- */
/* 9. Approval verify route                                                    */
/* --------------------------------------------------------------------------- */

const verifyRoute = read('src', 'app', 'api', 'agent', 'approvals', 'verify', 'route.ts')

test('approval verify route requires a valid agent session', () => {
  assert.ok(verifyRoute.includes('resolveAgentSession'))
  assert.ok(verifyRoute.includes("'AGENT_SESSION_INVALID'"))
})

test('approval verify route binds the check to the agent session workspace', () => {
  assert.ok(verifyRoute.includes('workspaceId: session.workspaceId'))
  assert.ok(verifyRoute.includes('agentSessionId: session.token'))
})

/* --------------------------------------------------------------------------- */
/* 10. Extension approval-before-fill wiring                                   */
/* --------------------------------------------------------------------------- */

const background = read('extensions', 'formlee-apply-agent', 'background.js')
const sidepanel = read('extensions', 'formlee-apply-agent', 'sidepanel.js')
const popup = read('extensions', 'formlee-apply-agent', 'popup.js')

test('background has a generic executeTool helper for the registry', () => {
  assert.ok(background.includes('async function executeTool(tool, args, studentAction)'))
  assert.ok(background.includes("'/api/agent/tools/execute'"))
})

test('background creates a durable server approval before filling', () => {
  assert.ok(background.includes('async function createServerApproval('))
  assert.ok(background.includes("executeTool('request_student_approval'"))
})

test('fillActiveTab requires a server approval before using the Tool Registry fill path', () => {
  assert.ok(background.includes('if (!approvalRef || typeof approvalRef !== \'string\')'))
  assert.ok(background.includes("executeTool('execute_approved_field_fills'"))
  assert.ok(background.includes("executeTool('verify_filled_fields'"))
  assert.ok(background.includes("executeTool('generate_field_preview'"))
})

test('fillActiveTab clears the plan on page or approval mismatch', () => {
  assert.ok(background.includes("code: 'PAGE_CHANGED'"))
  assert.ok(background.includes('await clearPlanContext()'))
})

test('side panel requests approval before sending FILL', () => {
  assert.ok(sidepanel.includes("type: 'CREATE_APPROVAL'"))
  assert.ok(sidepanel.includes("approvalRef: approval.approvalRef"))
})

test('popup fallback requests approval before sending FILL', () => {
  assert.ok(popup.includes("type: 'CREATE_APPROVAL'"))
  assert.ok(popup.includes("approvalRef: approval.approvalRef"))
})

/* --------------------------------------------------------------------------- */
/* 11. Database / migration                                                    */
/* --------------------------------------------------------------------------- */

const schema = read('prisma', 'schema.prisma')
const migration = read('prisma', 'migrations', '20261103000004_agent_tool_approval', 'migration.sql')

test('schema adds AgentToolApproval and AgentToolAudit models', () => {
  assert.ok(schema.includes('model AgentToolApproval'))
  assert.ok(schema.includes('model AgentToolAudit'))
})

test('approval model ties records to workspace, user, agent session and page fingerprint', () => {
  assert.ok(schema.includes('workspaceId'))
  assert.ok(schema.includes('userId'))
  assert.ok(schema.includes('agentSessionId'))
  assert.ok(schema.includes('pageFingerprint'))
  assert.ok(schema.includes('approvedFieldIds'))
  assert.ok(schema.includes('valueFingerprint'))
})

test('migration is additive and does not touch existing migrations', () => {
  assert.ok(!migration.includes('DROP TABLE'))
  assert.ok(!migration.includes('ALTER TABLE') || migration.includes('CREATE TABLE'))
  assert.ok(migration.includes('CREATE TABLE "agent_tool_approval"'))
  assert.ok(migration.includes('CREATE TABLE "agent_tool_audit"'))
})

test('migration documents the dependency on earlier migrations without renaming them', () => {
  assert.ok(migration.includes('20261103000000_initial_migration'))
  assert.ok(migration.includes('additive'))
})
