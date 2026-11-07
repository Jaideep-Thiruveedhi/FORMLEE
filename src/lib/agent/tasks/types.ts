/**
 * Phase 6 — Agent Task Orchestrator types.
 *
 * Task statuses, step statuses and shared interfaces for durable multi-step
 * execution. No business logic here.
 */

export type TaskStatus =
  | 'CREATED'
  | 'PLANNING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_FOR_STUDENT'
  | 'PAUSED'
  | 'RETRYING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

export type StepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'WAITING_FOR_STUDENT'
  | 'SKIPPED'

export type TaskEventType =
  | 'TASK_CREATED'
  | 'PLANNING_STARTED'
  | 'PLAN_COMPLETED'
  | 'PLAN_FAILED'
  | 'EXECUTION_STARTED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'STEP_RETRYING'
  | 'WAITING_FOR_STUDENT'
  | 'BROWSER_ACTION_DISPATCHED'
  | 'BROWSER_ACTION_RESULT_RECEIVED'
  | 'TASK_PAUSED'
  | 'TASK_RESUMED'
  | 'TASK_CANCELLED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_EXPIRED'
  | 'CREDIT_RESERVATION_RELEASED'

export interface TaskPlanStep {
  stepIndex: number
  toolName: string
  description: string
  args?: Record<string, unknown>
  dependsOn?: number
  requiresStudentApproval?: boolean
}

export interface TaskPlan {
  explanation: string
  steps: TaskPlanStep[]
}

export interface TaskContext {
  applicationId?: string
  lastAdapterId?: string
  lastPageUrl?: string
  lastPageFingerprint?: string
  lastScanResult?: Record<string, unknown>
  pendingApprovalRef?: string
  pendingReservations?: string[]
  studentDecisions?: Record<string, unknown>
  unresolvedIssues?: string[]
  lastToolResults?: Record<string, unknown>
  totalToolCalls?: number
}

export interface TaskExecutionResult {
  ok: boolean
  taskRef: string
  status: TaskStatus
  currentStepIndex: number
  pendingBrowserAction?: {
    type: string
    payload?: Record<string, unknown>
    actionId: string
  }
  message?: string
  errorCode?: string
}

export interface CreateTaskInput {
  request: Request
  objective: string
  applicationId?: string
  expiresInMinutes?: number
}

export interface TaskAuthorizationContext {
  userId: string
  workspaceId: string
  agentSessionId: string
}
