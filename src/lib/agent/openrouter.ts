export interface OpenRouterMessage {
  role: string
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

export interface OpenRouterTool {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface OpenRouterResult {
  ok: boolean
  text: string | null
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  error?: string
  usage?: { provider: 'openrouter'; model: string; inputTokens?: number; outputTokens?: number; requestId?: string }
}

const REQUEST_TIMEOUT_MS = 15000
const MAX_OUTPUT_TOKENS = 1024

function safeError(status: number): string {
  if (status === 401 || status === 403) return 'OpenRouter authentication failed; check the server configuration.'
  if (status === 402) return 'OpenRouter account cannot fulfill this request; check provider billing and limits.'
  if (status === 429) return 'OpenRouter is rate limiting requests. Try again shortly.'
  return 'OpenRouter is temporarily unavailable.'
}

function randomId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

export async function requestOpenRouter(options: {
  messages: OpenRouterMessage[]
  tools: OpenRouterTool[]
  model: string
  apiKey: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<OpenRouterResult> {
  try {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://formlee.app', 'X-Title': 'Formlee' },
      signal,
      body: JSON.stringify({ model: options.model, messages: options.messages, ...(options.tools.length ? { tools: options.tools } : {}), stream: false, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS }),
    })
    if (!response.ok) return { ok: false, text: null, toolCalls: [], error: safeError(response.status) }
    const body = await response.json().catch(() => null) as {
      id?: string; choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null
    const message = body?.choices?.[0]?.message
    if (!message || (message.content != null && typeof message.content !== 'string') || !Array.isArray(message.tool_calls ?? [])) {
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned a malformed response.' }
    }
    const toolCalls: OpenRouterResult['toolCalls'] = []
    for (const item of (message.tool_calls ?? []).slice(0, 8)) {
      const name = item.function?.name
      if (typeof name !== 'string') continue
      let args: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(item.function?.arguments ?? '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
      } catch { return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned malformed tool arguments.' } }
      toolCalls.push({ id: typeof item.id === 'string' ? item.id.slice(0, 128) : randomId(), name, arguments: args })
    }
    const requestId = typeof body?.id === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(body.id) ? body.id : undefined
    return {
      ok: true, text: typeof message.content === 'string' ? message.content.slice(0, 20000) : null, toolCalls,
      usage: { provider: 'openrouter', model: options.model, ...(Number.isFinite(body?.usage?.prompt_tokens) ? { inputTokens: body!.usage!.prompt_tokens } : {}), ...(Number.isFinite(body?.usage?.completion_tokens) ? { outputTokens: body!.usage!.completion_tokens } : {}), ...(requestId ? { requestId } : {}) },
    }
  } catch (error) {
    return { ok: false, text: null, toolCalls: [], error: error instanceof Error && error.name === 'TimeoutError' ? 'OpenRouter request timed out.' : 'OpenRouter request failed.' }
  }
}
