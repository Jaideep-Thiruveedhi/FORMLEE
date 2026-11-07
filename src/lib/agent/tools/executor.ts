/**
 * Central Tool Executor.
 *
 * One gateway for every agent tool call:
 *   1. resolve registry definition
 *   2. validate arguments with Zod
 *   3. resolve authenticated context
 *   4. check workspace ownership
 *   5. check required permissions
 *   6. execute handler with timeout
 *   7. validate result
 *   8. record audit
 *   9. return structured response
 *
 * The model never supplies workspace/user/permission claims; they come from
 * the trusted agent session and workspace ownership resolution.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveAgentSessionFromHeaders } from '@/lib/agent/session'
import { AGENT_SESSION_HEADER } from '@/lib/agent/session'
import { recordToolAudit } from '@/lib/agent/audit'
import { agentSessionPermissions, hasPermissions, isStudentActionTool } from './permissions'
import { getToolDefinition, listToolDefinitions } from './registry'
import type {
  AgentPermission,
  ExecuteToolRequest,
  ToolContext,
  ToolDefinition,
  ToolExecutionMetadata,
  ToolResult,
} from './types'

export { listToolDefinitions }

export interface ExecuteOptions {
  request: Request
  toolName: string
  args?: unknown
  /** Set only by an explicit student-controlled Side Panel action. */
  studentAction?: boolean
}

export interface ExecuteResult {
  ok: boolean
  result?: ToolResult
  error?: string
  code?: string
  metadata?: ToolExecutionMetadata
}

async function resolveToolContext(request: Request): Promise<
  | { ok: true; context: ToolContext }
  | { ok: false; error: string; code: string }
> {
  const agentSession = await resolveAgentSessionFromHeaders(request.headers)
  if (!agentSession) {
    return { ok: false, error: 'Agent session missing or expired.', code: 'AGENT_SESSION_INVALID' }
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: agentSession.workspaceId },
    select: { userId: true },
  })
  if (!workspace?.userId) {
    return { ok: false, error: 'Workspace has no owning user.', code: 'WORKSPACE_UNOWNED' }
  }
  return {
    ok: true,
    context: {
      userId: workspace.userId,
      workspaceId: agentSession.workspaceId,
      agentSessionId: agentSession.token,
      permissions: agentSessionPermissions(false),
    },
  }
}

function validateArgs(definition: ToolDefinition, args: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const parsed = definition.inputSchema.safeParse(args)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { ok: false, error: `Invalid arguments for ${definition.name}: ${issues}` }
  }
  return { ok: true, data: parsed.data }
}

function validateResult(definition: ToolDefinition, result: unknown): ToolResult {
  const parsed = definition.outputSchema.safeParse(result)
  if (!parsed.success) {
    return {
      ok: false,
      error: `Tool ${definition.name} returned an invalid result shape.`,
      code: 'INVALID_RESULT',
    }
  }
  return result as ToolResult
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms`)), ms)
    }),
  ])
}

export async function executeTool(options: ExecuteOptions): Promise<ExecuteResult> {
  const startedAt = new Date()
  const definition = getToolDefinition(options.toolName)
  if (!definition) {
    const metadata: ToolExecutionMetadata = {
      toolName: options.toolName,
      startedAt,
      status: 'validation_error',
      permissionDecision: { granted: false, required: [], held: [] },
    }
    await recordToolAudit({
      toolName: options.toolName,
      workspaceId: 'unknown',
      userId: 'unknown',
      status: 'validation_error',
      permissionDecision: metadata.permissionDecision,
      errorCategory: 'UNKNOWN_TOOL',
    })
    return { ok: false, error: 'Unknown tool.', code: 'UNKNOWN_TOOL', metadata }
  }

  const argValidation = validateArgs(definition, options.args ?? {})
  if (!argValidation.ok) {
    const metadata: ToolExecutionMetadata = {
      toolName: definition.name,
      startedAt,
      status: 'validation_error',
      permissionDecision: { granted: false, required: definition.permissions, held: [] },
    }
    await recordToolAudit({
      toolName: definition.name,
      workspaceId: 'unknown',
      userId: 'unknown',
      status: 'validation_error',
      permissionDecision: metadata.permissionDecision,
      errorCategory: 'VALIDATION',
    })
    return { ok: false, error: argValidation.error, code: 'VALIDATION_ERROR', metadata }
  }

  const contextResult = await resolveToolContext(options.request)
  if (!contextResult.ok) {
    const metadata: ToolExecutionMetadata = {
      toolName: definition.name,
      startedAt,
      status: 'execution_error',
      permissionDecision: { granted: false, required: definition.permissions, held: [] },
    }
    await recordToolAudit({
      toolName: definition.name,
      workspaceId: 'unknown',
      userId: 'unknown',
      status: 'execution_error',
      permissionDecision: metadata.permissionDecision,
      errorCategory: contextResult.code,
    })
    return { ok: false, error: contextResult.error, code: contextResult.code, metadata }
  }

  const ctx = contextResult.context
  if (options.studentAction && isStudentActionTool(options.toolName)) {
    ctx.permissions = agentSessionPermissions(true)
  }
  const permissionCheck = hasPermissions(ctx.permissions, definition.permissions)
  const permissionDecision = {
    granted: permissionCheck.ok,
    required: definition.permissions,
    held: ctx.permissions,
  }

  if (!permissionCheck.ok) {
    const metadata: ToolExecutionMetadata = {
      toolName: definition.name,
      startedAt,
      status: 'permission_denied',
      permissionDecision,
    }
    await recordToolAudit({
      toolName: definition.name,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      agentSessionId: ctx.agentSessionId,
      status: 'permission_denied',
      durationMs: Date.now() - startedAt.getTime(),
      permissionDecision,
      errorCategory: 'PERMISSION_DENIED',
    })
    return {
      ok: false,
      error: `Missing permissions: ${permissionCheck.missing.join(', ')}`,
      code: 'PERMISSION_DENIED',
      metadata,
    }
  }

  try {
    const rawResult = await runWithTimeout(
      Promise.resolve(definition.handler(ctx, argValidation.data as unknown as Parameters<typeof definition.handler>[1])),
      definition.timeoutMs
    )
    const validated = validateResult(definition, rawResult)
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const metadata: ToolExecutionMetadata = {
      toolName: definition.name,
      startedAt,
      finishedAt,
      durationMs,
      status: validated.ok ? 'success' : 'execution_error',
      permissionDecision,
      errorCategory: validated.ok ? undefined : (validated.code ?? 'EXECUTION_ERROR'),
      resourceRefs: { agentSessionId: ctx.agentSessionId },
    }
    await recordToolAudit({
      toolName: definition.name,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      agentSessionId: ctx.agentSessionId,
      status: validated.ok ? 'success' : 'execution_error',
      durationMs,
      permissionDecision,
      errorCategory: metadata.errorCategory,
      resourceRefs: { agentSessionId: ctx.agentSessionId },
    })
    return { ok: validated.ok, result: validated, metadata }
  } catch (error) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const message = error instanceof Error ? error.message : String(error)
    const metadata: ToolExecutionMetadata = {
      toolName: definition.name,
      startedAt,
      finishedAt,
      durationMs,
      status: 'execution_error',
      permissionDecision,
      errorCategory: 'EXECUTION_ERROR',
    }
    await recordToolAudit({
      toolName: definition.name,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      agentSessionId: ctx.agentSessionId,
      status: 'execution_error',
      durationMs,
      permissionDecision,
      errorCategory: 'EXECUTION_ERROR',
    })
    return { ok: false, error: message, code: 'EXECUTION_ERROR', metadata }
  }
}

export { AGENT_SESSION_HEADER }
