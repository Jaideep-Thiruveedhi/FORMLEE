/**
 * Agent tool permission constants and helpers.
 *
 * Tool permissions are granted from trusted server-side authentication ONLY.
 * The model never supplies them; the executor resolves them from the agent
 * session / workspace owner context.
 */

/** Permission categories every tool must declare. */
export type AgentPermission =
  | 'READ_PROFILE'
  | 'READ_APPLICATION'
  | 'READ_DOCUMENT_METADATA'
  | 'READ_DEADLINES'
  | 'SCAN_SUPPORTED_PAGE'
  | 'MAP_FIELDS'
  | 'CREATE_PREVIEW'
  | 'REQUEST_APPROVAL'
  | 'EXECUTE_APPROVED_FILL'
  | 'VERIFY_FILL'

export const AGENT_PERMISSIONS: AgentPermission[] = [
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

/** Actions that must come from the student's explicit Side Panel controls. */
export const STUDENT_ACTION_PERMISSIONS: AgentPermission[] = [
  'REQUEST_APPROVAL',
  'EXECUTE_APPROVED_FILL',
  'VERIFY_FILL',
]

/**
 * Kept for explicit student-action grants and backwards-compatible tests.
 * Ordinary paired sessions use agentSessionPermissions(false).
 */
export function allAgentPermissions(): AgentPermission[] {
  return [...AGENT_PERMISSIONS]
}

/**
 * A paired agent session is read/plan/preview scoped by default. The extension
 * may request the separate student-action grant only from an explicit review
 * control; model and task execution never receive these permissions.
 */
export function agentSessionPermissions(studentAction = false): AgentPermission[] {
  return AGENT_PERMISSIONS.filter(permission =>
    studentAction || !STUDENT_ACTION_PERMISSIONS.includes(permission)
  )
}

export function isStudentActionTool(name: string): boolean {
  return name === 'request_student_approval' ||
    name === 'execute_approved_field_fills' ||
    name === 'verify_filled_fields'
}

export function hasPermissions(
  held: AgentPermission[],
  required: AgentPermission[]
): { ok: true } | { ok: false; missing: AgentPermission[] } {
  const missing = required.filter(p => !held.includes(p))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
