/**
 * Core types for the Formlee Agent Tool Registry (Phase 5).
 *
 * The registry is intentionally provider-agnostic: it describes WHAT a tool
 * needs, WHAT it returns, and WHICH permissions it requires. The executor
 * enforces validation, authz and audit; handlers implement the actual work
 * by reusing existing services.
 */

import type { z } from 'zod'
import type { AgentPermission } from './permissions'

export type { AgentPermission }

export type ToolEnvironment = 'server' | 'browser'

/** Authenticated runtime context passed to every handler. */
export interface ToolContext {
  userId: string
  workspaceId: string
  agentSessionId?: string
  permissions: AgentPermission[]
}

/** Browser actions the extension must perform for tools that touch the page. */
export interface BrowserAction {
  type: 'SCAN_PAGE' | 'GET_TAB_CONTEXT' | 'FILL' | 'VERIFY' | 'SHOW_RESULTS'
  payload?: Record<string, unknown>
}

/** Structured result every handler returns; the executor validates it. */
export interface ToolResult {
  ok: boolean
  data?: unknown
  browserAction?: BrowserAction
  error?: string
  code?: string
}

export interface ToolExecutionMetadata {
  toolName: string
  startedAt: Date
  finishedAt?: Date
  durationMs?: number
  status: 'success' | 'validation_error' | 'permission_denied' | 'execution_error'
  permissionDecision: {
    granted: boolean
    required: AgentPermission[]
    held: AgentPermission[]
  }
  errorCategory?: string
  resourceRefs?: Record<string, unknown>
}

export interface ToolDefinition<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string
  description: string
  environment: ToolEnvironment
  permissions: AgentPermission[]
  inputSchema: TInput
  outputSchema: TOutput
  timeoutMs: number
  handler: (context: ToolContext, args: z.infer<TInput>) => Promise<ToolResult> | ToolResult
}

/** Shape of the central execute API request body. */
export interface ExecuteToolRequest {
  tool: string
  args?: unknown
}
