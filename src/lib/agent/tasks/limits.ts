/**
 * Phase 6 — configurable execution limits for the Agent Task Orchestrator.
 *
 * All limits are conservative defaults. They can be overridden per task via
 * options in the orchestrator without changing these guards.
 */

export interface TaskLimits {
  maxStepsPerTask: number
  maxToolCallsPerTask: number
  maxRetriesPerStep: number
  maxExecutionDurationMs: number
  maxPlanningIterations: number
  maxStoredEventsPerTask: number
  defaultTaskExpiryMinutes: number
  maxTaskExpiryMinutes: number
}

export const DEFAULT_TASK_LIMITS: TaskLimits = {
  maxStepsPerTask: 20,
  maxToolCallsPerTask: 50,
  maxRetriesPerStep: 3,
  maxExecutionDurationMs: 15 * 60 * 1000,
  maxPlanningIterations: 3,
  maxStoredEventsPerTask: 200,
  defaultTaskExpiryMinutes: 60,
  maxTaskExpiryMinutes: 24 * 60,
}

export function clampExpiryMinutes(input: number | undefined, limits = DEFAULT_TASK_LIMITS): number {
  const value = typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : limits.defaultTaskExpiryMinutes
  return Math.min(value, limits.maxTaskExpiryMinutes)
}

export function isRetryableError(code: string | undefined): boolean {
  if (!code) return false
  const retryable = new Set([
    'NETWORK',
    'EXECUTION_ERROR',
    'MODEL_ERROR',
    'TIMEOUT',
    'NO_CONTENT_SCRIPT',
    'PAGE_CHECK_FAILED',
  ])
  return retryable.has(code)
}

export function isTerminalApprovalError(code: string | undefined): boolean {
  if (!code) return false
  const terminal = new Set([
    'APPROVAL_EXPIRED',
    'APPROVAL_REVOKED',
    'APPROVAL_USED',
    'PAGE_CHANGED',
    'MAPPING_CHANGED',
    'VALUES_CHANGED',
    'ADAPTER_MISMATCH',
    'SESSION_MISMATCH',
    'CROSS_WORKSPACE',
    'PERMISSION_DENIED',
    'UNKNOWN_TOOL_IN_PLAN',
    'VALIDATION_ERROR',
  ])
  return terminal.has(code)
}
