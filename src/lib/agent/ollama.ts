import { AGENT_FILLABLE_FIELDS, isFillableAgentField, type AgentFillableField } from './fields'

/**
 * Apply Agent V1 — local Ollama integration (tier 2 mapping only).
 *
 * PRIVACY CONTRACT (enforced here, not by convention):
 *  - The request payload contains ONLY: field labels, option labels/values,
 *    input kind markers and the canonical allowlist. Student names, dates of
 *    birth, phone numbers, addresses, marks, document contents or any actual
 *    field values never appear in this module's request text.
 *  - Model output is parsed as JSON and every mapping value is validated
 *    against the same allowlist the deterministic engine uses; anything else
 *    is dropped. Model output cannot add browsers actions — it only names a
 *    canonical profile field, and values are resolved separately on the
 *    server from the student's own profile.
 *  - Unavailability degrades gracefully: the deterministic plan is kept and a
 *    clear note is returned. Nothing throws to the caller for transport errors.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11435'
const DEFAULT_MODEL = 'qwen3.8-8k:latest'
const REQUEST_TIMEOUT_MS = 8000

export function ollamaBaseUrl(): string {
  const configured = process.env.OLLAMA_BASE_URL
  // Never fall back to a developer's loopback Ollama service in production.
  if (process.env.NODE_ENV === 'production' && !configured) return ''
  return (configured ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL ?? DEFAULT_MODEL
}

export interface OllamaProbe {
  reachable: boolean
  models: string[]
  error: string | null
}

/** Used by validation/health checks; never part of the mapping hot path. */
export async function probeOllama(): Promise<OllamaProbe> {
  try {
    const response = await fetch(ollamaBaseUrl() + '/api/tags', {
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) {
      return { reachable: false, models: [], error: 'HTTP ' + response.status }
    }
    const body = (await response.json().catch(() => null)) as { models?: { name?: string }[] } | null
    const models = (body?.models ?? []).map(m => String(m?.name ?? '')).filter(Boolean)
    return { reachable: true, models, error: null }
  } catch (error) {
    return { reachable: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export interface OllamaMappingField {
  index: number
  kind: string
  label: string
  options: { text: string; value: string }[]
}

export interface OllamaMappingResult {
  suggestions: { index: number; canonical: AgentFillableField }[]
  aiUsed: boolean
  aiNote: string | null
}

function buildPrompt(fields: OllamaMappingField[], allowedFields: string[]): string {
  const lines: string[] = []
  for (const field of fields) {
    const optionTexts = field.options.map(o => o.text).slice(0, 40).join(' | ')
    lines.push(
      field.index + '. kind=' + field.kind + ' label="' + field.label.slice(0, 240) + '"' +
      (optionTexts ? ' options=[' + optionTexts + ']' : '')
    )
  }
  return [
    'You map form fields from examination application pages to allowed profile attribute names.',
    'Allowed attribute names:',
    allowedFields.join(', '),
    'For each numbered field below, choose the ONE allowed attribute it most likely collects, or skip it.',
    'Skip a field when the label is unclear, when several attributes could fit, or when it is not personal-profile data (passwords, payments, documents, agreements).',
    'Answer ONLY with minified JSON of the shape {"mappings":{"<field index>":"<attribute>"}}.',
    'Do not invent attribute names. Do not add commentary.',
    'Fields:',
    lines.join('\n'),
  ].join('\n')
}

function parseOllamaJson(raw: string): Map<number, string> {
  const suggestions = new Map<number, string>()
  const cleaned = raw.trim()
  if (!cleaned) return suggestions
  let parsed: unknown = null
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Tolerate fenced output: first {...} block only.
    const match = /\{[\s\S]*\}/.exec(cleaned)
    if (!match) return suggestions
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return suggestions
    }
  }
  const mappingRecord =
    parsed !== null && typeof parsed === 'object' && 'mappings' in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>).mappings
      : parsed
  if (mappingRecord === null || typeof mappingRecord !== 'object' || Array.isArray(mappingRecord)) {
    return suggestions
  }
  for (const [key, value] of Object.entries(mappingRecord as Record<string, unknown>)) {
    const index = parseInt(key, 10)
    if (!Number.isInteger(index)) continue
    if (typeof value === 'string') suggestions.set(index, value)
  }
  return suggestions
}

export async function mapFieldsWithOllama(fields: OllamaMappingField[]): Promise<OllamaMappingResult> {
  const allowedFields = [...AGENT_FILLABLE_FIELDS].filter(isFillableAgentField)
  if (fields.length === 0) return { suggestions: [], aiUsed: false, aiNote: null }

  try {
    const response = await fetch(ollamaBaseUrl() + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: ollamaModel(),
        prompt: buildPrompt(fields, allowedFields),
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
    })
    if (!response.ok) {
      return {
        suggestions: [],
        aiUsed: false,
        aiNote: 'Local Ollama model responded with HTTP ' + response.status + ' — deterministic mappings only.',
      }
    }
    const body = (await response.json().catch(() => null)) as { response?: string } | null
    const raw = typeof body?.response === 'string' ? body.response : ''
    const parsed = parseOllamaJson(raw)

    const suggestions: { index: number; canonical: AgentFillableField }[] = []
    const indexSet = new Set(fields.map(f => f.index))
    for (const [index, canonical] of parsed) {
      if (!indexSet.has(index)) continue
      if (typeof canonical !== 'string') continue
      // Hard allowlist validation — model output never extends the set of
      // fillable fields and never names a manual-only list field.
      if (!isFillableAgentField(canonical)) continue
      suggestions.push({ index, canonical })
    }
    return { suggestions, aiUsed: true, aiNote: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const hint = /timeout|aborted|fetch|econnrefuse|enotfound| refused/i.test(message)
      ? 'Local Ollama model unreachable at ' + ollamaBaseUrl() + ' — deterministic mappings only.'
      : 'Local Ollama model could not be used — deterministic mappings only.'
    return { suggestions: [], aiUsed: false, aiNote: hint }
  }
}
