/**
 * Phase 6 — Agent Task persistence and concurrency control.
 *
 * Every state transition is a conditional database update so two workers or
 * repeated requests cannot execute the same task step simultaneously. Event
 * recording is append-only and capped to prevent unbounded growth.
 */

import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  TaskAuthorizationContext,
  TaskContext,
  TaskEventType,
  TaskPlan,
  TaskPlanStep,
  TaskStatus,
  StepStatus,
} from './types'
import { DEFAULT_TASK_LIMITS, clampExpiryMinutes } from './limits'

export type { TaskStatus, StepStatus }

export interface TaskRow {
  id: string
  ref: string
  userId: string
  workspaceId: string
  agentSessionId: string | null
  objective: string
  status: string
  plan: Prisma.JsonValue | null
  currentStepIndex: number
  context: Prisma.JsonValue | null
  pendingAction: Prisma.JsonValue | null
  pendingActionId: string | null
  retryCount: number
  errorCode: string | null
  errorMessage: string | null
  expiresAt: Date
  startedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  pausedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function taskRef(): string {
  return 'task_' + randomBytes(16).toString('hex')
}

function actionId(): string {
  return 'act_' + randomBytes(12).toString('hex')
}

function stepIdempotencyKey(taskId: string, stepIndex: number): string {
  return `${taskId}:step:${stepIndex}`
}

function serializeContext(ctx: TaskContext): Prisma.InputJsonValue {
  return ctx as unknown as Prisma.InputJsonValue
}

function parseContext(json: Prisma.JsonValue | null): TaskContext {
  return (json as TaskContext | null) ?? {}
}

export async function createTask(
  auth: TaskAuthorizationContext,
  objective: string,
  initialContext: TaskContext,
  expiresInMinutes?: number
): Promise<TaskRow> {
  const ref = taskRef()
  const expiresAt = new Date(Date.now() + clampExpiryMinutes(expiresInMinutes) * 60 * 1000)
  const row = await prisma.agentTask.create({
    data: {
      ref,
      userId: auth.userId,
      workspaceId: auth.workspaceId,
      agentSessionId: auth.agentSessionId,
      objective,
      status: 'CREATED',
      context: serializeContext(initialContext),
      expiresAt,
    },
  })
  await recordEvent(row.id, 'TASK_CREATED', undefined, { objective: truncate(objective, 200) })
  return row as unknown as TaskRow
}

export async function findTaskByRef(
  ref: string,
  auth: TaskAuthorizationContext
): Promise<TaskRow | null> {
  const row = await prisma.agentTask.findUnique({ where: { ref } })
  if (!row) return null
  if (row.workspaceId !== auth.workspaceId || row.userId !== auth.userId) return null
  return row as unknown as TaskRow
}

export async function listTasksForWorkspace(
  auth: TaskAuthorizationContext,
  options: { status?: string; limit?: number; offset?: number } = {}
): Promise<TaskRow[]> {
  const rows = await prisma.agentTask.findMany({
    where: {
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      status: options.status ?? undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
    skip: options.offset ?? 0,
  })
  return rows as unknown as TaskRow[]
}

export async function transitionTaskStatus(
  taskId: string,
  fromStatuses: TaskStatus[],
  toStatus: TaskStatus,
  extra: {
    currentStepIndex?: number
    pendingAction?: Prisma.InputJsonValue
    pendingActionId?: string | null
    context?: Prisma.InputJsonValue
    errorCode?: string | null
    errorMessage?: string | null
    startedAt?: Date
    completedAt?: Date
    cancelledAt?: Date
    pausedAt?: Date
  } = {}
): Promise<TaskRow | null> {
  const data: Prisma.AgentTaskUpdateInput = { status: toStatus, updatedAt: new Date() }
  if (typeof extra.currentStepIndex === 'number') data.currentStepIndex = extra.currentStepIndex
  if (extra.pendingAction !== undefined) data.pendingAction = extra.pendingAction ?? undefined
  if (extra.pendingActionId !== undefined) data.pendingActionId = extra.pendingActionId ?? undefined
  if (extra.context !== undefined) data.context = extra.context
  if (extra.errorCode !== undefined) data.errorCode = extra.errorCode ?? null
  if (extra.errorMessage !== undefined) data.errorMessage = extra.errorMessage ?? null
  if (extra.startedAt !== undefined) data.startedAt = extra.startedAt
  if (extra.completedAt !== undefined) data.completedAt = extra.completedAt
  if (extra.cancelledAt !== undefined) data.cancelledAt = extra.cancelledAt
  if (extra.pausedAt !== undefined) data.pausedAt = extra.pausedAt

  const result = await prisma.agentTask.updateMany({
    where: { id: taskId, status: { in: fromStatuses } },
    data,
  })
  if (result.count !== 1) return null
  return prisma.agentTask.findUnique({ where: { id: taskId } }) as unknown as Promise<TaskRow>
}

export async function claimStepForExecution(
  taskId: string,
  stepIndex: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await prisma.agentTaskStep.updateMany({
    where: { taskId, stepIndex, status: 'PENDING' },
    data: { status: 'RUNNING', executedAt: new Date() },
  })
  if (result.count === 1) return { ok: true }
  const existing = await prisma.agentTaskStep.findUnique({
    where: { taskId_stepIndex: { taskId, stepIndex } },
    select: { status: true },
  })
  if (!existing) return { ok: false, reason: 'STEP_NOT_FOUND' }
  if (existing.status === 'RUNNING') return { ok: false, reason: 'STEP_ALREADY_RUNNING' }
  if (existing.status === 'COMPLETED') return { ok: false, reason: 'STEP_ALREADY_COMPLETED' }
  return { ok: false, reason: 'STEP_NOT_PENDING' }
}

export async function completeStep(
  taskId: string,
  stepIndex: number,
  result: Prisma.InputJsonValue,
  nextStatus: TaskStatus,
  taskUpdate: {
    currentStepIndex?: number
    pendingAction?: Prisma.InputJsonValue
    pendingActionId?: string | null
    context?: Prisma.InputJsonValue
  } = {}
): Promise<void> {
  await prisma.$transaction([
    prisma.agentTaskStep.updateMany({
      where: { taskId, stepIndex, status: 'RUNNING' },
      data: { status: 'COMPLETED', result, completedAt: new Date() },
    }),
    prisma.agentTask.updateMany({
      where: { id: taskId },
      data: {
        status: nextStatus,
        currentStepIndex: taskUpdate.currentStepIndex ?? undefined,
        pendingAction: taskUpdate.pendingAction ?? undefined,
        pendingActionId: taskUpdate.pendingActionId ?? undefined,
        context: taskUpdate.context ?? undefined,
        updatedAt: new Date(),
      },
    }),
  ])
}

export async function failStep(
  taskId: string,
  stepIndex: number,
  errorCode: string,
  errorMessage: string,
  retryCount: number,
  taskStatus: TaskStatus,
  taskContext?: Prisma.InputJsonValue
): Promise<void> {
  await prisma.$transaction([
    prisma.agentTaskStep.updateMany({
      where: { taskId, stepIndex, status: 'RUNNING' },
      data: {
        status: taskStatus === 'RETRYING' ? 'PENDING' : 'FAILED',
        errorCode,
        errorMessage: truncate(errorMessage, 1000),
        retryCount,
      },
    }),
    prisma.agentTask.updateMany({
      where: { id: taskId },
      data: {
        status: taskStatus,
        errorCode,
        errorMessage: truncate(errorMessage, 1000),
        context: taskContext ?? undefined,
        retryCount: { increment: 1 },
        updatedAt: new Date(),
      },
    }),
  ])
}

export async function setWaitingForStudent(
  taskId: string,
  stepIndex: number,
  action: { type: string; payload?: Record<string, unknown> },
  taskContext?: Prisma.InputJsonValue
): Promise<string> {
  const id = actionId()
  await prisma.$transaction([
    prisma.agentTaskStep.updateMany({
      where: { taskId, stepIndex, status: 'RUNNING' },
      data: { status: 'WAITING_FOR_STUDENT' },
    }),
    prisma.agentTask.updateMany({
      where: { id: taskId },
      data: {
        status: 'WAITING_FOR_STUDENT',
        pendingAction: action as unknown as Prisma.InputJsonValue,
        pendingActionId: id,
        context: taskContext ?? undefined,
        updatedAt: new Date(),
      },
    }),
  ])
  return id
}

export async function persistPlan(
  taskId: string,
  plan: TaskPlan,
  context: TaskContext
): Promise<void> {
  const steps = plan.steps.map((step, idx) => ({
    taskId,
    stepIndex: idx,
    toolName: step.toolName,
    description: step.description,
    args: (step.args ?? {}) as unknown as Prisma.InputJsonValue,
    dependsOn: step.dependsOn ?? null,
    requiresStudentApproval: step.requiresStudentApproval ?? false,
    idempotencyKey: stepIdempotencyKey(taskId, idx),
  }))

  await prisma.$transaction([
    prisma.agentTask.updateMany({
      where: { id: taskId, status: 'PLANNING' },
      data: {
        status: 'READY',
        plan: plan as unknown as Prisma.InputJsonValue,
        context: serializeContext(context),
        updatedAt: new Date(),
      },
    }),
    prisma.agentTaskStep.createMany({
      data: steps,
      skipDuplicates: true,
    }),
  ])
}

export async function loadPlanSteps(taskId: string): Promise<TaskPlanStep[]> {
  const rows = await prisma.agentTaskStep.findMany({
    where: { taskId },
    orderBy: { stepIndex: 'asc' },
  })
  return rows.map(row => ({
    stepIndex: row.stepIndex,
    toolName: row.toolName,
    description: row.description,
    args: (row.args as Record<string, unknown> | null) ?? undefined,
    dependsOn: row.dependsOn ?? undefined,
    requiresStudentApproval: row.requiresStudentApproval,
  }))
}

export async function loadStep(taskId: string, stepIndex: number) {
  return prisma.agentTaskStep.findUnique({
    where: { taskId_stepIndex: { taskId, stepIndex } },
  })
}

export async function recordEvent(
  taskId: string,
  eventType: TaskEventType,
  stepIndex?: number,
  payload?: Record<string, unknown>
): Promise<void> {
  const safePayload = payload ? redactPayload(payload) : undefined
  await prisma.$transaction(async tx => {
    await tx.agentTaskEvent.create({
      data: {
        taskId,
        eventType,
        stepIndex,
        payload: safePayload as unknown as Prisma.InputJsonValue | undefined,
      },
    })
    const count = await tx.agentTaskEvent.count({ where: { taskId } })
    if (count > DEFAULT_TASK_LIMITS.maxStoredEventsPerTask) {
      const toDelete = await tx.agentTaskEvent.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        take: count - DEFAULT_TASK_LIMITS.maxStoredEventsPerTask,
        select: { id: true },
      })
      await tx.agentTaskEvent.deleteMany({
        where: { id: { in: toDelete.map(r => r.id) } },
      })
    }
  })
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set([
    'password',
    'otp',
    'token',
    'apiKey',
    'secret',
    'accessToken',
    'refreshToken',
    'idToken',
    'rawBody',
    'documentContent',
    'value',
    'values',
  ])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      out[key] = '[REDACTED]'
    } else if (Array.isArray(value)) {
      out[key] = value.map(v => (typeof v === 'object' && v !== null ? redactPayload(v as Record<string, unknown>) : v))
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactPayload(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export { taskRef, actionId, stepIdempotencyKey, serializeContext, parseContext }
