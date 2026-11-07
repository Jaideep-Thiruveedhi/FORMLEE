/**
 * Phase 8 — Unified Formlee Agent.
 *
 * The Agent is the single entry point for natural-language student requests.
 * It reuses the existing bounded runner (model → tool → executor loop) and the
 * durable Task Orchestrator. When a request requires a multi-step workflow, the
 * model calls the `create_agent_task` tool; the handler plans and starts the
 * task. Simple questions are answered directly or via one registered tool call.
 *
 * The Agent never invents student data, never approves fills itself, and never
 * touches the browser directly.
 */

import { runAgent, type RunAgentResult, type ToolCallRecord } from './runner'
import type { AgentMessage } from './model'
import { parseTaskAction } from './action-parser'

export { parseTaskAction } from './action-parser'

export interface AgentRequest {
  request: Request
  messages: AgentMessage[]
  signal?: AbortSignal
  maxIterations?: number
  sensitiveValues?: string[]
}

export interface AgentResponse extends RunAgentResult {
  taskRef?: string
  taskStatus?: string
}

function extractTaskMeta(toolCalls: ToolCallRecord[]): { taskRef?: string; taskStatus?: string } {
  for (const tc of toolCalls) {
    if (!tc.result?.ok) continue
    const raw = tc.result.result?.data
    if (!raw || typeof raw !== 'object') continue
    const data = raw as Record<string, unknown>
    if (tc.name === 'create_agent_task' || tc.name === 'resume_agent_task') {
      if (typeof data.taskRef === 'string') {
        return { taskRef: data.taskRef, taskStatus: typeof data.status === 'string' ? data.status : undefined }
      }
    }
  }
  return {}
}

/**
 * Handle one student turn. Runs the bounded model/tool loop, executes any
 * server-side tools, surfaces browser-action envelopes for the extension, and
 * extracts a task reference when the model created or resumed one.
 */
export async function handleAgentMessage(options: AgentRequest): Promise<AgentResponse> {
  const result = await runAgent({
    request: options.request,
    messages: options.messages,
    maxIterations: options.maxIterations,
    signal: options.signal,
    sensitiveValues: options.sensitiveValues,
  })

  const meta = extractTaskMeta(result.toolCalls)

  // Fallback: some models may emit a CREATE_TASK action as text rather than a
  // native tool call. This branch keeps the UI responsive without requiring a
  // second round-trip.
  if (!meta.taskRef && result.finalText) {
    const action = parseTaskAction(result.finalText)
    if (action?.objective) {
      const { createAgentTask, planTask, startTask } = await import('./tasks/orchestrator')
      const created = await createAgentTask({
        request: options.request,
        objective: action.objective,
        applicationId: action.applicationId,
      })
      if (created.ok && created.taskRef) {
        await planTask(created.taskRef, options.request)
        const started = await startTask(created.taskRef, options.request)
        return {
          ...result,
          finalText: `Started a task for: ${action.objective}`,
          taskRef: created.taskRef,
          taskStatus: started.status,
        }
      }
    }
  }

  return { ...result, ...meta }
}
