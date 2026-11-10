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
  errorCode?: string
  finishReason?: string
  usage?: { provider: 'openrouter'; model: string; inputTokens?: number; outputTokens?: number; requestId?: string }
}

interface OpenRouterDiagnostics {
  httpStatus: number | null
  model: string
  providerId?: string
  responseId?: string
  finishReason?: string
  contentExists: boolean
  contentType: string
  toolCallCount: number
  errorCode?: string
}

const REQUEST_TIMEOUT_MS = 15000
const MAX_OUTPUT_TOKENS = 1024

function safeError(status: number, code?: string): string {
  if (status === 401 || status === 403) return 'OpenRouter authentication failed; check the server configuration.'
  if (status === 402) return 'OpenRouter account cannot fulfill this request; check provider billing and limits.'
  if (status === 429) return 'OpenRouter is rate limiting requests. Try again shortly.'
  if (status === 400 || status === 404 || status === 422) {
    return `OpenRouter rejected the model request${code ? ` (${code})` : ''}. Check the model and supported request options.`
  }
  return 'OpenRouter is temporarily unavailable.'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)
    ? value
    : undefined
}

function contentType(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function logDiagnostics(diagnostics: OpenRouterDiagnostics, failed: boolean): void {
  const safe = {
    httpStatus: diagnostics.httpStatus,
    model: diagnostics.model,
    ...(diagnostics.providerId ? { providerId: diagnostics.providerId } : {}),
    ...(diagnostics.responseId ? { responseId: diagnostics.responseId } : {}),
    ...(diagnostics.finishReason ? { finishReason: diagnostics.finishReason } : {}),
    contentExists: diagnostics.contentExists,
    contentType: diagnostics.contentType,
    toolCallCount: diagnostics.toolCallCount,
    ...(diagnostics.errorCode ? { errorCode: diagnostics.errorCode } : {}),
  }
  if (failed) console.warn('[Formlee OpenRouter] completion diagnostic', safe)
  else console.info('[Formlee OpenRouter] completion diagnostic', safe)
}

function randomId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

export async function requestOpenRouter(options: {
  messages: OpenRouterMessage[]
  tools: OpenRouterTool[]
  responseFormat?: { type: 'json_object' }
  model: string
  apiKey: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<OpenRouterResult> {
  let diagnostic: OpenRouterDiagnostics = {
    httpStatus: null,
    model: options.model,
    contentExists: false,
    contentType: 'missing',
    toolCallCount: 0,
  }
  try {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://formlee.app', 'X-Title': 'Formlee' },
      signal,
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        ...(options.tools.length ? { tools: options.tools } : {}),
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        stream: false,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    })
    diagnostic.httpStatus = response.status
    const body = asRecord(await response.json().catch(() => null))
    const providerError = asRecord(body?.error)
    const responseId = safeIdentifier(body?.id) ?? safeIdentifier(response.headers.get('x-request-id'))
    const providerId = safeIdentifier(body?.provider) ?? safeIdentifier(response.headers.get('x-openrouter-provider'))

    if (!response.ok) {
      const errorCode = safeIdentifier(providerError?.code) ?? safeIdentifier(body?.error_code)
      diagnostic = { ...diagnostic, providerId, responseId, errorCode }
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: safeError(response.status, errorCode), errorCode: errorCode ?? `HTTP_${response.status}` }
    }

    if (!body) {
      diagnostic = { ...diagnostic, providerId, responseId, errorCode: 'INVALID_JSON' }
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned a response that was not valid JSON.', errorCode: 'INVALID_JSON' }
    }

    if (providerError) {
      const errorCode = safeIdentifier(providerError.code) ?? safeIdentifier(body.error_code) ?? 'PROVIDER_ERROR'
      diagnostic = { ...diagnostic, providerId, responseId, errorCode }
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: `OpenRouter could not complete the request (${errorCode}).`, errorCode }
    }

    const choices = Array.isArray(body.choices) ? body.choices : []
    const choice = asRecord(choices[0])
    const message = asRecord(choice?.message)
    const finishReason = safeIdentifier(choice?.finish_reason)
    const content = message?.content
    const rawToolCalls = message?.tool_calls
    const toolCallsPresent = rawToolCalls === undefined || rawToolCalls === null || Array.isArray(rawToolCalls)
    const rawToolCallCount = Array.isArray(rawToolCalls) ? rawToolCalls.length : 0
    diagnostic = {
      ...diagnostic,
      providerId,
      responseId,
      finishReason,
      contentExists: typeof content === 'string' && content.trim().length > 0,
      contentType: contentType(content),
      toolCallCount: rawToolCallCount,
    }

    if (!choice || !message) {
      diagnostic.errorCode = choices.length === 0 ? 'NO_CHOICES' : 'MISSING_MESSAGE'
      logDiagnostics(diagnostic, true)
      return {
        ok: false,
        text: null,
        toolCalls: [],
        error: choices.length === 0
          ? 'OpenRouter returned no completion choices. Check model availability and retry.'
          : 'OpenRouter returned a choice without an assistant message.',
        errorCode: diagnostic.errorCode,
      }
    }

    if (finishReason === 'length') {
      diagnostic.errorCode = 'OUTPUT_TRUNCATED'
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter truncated the response. Shorten the task description and retry.', errorCode: 'OUTPUT_TRUNCATED', finishReason }
    }

    if (finishReason === 'content_filter' || typeof message.refusal === 'string') {
      diagnostic.errorCode = 'MODEL_REFUSAL'
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter refused this task-planning request. Rephrase the task and try again.', errorCode: 'MODEL_REFUSAL', finishReason }
    }

    if ((content !== null && content !== undefined && typeof content !== 'string') || !toolCallsPresent) {
      diagnostic.errorCode = content !== null && content !== undefined && typeof content !== 'string'
        ? 'UNSUPPORTED_CONTENT_TYPE'
        : 'MALFORMED_TOOL_CALLS'
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: `OpenRouter returned an unexpected response format (${diagnostic.errorCode}).`, errorCode: diagnostic.errorCode, finishReason }
    }

    if (rawToolCallCount > 8) {
      diagnostic.errorCode = 'TOO_MANY_TOOL_CALLS'
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned too many tool calls in one response.', errorCode: 'TOO_MANY_TOOL_CALLS', finishReason }
    }

    const toolCalls: OpenRouterResult['toolCalls'] = []
    for (const rawItem of (Array.isArray(rawToolCalls) ? rawToolCalls : [])) {
      const item = asRecord(rawItem)
      const fn = asRecord(item?.function)
      const name = fn?.name
      if (typeof name !== 'string' || !name || typeof fn?.arguments !== 'string') {
        diagnostic.errorCode = 'MALFORMED_TOOL_CALL'
        logDiagnostics(diagnostic, true)
        return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned a malformed tool call.', errorCode: 'MALFORMED_TOOL_CALL', finishReason }
      }
      let args: unknown
      try {
        args = JSON.parse(fn.arguments)
      } catch {
        diagnostic.errorCode = 'MALFORMED_TOOL_ARGUMENTS'
        logDiagnostics(diagnostic, true)
        return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned malformed tool arguments.', errorCode: 'MALFORMED_TOOL_ARGUMENTS', finishReason }
      }
      const parsedArgs = asRecord(args)
      if (!parsedArgs) {
        diagnostic.errorCode = 'MALFORMED_TOOL_ARGUMENTS'
        logDiagnostics(diagnostic, true)
        return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned malformed tool arguments.', errorCode: 'MALFORMED_TOOL_ARGUMENTS', finishReason }
      }
      toolCalls.push({ id: safeIdentifier(item?.id) ?? randomId(), name, arguments: parsedArgs })
    }

    const text = typeof content === 'string' ? content.slice(0, 20000) : null
    if (!text?.trim() && toolCalls.length === 0) {
      diagnostic.errorCode = 'EMPTY_RESPONSE'
      logDiagnostics(diagnostic, true)
      return { ok: false, text: null, toolCalls: [], error: 'OpenRouter returned an empty completion. Retry the task once.', errorCode: 'EMPTY_RESPONSE', finishReason }
    }

    logDiagnostics(diagnostic, false)
    return {
      ok: true,
      text,
      toolCalls,
      finishReason,
      usage: {
        provider: 'openrouter',
        model: options.model,
        ...(Number.isFinite(asRecord(body.usage)?.prompt_tokens) ? { inputTokens: asRecord(body.usage)!.prompt_tokens as number } : {}),
        ...(Number.isFinite(asRecord(body.usage)?.completion_tokens) ? { outputTokens: asRecord(body.usage)!.completion_tokens as number } : {}),
        ...(responseId ? { requestId: responseId } : {}),
      },
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    diagnostic.errorCode = timedOut ? 'TIMEOUT' : 'NETWORK_ERROR'
    logDiagnostics(diagnostic, true)
    return { ok: false, text: null, toolCalls: [], error: timedOut ? 'OpenRouter request timed out.' : 'OpenRouter request failed.', errorCode: diagnostic.errorCode }
  }
}
