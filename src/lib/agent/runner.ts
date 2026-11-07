/**
 * Bounded agent execution loop.
 *
 * Orchestrates model inference and tool execution:
 *   1. Ask the configured model for the next action.
 *   2. Validate every requested tool name against the registry.
 *   3. Execute each valid tool through the central executor (server-side tools
 *      run immediately; browser tools return an envelope that the extension
 *      must execute).
 *   4. Feed tool results back to the model.
 *   5. Stop on a text-only response, a browser action, an error, or when the
 *      iteration limit is reached.
 *
 * Approval, fill and verification tools stay registered for explicit Side
 * Panel actions but are never exposed to or executed by the model.
 */

import { callAgentModel, type AgentMessage, type AgentToolCall } from './model'
import { executeTool, type ExecuteResult } from './tools/executor'
import { getToolDefinition, listModelToolDefinitions } from './tools/registry'
import { isStudentActionTool } from './tools/permissions'
import type { BrowserAction } from './tools/types'

export interface ToolCallRecord {
  id: string
  name: string
  args: unknown
  result: ExecuteResult
}

export interface RunAgentOptions {
  request: Request
  messages: AgentMessage[]
  maxIterations?: number
  signal?: AbortSignal
  sensitiveValues?: string[]
}

export interface RunAgentResult {
  ok: boolean
  finalText: string | null
  iterations: number
  toolCalls: ToolCallRecord[]
  pendingBrowserAction?: BrowserAction
  error?: string
  code?: string
}

const MAX_ITERATIONS = 6

function toolResultContent(record: ToolCallRecord): string {
  if (!record.result.ok) {
    return JSON.stringify({ ok: false, error: record.result.error, code: record.result.code })
  }
  const result = record.result.result
  if (!result) return JSON.stringify({ ok: false, error: 'Empty tool result' })
  if (result.browserAction) {
    return JSON.stringify({
      ok: true,
      browserAction: { type: result.browserAction.type, payload: result.browserAction.payload },
    })
  }
  if (record.name === 'generate_field_preview' && result.data && typeof result.data === 'object') {
    const preview = result.data as { values?: Record<string, unknown>; missing?: unknown[] }
    return JSON.stringify({
      ok: true,
      data: {
        valueCount: Object.keys(preview.values ?? {}).length,
        missing: Array.isArray(preview.missing) ? preview.missing : [],
      },
    })
  }
  return JSON.stringify({ ok: true, data: result.data ?? null })
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const maxIterations = Math.min(
    typeof options.maxIterations === 'number' && options.maxIterations > 0 ? options.maxIterations : MAX_ITERATIONS,
    MAX_ITERATIONS
  )
  const messages: AgentMessage[] = options.messages.slice()
  const toolCalls: ToolCallRecord[] = []

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const modelResponse = await callAgentModel({
      messages,
      signal: options.signal,
      tools: listModelToolDefinitions(),
      sensitiveValues: options.sensitiveValues,
    })
    if (!modelResponse.ok) {
      return {
        ok: false,
        finalText: null,
        iterations: iteration,
        toolCalls,
        error: modelResponse.error ?? 'Model call failed.',
        code: 'MODEL_ERROR',
      }
    }

    if (modelResponse.toolCalls.length === 0) {
      return {
        ok: true,
        finalText: modelResponse.text,
        iterations: iteration,
        toolCalls,
      }
    }

    // Record the assistant message with tool_calls so the next model turn has
    // full context. For prompt-based mode the model returned tool_calls only;
    // we reconstruct a minimal assistant content.
    messages.push({
      role: 'assistant',
      content: modelResponse.text ?? '',
      tool_calls: modelResponse.toolCalls,
    })

    for (const tc of modelResponse.toolCalls) {
      const definition = getToolDefinition(tc.name)
      if (!definition) {
        const record: ToolCallRecord = {
          id: tc.id,
          name: tc.name,
          args: tc.arguments,
          result: { ok: false, error: 'Unknown tool.', code: 'UNKNOWN_TOOL' },
        }
        toolCalls.push(record)
        messages.push({ role: 'tool', content: toolResultContent(record), tool_call_id: tc.id })
        continue
      }

      if (isStudentActionTool(tc.name)) {
        const record: ToolCallRecord = {
          id: tc.id,
          name: tc.name,
          args: tc.arguments,
          result: { ok: false, error: 'This action requires the student to review and approve it in the Side Panel.', code: 'STUDENT_ACTION_REQUIRED' },
        }
        toolCalls.push(record)
        messages.push({ role: 'tool', content: toolResultContent(record), tool_call_id: tc.id })
        continue
      }

      const execResult = await executeTool({
        request: options.request,
        toolName: tc.name,
        args: tc.arguments,
      })

      const record: ToolCallRecord = { id: tc.id, name: tc.name, args: tc.arguments, result: execResult }
      toolCalls.push(record)

      // Browser tools return an envelope that the extension must execute. We
      // stop the server-side loop here and let the client dispatch the action.
      if (execResult.ok && execResult.result?.browserAction) {
        return {
          ok: true,
          finalText: modelResponse.text,
          iterations: iteration,
          toolCalls,
          pendingBrowserAction: execResult.result.browserAction,
        }
      }

      messages.push({ role: 'tool', content: toolResultContent(record), tool_call_id: tc.id })
    }
  }

  return {
    ok: false,
    finalText: null,
    iterations: maxIterations,
    toolCalls,
    error: 'The agent reached its step limit without producing a final answer. Try a more specific question.',
    code: 'ITERATION_LIMIT',
  }
}
