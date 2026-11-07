import type { AgentMessage } from './model'

const MAX_INPUT_CHARS = 24000
const SENSITIVE_JSON_KEY = /(?:name|email|phone|mobile|address|birth|roll|certificate|password|passwd|otp|captcha|token|secret|snapshot|originalname|storedname|displaylabel|credential|payment|answer|value|note|session|content)/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sanitizeModelText(value: string, sensitiveValues: string[] = []): string {
  let safe = value
  for (const secret of [...new Set(sensitiveValues)].filter(item => item.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    safe = safe.replace(new RegExp(escapeRegExp(secret.trim()), 'gi'), '[REDACTED]')
  }
  safe = safe
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, '[REDACTED_NUMBER]')
    .replace(/\b\d{8,16}\b/g, '[REDACTED_NUMBER]')
    .replace(/\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[REDACTED_DATE]')
    .replace(/\b(?:password|passwd|otp|one[- ]time code|token|secret|api key|authorization)\s*(?::|=|\bis\b)\s*[^\s,;]+/gi, '[REDACTED_SECRET]')
    .replace(/\bmy name is\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2}/giu, '[REDACTED_PERSON]')
    .replace(/\baddress(?: is|:|=)\s*[^,;\n]+/gi, 'address: [REDACTED]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_TOKEN]')

  // Tool outputs and model transcripts are JSON strings. Strip values by
  // sensitive key as a second boundary, including stale application snapshots
  // whose profile values may no longer match the current vault.
  const trimmed = safe.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactSensitiveJson(JSON.parse(trimmed)))
    } catch {
      // Keep the bounded text path for JSON fragments and ordinary prose.
    }
  }
  return safe
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJson)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_JSON_KEY.test(key)) {
      output[key] = '[REDACTED]'
    } else {
      output[key] = redactSensitiveJson(item)
    }
  }
  return output
}

export function sanitizeModelMessages(messages: AgentMessage[], sensitiveValues: string[] = []): AgentMessage[] {
  const result = messages.map(message => ({
    ...message,
    content: sanitizeModelText(message.content, sensitiveValues),
    tool_calls: message.tool_calls?.map(call => ({
      ...call,
      arguments: JSON.parse(sanitizeModelText(JSON.stringify(call.arguments), sensitiveValues)) as Record<string, unknown>,
    })),
  }))
  const size = result.reduce((sum, message) => sum + message.content.length + JSON.stringify(message.tool_calls ?? []).length, 0)
  if (size > MAX_INPUT_CHARS) throw new Error('Model input exceeds the configured size limit.')
  return result
}
