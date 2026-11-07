/**
 * Phase 6 — Controlled Task Execution Engine.
 *
 * Executes a validated task plan one step at a time, using ONLY the existing
 * Phase 5 Tool Registry as the execution gateway. It enforces:
 *   - task status validation before every step
 *   - step definition validation
 *   - permission revalidation (handled by the central executor)
 *   - audit recording (handled by the central executor)
 *   - browser actions stop and wait for the extension
 *   - retry limits and backoff for transient failures
 *   - never continues after safety-critical failures
 */

import { executeTool } from '@/lib/agent/tools/executor'
import { getToolDefinition } from '@/lib/agent/tools/registry'
import { isStudentActionTool } from '@/lib/agent/tools/permissions'
import type { ToolResult } from '@/lib/agent/tools/types'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { releaseCredit } from '@/lib/billing/credits'
import type {
  TaskAuthorizationContext,
  TaskContext,
  TaskExecutionResult,
  TaskPlanStep,
  TaskStatus,
} from './types'
import {
  claimStepForExecution,
  completeStep,
  failStep,
  loadPlanSteps,
  loadStep,
  recordEvent,
  setWaitingForStudent,
  transitionTaskStatus,
} from './store'
import {
  DEFAULT_TASK_LIMITS,
  isRetryableError,
  isTerminalApprovalError,
} from './limits'
import { parseContext, redactContext, rememberPageFact, rememberVerifiedResult, rememberVaultFact, rememberStudentDecision } from './memory'

export interface EngineOptions {
  maxSteps?: number
  maxToolCalls?: number
  signal?: AbortSignal
}

export interface ExecuteStepResult {
  ok: boolean
  taskStatus: TaskStatus
  currentStepIndex: number
  pendingBrowserAction?: {
    type: string
    payload?: Record<string, unknown>
    actionId: string
  }
  message?: string
  errorCode?: string
}

export async function runTask(
  taskId: string,
  auth: TaskAuthorizationContext,
  request: Request,
  options: EngineOptions = {}
): Promise<TaskExecutionResult> {
  const limits = {
    maxSteps: Math.min(options.maxSteps ?? DEFAULT_TASK_LIMITS.maxStepsPerTask, DEFAULT_TASK_LIMITS.maxStepsPerTask),
    maxToolCalls: Math.min(options.maxToolCalls ?? DEFAULT_TASK_LIMITS.maxToolCallsPerTask, DEFAULT_TASK_LIMITS.maxToolCallsPerTask),
  }

  // Atomically claim the task for execution. RUNNING is included so a resume
  // or browser-result continuation can keep executing without a second transition.
  const claimed = await transitionTaskStatus(
    taskId,
    ['READY', 'PAUSED', 'RETRYING', 'RUNNING'],
    'RUNNING',
    { startedAt: new Date() }
  )
  if (!claimed) {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
    if (!task) return { ok: false, taskRef: '', status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
    return {
      ok: false,
      taskRef: task.ref,
      status: task.status as TaskStatus,
      currentStepIndex: task.currentStepIndex,
      errorCode: 'TASK_NOT_EXECUTABLE',
      message: `Task is ${task.status} and cannot be started right now.`,
    }
  }

  await recordEvent(taskId, 'EXECUTION_STARTED')
  return continueExecution(taskId, auth, request, options, claimed)
}

async function continueExecution(
  taskId: string,
  auth: TaskAuthorizationContext,
  request: Request,
  options: EngineOptions,
  task: { id: string; ref: string; currentStepIndex: number; context: Prisma.JsonValue | null }
): Promise<TaskExecutionResult> {
  const limits = {
    maxSteps: Math.min(options.maxSteps ?? DEFAULT_TASK_LIMITS.maxStepsPerTask, DEFAULT_TASK_LIMITS.maxStepsPerTask),
    maxToolCalls: Math.min(options.maxToolCalls ?? DEFAULT_TASK_LIMITS.maxToolCallsPerTask, DEFAULT_TASK_LIMITS.maxToolCallsPerTask),
  }

  const steps = await loadPlanSteps(taskId)
  if (steps.length === 0) {
    await finalizeTask(taskId, 'FAILED', 'Task has no steps.', 'NO_STEPS')
    return { ok: false, taskRef: task.ref, status: 'FAILED', currentStepIndex: -1, errorCode: 'NO_STEPS' }
  }

  let currentStepIndex = Math.max(0, task.currentStepIndex)
  let totalToolCalls = parseContext(task.context).totalToolCalls ?? 0
  let ctx = parseContext(task.context)

  while (currentStepIndex < steps.length && currentStepIndex < limits.maxSteps) {
    if (options.signal?.aborted) {
      await finalizeTask(taskId, 'PAUSED', 'Execution was cancelled by the caller.', 'ABORTED')
      return { ok: false, taskRef: task.ref, status: 'PAUSED', currentStepIndex, errorCode: 'ABORTED' }
    }

    const currentTask = await prisma.agentTask.findUnique({ where: { id: taskId } })
    if (!currentTask) return { ok: false, taskRef: task.ref, status: 'FAILED', currentStepIndex, errorCode: 'TASK_NOT_FOUND' }
    if (currentTask.status === 'CANCELLED' || currentTask.status === 'PAUSED') {
      return {
        ok: currentTask.status === 'PAUSED',
        taskRef: currentTask.ref,
        status: currentTask.status as TaskStatus,
        currentStepIndex,
        message: `Task ${currentTask.status.toLowerCase()} by student.`,
      }
    }
    if (currentTask.status === 'EXPIRED' || currentTask.expiresAt.getTime() <= Date.now()) {
      await finalizeTask(taskId, 'EXPIRED', 'Task expired.', 'TASK_EXPIRED')
      return { ok: false, taskRef: currentTask.ref, status: 'EXPIRED', currentStepIndex, errorCode: 'TASK_EXPIRED' }
    }
    if (currentTask.status !== 'RUNNING') {
      return {
        ok: false,
        taskRef: currentTask.ref,
        status: currentTask.status as TaskStatus,
        currentStepIndex,
        errorCode: 'TASK_NOT_RUNNING',
      }
    }

    if (totalToolCalls >= limits.maxToolCalls) {
      await finalizeTask(taskId, 'FAILED', 'Reached the maximum number of tool calls for this task.', 'TOOL_CALL_LIMIT')
      return { ok: false, taskRef: currentTask.ref, status: 'FAILED', currentStepIndex, errorCode: 'TOOL_CALL_LIMIT' }
    }

    const stepResult = await executeSingleStep(taskId, currentStepIndex, steps[currentStepIndex], auth, request, ctx)
    totalToolCalls += 1
    ctx = stepResult.updatedContext

    if (stepResult.pendingBrowserAction) {
      return {
        ok: true,
        taskRef: currentTask.ref,
        status: 'WAITING_FOR_STUDENT',
        currentStepIndex,
        pendingBrowserAction: stepResult.pendingBrowserAction,
        message: 'Waiting for the browser extension to complete this step.',
      }
    }

    if (!stepResult.ok) {
      return {
        ok: false,
        taskRef: currentTask.ref,
        status: stepResult.taskStatus,
        currentStepIndex,
        errorCode: stepResult.errorCode,
        message: stepResult.message,
      }
    }

    currentStepIndex += 1
  }

  const allSteps = await loadPlanSteps(taskId)
  const completedCount = (await prisma.agentTaskStep.count({ where: { taskId, status: 'COMPLETED' } }))
  const finalStatus: TaskStatus = completedCount === allSteps.length ? 'COMPLETED' : 'PARTIALLY_COMPLETED'
  await finalizeTask(
    taskId,
    finalStatus,
    finalStatus === 'COMPLETED' ? 'All steps completed.' : 'Some steps could not be completed.',
    undefined,
    ctx
  )
  return {
    ok: finalStatus === 'COMPLETED',
    taskRef: task.ref,
    status: finalStatus,
    currentStepIndex,
    message: finalStatus === 'COMPLETED' ? 'Task completed.' : 'Task partially completed.',
  }
}

interface SingleStepResult {
  ok: boolean
  taskStatus: TaskStatus
  pendingBrowserAction?: { type: string; payload?: Record<string, unknown>; actionId: string }
  errorCode?: string
  message?: string
  updatedContext: TaskContext
}

async function executeSingleStep(
  taskId: string,
  stepIndex: number,
  step: TaskPlanStep,
  auth: TaskAuthorizationContext,
  request: Request,
  ctx: TaskContext
): Promise<SingleStepResult> {
  // 1. Validate step definition against registry.
  const definition = getToolDefinition(step.toolName)
  if (!definition) {
    await failStep(taskId, stepIndex, 'UNKNOWN_TOOL_IN_PLAN', `Unknown tool: ${step.toolName}`, 0, 'FAILED')
    return { ok: false, taskStatus: 'FAILED', errorCode: 'UNKNOWN_TOOL_IN_PLAN', message: `Unknown tool: ${step.toolName}`, updatedContext: ctx }
  }

  if (isStudentActionTool(step.toolName)) {
    await failStep(taskId, stepIndex, 'STUDENT_ACTION_REQUIRED', 'Field approval and filling must be started from the student review controls.', 0, 'FAILED')
    await finalizeTask(taskId, 'FAILED', 'Field approval and filling must be started from the student review controls.', 'STUDENT_ACTION_REQUIRED', ctx)
    return { ok: false, taskStatus: 'FAILED', errorCode: 'STUDENT_ACTION_REQUIRED', message: 'Review and approve field values in the Side Panel to continue.', updatedContext: ctx }
  }

  // 2. Prevent concurrent execution of the same step.
  const claim = await claimStepForExecution(taskId, stepIndex)
  if (!claim.ok) {
    return {
      ok: false,
      taskStatus: 'RUNNING',
      errorCode: claim.reason,
      message: `Could not claim step ${stepIndex}: ${claim.reason}`,
      updatedContext: ctx,
    }
  }

  await recordEvent(taskId, 'STEP_STARTED', stepIndex, { toolName: step.toolName })

  // 3. Resolve dependency: previous step must be completed.
  const previousIndex = typeof step.dependsOn === 'number' ? step.dependsOn : stepIndex > 0 ? stepIndex - 1 : undefined
  if (typeof previousIndex === 'number') {
    const dep = await loadStep(taskId, previousIndex)
    if (!dep || dep.status !== 'COMPLETED') {
      await failStep(taskId, stepIndex, 'DEPENDENCY_NOT_MET', `Dependency step ${previousIndex} is not completed.`, 0, 'FAILED')
      return {
        ok: false,
        taskStatus: 'FAILED',
        errorCode: 'DEPENDENCY_NOT_MET',
        message: `Dependency step ${previousIndex} is not completed.`,
        updatedContext: ctx,
      }
    }
  }

  // 4. Execute through the central executor.
  const execResult = await executeTool({
    request,
    toolName: step.toolName,
    args: step.args,
  })

  if (!execResult.ok) {
    const code = execResult.code ?? 'EXECUTION_ERROR'
    const retryable = isRetryableError(code)
    const terminal = isTerminalApprovalError(code)
    const existing = await prisma.agentTaskStep.findUnique({
      where: { taskId_stepIndex: { taskId, stepIndex } },
    })
    const retryCount = (existing?.retryCount ?? 0) + 1
    const shouldRetry = retryable && retryCount <= DEFAULT_TASK_LIMITS.maxRetriesPerStep && !terminal
    const taskStatus: TaskStatus = shouldRetry ? 'RETRYING' : terminal ? 'WAITING_FOR_STUDENT' : 'FAILED'

    await failStep(taskId, stepIndex, code, execResult.error ?? 'Execution failed.', retryCount, taskStatus)
    await recordEvent(taskId, 'STEP_FAILED', stepIndex, { toolName: step.toolName, code, retryCount })

    if (shouldRetry) {
      // The task is in RETRYING; a resume will re-run this step.
      return {
        ok: false,
        taskStatus,
        errorCode: code,
        message: `Step ${stepIndex} failed with ${code}; will retry (${retryCount}/${DEFAULT_TASK_LIMITS.maxRetriesPerStep}).`,
        updatedContext: ctx,
      }
    }

    if (terminal) {
      return {
        ok: false,
        taskStatus,
        errorCode: code,
        message: execResult.error ?? 'Approval or page context is no longer valid.',
        updatedContext: ctx,
      }
    }

    await finalizeTask(taskId, 'FAILED', execResult.error ?? 'Execution failed.', code, ctx)
    return {
      ok: false,
      taskStatus: 'FAILED',
      errorCode: code,
      message: execResult.error ?? 'Execution failed.',
      updatedContext: ctx,
    }
  }

  // 5. Process successful result.
  const result = execResult.result as ToolResult | undefined
  if (!result) {
    await failStep(taskId, stepIndex, 'EMPTY_RESULT', 'Tool returned an empty result.', 0, 'FAILED')
    await finalizeTask(taskId, 'FAILED', 'Tool returned an empty result.', 'EMPTY_RESULT', ctx)
    return { ok: false, taskStatus: 'FAILED', errorCode: 'EMPTY_RESULT', updatedContext: ctx }
  }

  // 6. Browser action envelope: stop and wait for extension.
  if (result.browserAction) {
    const actionId = await setWaitingForStudent(
      taskId,
      stepIndex,
      {
        type: result.browserAction.type,
        payload: result.browserAction.payload,
      },
      redactContext(ctx) as unknown as Prisma.InputJsonValue
    )
    await recordEvent(taskId, 'BROWSER_ACTION_DISPATCHED', stepIndex, { actionType: result.browserAction.type })
    return {
      ok: true,
      taskStatus: 'WAITING_FOR_STUDENT',
      pendingBrowserAction: {
        type: result.browserAction.type,
        payload: result.browserAction.payload,
        actionId,
      },
      updatedContext: ctx,
    }
  }

  // 7. Update context with safe, categorized facts.
  const updatedContext = updateContextFromResult(ctx, step, result, stepIndex)

  // 8. Track pending reservations from execute_approved_field_fills.
  if (step.toolName === 'execute_approved_field_fills' && result.ok && result.data && typeof result.data === 'object') {
    const reservationId = (result.data as Record<string, unknown>).reservationId
    if (typeof reservationId === 'string') {
      const reservations = [...(updatedContext.pendingReservations ?? [])]
      if (!reservations.includes(reservationId)) reservations.push(reservationId)
      updatedContext.pendingReservations = reservations
    }
  }

  await completeStep(
    taskId,
    stepIndex,
    { ok: true, data: result.data } as unknown as Prisma.InputJsonValue,
    'RUNNING',
    {
      currentStepIndex: stepIndex + 1,
      context: redactContext(updatedContext) as unknown as Prisma.InputJsonValue,
    }
  )
  await recordEvent(taskId, 'STEP_COMPLETED', stepIndex, { toolName: step.toolName })

  return {
    ok: true,
    taskStatus: 'RUNNING',
    updatedContext,
  }
}

function updateContextFromResult(ctx: TaskContext, step: TaskPlanStep, result: ToolResult, stepIndex: number): TaskContext {
  if (!result.ok || !result.data) return ctx
  const data = result.data as Record<string, unknown>
  let next = ctx

  switch (step.toolName) {
    case 'get_student_profile_summary':
      next = rememberVaultFact(next, 'profileSummary', data, stepIndex)
      break
    case 'get_application_readiness':
      next = rememberVaultFact(next, 'readiness', data, stepIndex)
      break
    case 'get_active_tab_context':
    case 'scan_supported_application_page':
      next = rememberPageFact(next, 'lastPageScan', data, stepIndex)
      if (data.page && typeof data.page === 'object') {
        const page = data.page as Record<string, unknown>
        next.lastAdapterId = typeof page.adapter === 'string' ? page.adapter : next.lastAdapterId
        next.lastPageUrl = typeof page.url === 'string' ? page.url : next.lastPageUrl
        next.lastPageFingerprint = typeof page.fingerprint === 'string' ? page.fingerprint : next.lastPageFingerprint
        next.lastScanResult = page as Record<string, unknown>
      }
      break
    case 'map_application_fields':
      next = rememberPageFact(next, 'fieldMapping', data, stepIndex)
      break
    case 'request_student_approval':
      if (typeof data.approvalRef === 'string') {
        next.pendingApprovalRef = data.approvalRef
        next = rememberStudentDecision(next, 'approvalRef', data.approvalRef, stepIndex)
      }
      break
    case 'verify_filled_fields':
      next = rememberVerifiedResult(next, 'verification', data, stepIndex)
      break
    default:
      next = rememberVaultFact(next, `${step.toolName}_result`, data, stepIndex)
  }

  return next
}

async function finalizeTask(
  taskId: string,
  status: TaskStatus,
  message: string,
  errorCode?: string,
  ctx?: TaskContext
): Promise<void> {
  const update: Prisma.AgentTaskUpdateManyMutationInput = {
    status,
    errorCode: errorCode ?? null,
    errorMessage: message,
    updatedAt: new Date(),
  }
  if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') {
    update.completedAt = new Date()
  }
  if (ctx) {
    update.context = redactContext(ctx) as unknown as Prisma.InputJsonValue
  }
  await prisma.agentTask.updateMany({ where: { id: taskId }, data: update })
  await recordEvent(taskId, status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED' ? 'TASK_COMPLETED' : 'TASK_FAILED', undefined, {
    status,
    code: errorCode ?? null,
    message,
  })
}

export async function submitBrowserActionResult(
  taskId: string,
  actionId: string,
  result: { ok: boolean; error?: string; code?: string; data?: unknown },
  auth: TaskAuthorizationContext,
  request: Request
): Promise<TaskExecutionResult> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
  if (!task) {
    return { ok: false, taskRef: '', status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  if (task.workspaceId !== auth.workspaceId || task.userId !== auth.userId) {
    return { ok: false, taskRef: task.ref, status: 'FAILED', currentStepIndex: task.currentStepIndex, errorCode: 'UNAUTHORIZED' }
  }
  if (task.status !== 'WAITING_FOR_STUDENT' || task.pendingActionId !== actionId) {
    return {
      ok: false,
      taskRef: task.ref,
      status: task.status as TaskStatus,
      currentStepIndex: task.currentStepIndex,
      errorCode: 'STALE_ACTION',
      message: 'The action is no longer pending or the action id does not match.',
    }
  }

  const stepIndex = task.currentStepIndex
  await recordEvent(taskId, 'BROWSER_ACTION_RESULT_RECEIVED', stepIndex, {
    ok: result.ok,
    code: result.code ?? null,
  })

  if (!result.ok) {
    const code = result.code ?? 'BROWSER_ACTION_FAILED'
    const retryable = isRetryableError(code)
    const existing = await prisma.agentTaskStep.findUnique({ where: { taskId_stepIndex: { taskId, stepIndex } } })
    const retryCount = (existing?.retryCount ?? 0) + 1
    const taskStatus: TaskStatus = retryable && retryCount <= DEFAULT_TASK_LIMITS.maxRetriesPerStep ? 'RETRYING' : 'FAILED'

    await failStep(taskId, stepIndex, code, result.error ?? 'Browser action failed.', retryCount, taskStatus)

    if (taskStatus === 'FAILED') {
      await finalizeTask(taskId, 'FAILED', result.error ?? 'Browser action failed.', code)
    }

    return {
      ok: false,
      taskRef: task.ref,
      status: taskStatus,
      currentStepIndex: stepIndex,
      errorCode: code,
      message: result.error ?? 'Browser action failed.',
    }
  }

  // Mark step completed and continue execution.
  const ctx = parseContext(task.context)
  const updatedContext = updateContextFromBrowserResult(ctx, stepIndex, result.data)

  await completeStep(
    taskId,
    stepIndex,
    { ok: true, data: result.data ?? null } as unknown as Prisma.InputJsonValue,
    'RUNNING',
    {
      currentStepIndex: stepIndex + 1,
      pendingAction: undefined,
      pendingActionId: undefined,
      context: redactContext(updatedContext) as unknown as Prisma.InputJsonValue,
    }
  )

  // Resume the next step immediately.
  return continueExecution(taskId, auth, request, {}, task)
}

function updateContextFromBrowserResult(ctx: TaskContext, stepIndex: number, data: unknown): TaskContext {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  let next = ctx
  if (record.results) {
    next = rememberVerifiedResult(next, 'browserVerification', record.results, stepIndex)
  }
  if (record.page && typeof record.page === 'object') {
    const page = record.page as Record<string, unknown>
    next.lastAdapterId = typeof page.adapter === 'string' ? page.adapter : next.lastAdapterId
    next.lastPageUrl = typeof page.url === 'string' ? page.url : next.lastPageUrl
    next.lastPageFingerprint = typeof page.fingerprint === 'string' ? page.fingerprint : next.lastPageFingerprint
  }
  return next
}

export async function pauseTask(taskId: string): Promise<void> {
  await transitionTaskStatus(taskId, ['RUNNING', 'RETRYING', 'WAITING_FOR_STUDENT'], 'PAUSED', { pausedAt: new Date() })
  await recordEvent(taskId, 'TASK_PAUSED')
}

export async function resumeTask(
  taskId: string,
  auth: TaskAuthorizationContext,
  request: Request
): Promise<TaskExecutionResult> {
  // Revalidation: task must be PAUSED or RETRYING and not expired.
  const resumed = await transitionTaskStatus(taskId, ['PAUSED', 'RETRYING'], 'RUNNING', { pausedAt: undefined })
  if (!resumed) {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
    if (!task) return { ok: false, taskRef: '', status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
    return {
      ok: false,
      taskRef: task.ref,
      status: task.status as TaskStatus,
      currentStepIndex: task.currentStepIndex,
      errorCode: 'TASK_NOT_RESUMABLE',
      message: `Task is ${task.status} and cannot be resumed.`,
    }
  }
  await recordEvent(taskId, 'TASK_RESUMED')
  return runTask(taskId, auth, request)
}

export async function cancelTask(taskId: string, auth: TaskAuthorizationContext): Promise<void> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
  if (!task) return
  if (task.workspaceId !== auth.workspaceId || task.userId !== auth.userId) return

  await prisma.$transaction(async tx => {
    await tx.agentTask.updateMany({
      where: { id: taskId, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() },
    })
  })

  // Release any pending credit reservations tracked by this task.
  const ctx = parseContext(task.context)
  const reservations = ctx.pendingReservations ?? []
  for (const reservationId of reservations) {
    try {
      await releaseCredit({ reservationId, userId: auth.userId, workspaceId: auth.workspaceId, agentSessionId: auth.agentSessionId })
      await recordEvent(taskId, 'CREDIT_RESERVATION_RELEASED', undefined, { reservationId, reason: 'task_cancelled' })
    } catch {
      // Reservation may already be consumed/released; ignore.
    }
  }

  await recordEvent(taskId, 'TASK_CANCELLED')
}
