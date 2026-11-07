/**
 * Phase 6 — Agent Task Orchestrator.
 *
 * High-level API for creating, planning, running, pausing, resuming and
 * cancelling tasks. Resolves authenticated context from the existing agent
 * session, validates workspace ownership, and delegates execution to the
 * controlled engine and planner.
 */

import { resolveAgentSession } from '@/lib/agent/session'
import { prisma } from '@/lib/prisma'
import type {
  CreateTaskInput,
  TaskAuthorizationContext,
  TaskExecutionResult,
  TaskPlan,
} from './types'
import { createTask, findTaskByRef, listTasksForWorkspace, recordEvent, parseContext } from './store'
import { planTask as planTaskWithModel } from './planner'
import { collectWorkspaceSensitiveValues } from '@/lib/agent/privacy'
import { runTask, submitBrowserActionResult, pauseTask, resumeTask, cancelTask } from './engine'

export type { TaskExecutionResult }

async function resolveAuth(request: Request): Promise<TaskAuthorizationContext | null> {
  const session = await resolveAgentSession(request)
  if (!session) return null
  const workspace = await prisma.workspace.findUnique({
    where: { id: session.workspaceId },
    select: { userId: true },
  })
  if (!workspace?.userId) return null
  return {
    userId: workspace.userId,
    workspaceId: session.workspaceId,
    agentSessionId: session.token,
  }
}

export async function createAgentTask(input: CreateTaskInput): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(input.request)
  if (!auth) {
    return { ok: false, taskRef: '', status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }

  const initialContext: import('./types').TaskContext = {
    applicationId: input.applicationId,
    totalToolCalls: 0,
  }

  const task = await createTask(auth, input.objective, initialContext, input.expiresInMinutes)
  return {
    ok: true,
    taskRef: task.ref,
    status: task.status as import('./types').TaskStatus,
    currentStepIndex: task.currentStepIndex,
    message: 'Task created. Run planning to turn the objective into a step-by-step plan.',
  }
}

export async function planTask(taskRef: string, request: Request): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }

  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }

  // Only plan from CREATED status.
  const updated = await prisma.agentTask.updateMany({
    where: { id: task.id, status: 'CREATED' },
    data: { status: 'PLANNING', updatedAt: new Date() },
  })
  if (updated.count !== 1) {
    return {
      ok: false,
      taskRef,
      status: task.status as import('./types').TaskStatus,
      currentStepIndex: task.currentStepIndex,
      errorCode: 'TASK_NOT_PLANNABLE',
      message: `Task is ${task.status} and cannot be planned right now.`,
    }
  }

  await recordEvent(task.id, 'PLANNING_STARTED')

  const planResult = await planTaskWithModel(
    task.objective,
    undefined,
    await collectWorkspaceSensitiveValues(auth.workspaceId)
  )
  if (!planResult.ok) {
    await prisma.agentTask.updateMany({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        errorCode: planResult.code,
        errorMessage: planResult.error,
        updatedAt: new Date(),
      },
    })
    await recordEvent(task.id, 'PLAN_FAILED', undefined, { code: planResult.code, message: planResult.error })
    return {
      ok: false,
      taskRef,
      status: 'FAILED',
      currentStepIndex: task.currentStepIndex,
      errorCode: planResult.code,
      message: planResult.error,
    }
  }

  const ctx = parseContext(task.context)
  const { persistPlan } = await import('./store')
  await persistPlan(task.id, planResult.plan, ctx)
  await recordEvent(task.id, 'PLAN_COMPLETED', undefined, {
    explanation: planResult.plan.explanation,
    stepCount: planResult.plan.steps.length,
  })

  return {
    ok: true,
    taskRef,
    status: 'READY',
    currentStepIndex: 0,
    message: planResult.plan.explanation,
  }
}

export async function startTask(taskRef: string, request: Request): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }
  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  return runTask(task.id, auth, request)
}

export async function pauseAgentTask(taskRef: string, request: Request): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }
  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  await pauseTask(task.id)
  return {
    ok: true,
    taskRef,
    status: 'PAUSED',
    currentStepIndex: task.currentStepIndex,
    message: 'Task paused. Resume it when you are ready to continue.',
  }
}

export async function resumeAgentTask(taskRef: string, request: Request): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }
  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  return resumeTask(task.id, auth, request)
}

export async function cancelAgentTask(taskRef: string, request: Request): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }
  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  await cancelTask(task.id, auth)
  return {
    ok: true,
    taskRef,
    status: 'CANCELLED',
    currentStepIndex: task.currentStepIndex,
    message: 'Task cancelled. Completed steps are preserved.',
  }
}

export async function submitTaskBrowserResult(
  taskRef: string,
  actionId: string,
  result: { ok: boolean; error?: string; code?: string; data?: unknown },
  request: Request
): Promise<TaskExecutionResult> {
  const auth = await resolveAuth(request)
  if (!auth) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'AGENT_SESSION_INVALID' }
  }
  const task = await findTaskByRef(taskRef, auth)
  if (!task) {
    return { ok: false, taskRef, status: 'FAILED', currentStepIndex: -1, errorCode: 'TASK_NOT_FOUND' }
  }
  return submitBrowserActionResult(task.id, actionId, result, auth, request)
}

export async function getTask(taskRef: string, request: Request) {
  const auth = await resolveAuth(request)
  if (!auth) return null
  return findTaskByRef(taskRef, auth)
}

export async function listAgentTasks(request: Request, options: { status?: string; limit?: number; offset?: number } = {}) {
  const auth = await resolveAuth(request)
  if (!auth) return []
  return listTasksForWorkspace(auth, options)
}

export async function getTaskSteps(taskRef: string, request: Request) {
  const auth = await resolveAuth(request)
  if (!auth) return []
  const task = await findTaskByRef(taskRef, auth)
  if (!task) return []
  const { loadPlanSteps } = await import('./store')
  return loadPlanSteps(task.id)
}

export async function getTaskEvents(taskRef: string, request: Request) {
  const auth = await resolveAuth(request)
  if (!auth) return []
  const task = await findTaskByRef(taskRef, auth)
  if (!task) return []
  return prisma.agentTaskEvent.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
}
