import { NextRequest, NextResponse } from 'next/server'
import { resolveAgentSession } from '@/lib/agent/session'
import { handleAgentMessage } from '@/lib/agent/agent'
import type { AgentMessage } from '@/lib/agent/model'
import { z } from 'zod'
import { collectWorkspaceSensitiveValues } from '@/lib/agent/privacy'

/**
 * Model-driven agent chat endpoint.
 *
 * The extension/Side Panel posts the conversation history. The server runs the
 * bounded model → tool → executor loop. Browser tools stop the loop and return
 * a browser-action envelope; the extension executes the action and posts the
 * result back as a tool message.
 */

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(0).max(8000),
})

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).max(40),
  maxIterations: z.number().int().min(1).max(6).optional(),
})

export async function POST(request: NextRequest) {
  const session = await resolveAgentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Agent session missing or expired.', code: 'AGENT_SESSION_INVALID' },
      { status: 401 }
    )
  }

  const body = (await request.json().catch(() => null)) as unknown
  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const messages = parsed.data.messages as AgentMessage[]
  if (messages.length === 0) {
    return NextResponse.json(
      { error: 'No messages provided.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const result = await handleAgentMessage({
    request,
    messages,
    maxIterations: parsed.data.maxIterations,
    sensitiveValues: await collectWorkspaceSensitiveValues(session.workspaceId),
  })

  const status = result.ok ? 200 : mapErrorCodeToStatus(result.code)
  return NextResponse.json(redactPreviewValues(result), { status })
}

/** Concrete values are delivered only to the extension's explicit field
 * review surface. They are not needed in chat responses or model transcripts. */
function redactPreviewValues<T extends { toolCalls?: { name: string; result: { result?: { data?: unknown } } }[] }>(result: T): T {
  if (!Array.isArray(result.toolCalls)) return result
  for (const call of result.toolCalls) {
    if (call.name !== 'generate_field_preview') continue
    const toolResult = call.result.result
    if (!toolResult?.data || typeof toolResult.data !== 'object') continue
    const data = toolResult.data as { values?: Record<string, unknown>; missing?: unknown[] }
    toolResult.data = {
      valueCount: Object.keys(data.values ?? {}).length,
      missing: Array.isArray(data.missing) ? data.missing : [],
    }
  }
  return result
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'PERMISSION_DENIED':
      return 403
    case 'MODEL_ERROR':
    case 'ITERATION_LIMIT':
      return 502
    default:
      return 500
  }
}
