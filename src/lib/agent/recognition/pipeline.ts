/**
 * Phase 7 — strict recognition pipeline.
 *
 * Priority:
 *   1. Exact examination-adapter mappings
 *   2. Deterministic aliases
 *   3. Confirmed task-scoped history
 *   4. Semantic label matching
 *   5. Deterministic option matching
 *   6. AI-assisted fallback
 *   7. Unresolved
 *
 * The pipeline never sends student values to the model. It only ever passes
 * field metadata (label, kind, options, section). Adapter matches are final:
 * when an adapter claims the page, the generic pipeline does not override it.
 */

import {
  isUnsafeFieldDescriptor,
  matchFieldDeterministically,
  type AgentMappingCandidate,
} from '@/lib/agent/fields'
import { getAdapterById, mapFieldWithAdapter } from '@/lib/agent/registry'
import type { AgentAdapterId, AgentMappingDecision, AgentPageKind } from '@/lib/agent/adapter-types'
import type { AgentFieldDescriptor } from '@/lib/agent/mapper'
import { identifyOptionSet } from './options'
import { semanticMatch, isSensitiveCanonical, isFillableAgentField } from './semantic'
import { resolveConfidence } from './confidence'
import { recognizeFieldsWithAi } from './ai'
import { applyConfirmedHistory } from './knowledge'
import type {
  FieldRecognitionResult,
  RecognitionConfidence,
  RecognitionOptions,
  RecognitionSource,
  RecognitionSummary,
  ReasoningCategory,
} from './types'

const AI_ELIGIBLE_KINDS = new Set(['text', 'textarea', 'select', 'radio', 'date', 'number', 'email', 'tel'])

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function classHints(label: string): { class10: boolean; class12: boolean } {
  const loose = normalizeLabel(label)
  return {
    class10: /\b(10|10th|x|xth|ten|tenth|sslc|matric|matriculation)\b/.test(loose),
    class12: /\b(12|12th|xii|xiith|twelve|twelfth|hsc|intermediate|inter|senior secondary|sr secondary)\b/.test(loose),
  }
}

function optionPairs(descriptor: AgentFieldDescriptor): { text: string; value: string }[] {
  return descriptor.options.map(o => ({ text: o.text, value: o.value ?? '' }))
}

function baseResult(descriptor: AgentFieldDescriptor): FieldRecognitionResult {
  return {
    index: descriptor.index,
    label: descriptor.label || '(no label detected)',
    status: 'unmapped',
    canonical: null,
    ambiguous: [],
    needsReview: true,
    reason: 'No confident mapping found',
    source: 'UNRESOLVED',
    confidence: 'LOW',
    reasoningCategory: 'UNKNOWN',
    warnings: [],
    aiUsed: false,
  }
}

function fromAdapterDecision(
  descriptor: AgentFieldDescriptor,
  decision: AgentMappingDecision
): FieldRecognitionResult {
  const status = decision.status
  const canonical = decision.canonical && isFillableAgentField(decision.canonical) ? decision.canonical : null
  const confidence: RecognitionConfidence = status === 'mapped' ? 'HIGH' : 'LOW'
  return {
    index: descriptor.index,
    label: descriptor.label || '(no label detected)',
    status,
    canonical,
    ambiguous: decision.ambiguous,
    needsReview: decision.needsReview,
    reason: decision.reason,
    source: 'EXACT_ADAPTER',
    confidence,
    reasoningCategory: status === 'mapped' ? 'ADAPTER_RULE' : 'UNKNOWN',
    warnings: [],
    aiUsed: false,
  }
}

function fromDeterministicCandidate(
  descriptor: AgentFieldDescriptor,
  candidate: AgentMappingCandidate
): FieldRecognitionResult {
  const status = candidate.status
  const canonical = candidate.canonical && isFillableAgentField(candidate.canonical) ? candidate.canonical : null
  return {
    index: descriptor.index,
    label: descriptor.label || '(no label detected)',
    status,
    canonical,
    ambiguous: candidate.ambiguous,
    needsReview: candidate.needsReview,
    reason: candidate.reason,
    source: 'DETERMINISTIC_ALIAS',
    confidence: status === 'mapped' ? 'HIGH' : 'LOW',
    reasoningCategory: status === 'mapped' ? 'LABEL_MATCH' : 'UNKNOWN',
    warnings: [],
    aiUsed: false,
  }
}

function resolveOptionSetTarget(
  descriptor: AgentFieldDescriptor,
  setName: string,
  mapping: Record<string, string>
): FieldRecognitionResult {
  const label = normalizeLabel(descriptor.label)
  const group = normalizeLabel(descriptor.group ?? '')
  const combined = group ? `${group} ${label}` : label
  const hints = classHints(combined)
  let canonical: string | null = null
  let ambiguous: string[] = []
  let reason = `Options matched the ${setName} canonical set`

  switch (setName) {
    case 'gender':
      canonical = 'gender'
      break
    case 'nationality':
      canonical = 'nationality'
      break
    case 'category':
      canonical = 'category'
      break
    case 'class12Status':
      canonical = 'class12Status'
      break
    case 'state':
      if (/\b(domicile|home state)\b/.test(combined)) canonical = 'homeState'
      else if (/\bpermanent\b/.test(combined)) canonical = 'permanentState'
      else if (/\b(current|present|correspondence|communication)\b/.test(combined)) canonical = 'currentState'
      else ambiguous = ['state', 'homeState']
      break
    case 'marksKind':
      if (hints.class10 && !hints.class12) canonical = 'class10MarksKind'
      else if (hints.class12 && !hints.class10) canonical = 'class12MarksKind'
      else ambiguous = ['class10MarksKind', 'class12MarksKind']
      break
    case 'board':
      if (hints.class10 && !hints.class12) canonical = 'class10Board'
      else if (hints.class12 && !hints.class10) canonical = 'class12Board'
      else ambiguous = ['class10Board', 'class12Board']
      break
  }

  const status: FieldRecognitionResult['status'] = canonical ? 'mapped' : ambiguous.length > 0 ? 'ambiguous' : 'unmapped'
  const optionCoverage = Object.keys(mapping).length / Math.max(1, descriptor.options.length)
  const sensitive = canonical ? isSensitiveCanonical(canonical) : false
  const confidence = resolveConfidence({
    source: 'OPTION_MATCH',
    optionCoverage: status === 'mapped' ? optionCoverage : 0,
    sensitive,
  })

  return {
    index: descriptor.index,
    label: descriptor.label || '(no label detected)',
    status,
    canonical,
    ambiguous,
    needsReview: true,
    reason,
    source: 'OPTION_MATCH',
    confidence,
    reasoningCategory: 'OPTION_MATCH',
    optionMappingSuggestion: mapping,
    warnings: [],
    aiUsed: false,
  }
}

export async function recognizeFields(
  fields: AgentFieldDescriptor[],
  options: RecognitionOptions = {}
): Promise<{ results: FieldRecognitionResult[]; summary: RecognitionSummary }> {
  const adapterId = options.adapterId as AgentAdapterId | undefined
  const adapter = adapterId && adapterId !== 'generic' && adapterId !== 'none' ? getAdapterById(adapterId) : null
  const pageKind = (options.pageKind as AgentPageKind) ?? 'unknown'
  const history = options.history ?? {}
  const useHistory = options.useHistory !== false

  const results: FieldRecognitionResult[] = []
  const pendingAi: AgentFieldDescriptor[] = []
  let anyAiUsed = false
  let aiNote: string | null = null

  for (const descriptor of fields) {
    // 1. Safety guard.
    if (
      isUnsafeFieldDescriptor({
        label: descriptor.label,
        inputName: descriptor.inputName,
        inputId: descriptor.inputId,
        inputType: descriptor.inputType,
        autocomplete: descriptor.autocomplete,
      })
    ) {
      results.push({
        ...baseResult(descriptor),
        status: 'unsafe',
        reason: 'Skipped for safety (password, OTP, payment or identity-document related)',
        options: descriptor.options,
      })
      continue
    }

    // 2. Exact adapter mapping (final if an adapter claims the page).
    if (adapter) {
      if (!adapter.isSupportedPageKind(pageKind)) {
        results.push({
          ...baseResult(descriptor),
          status: 'manual',
          source: 'EXACT_ADAPTER',
          reason: adapter.pageNotice(pageKind),
        })
      } else {
        const decision = mapFieldWithAdapter(
          adapter,
          {
            kind: descriptor.kind,
            label: descriptor.label,
            group: descriptor.group,
            inputName: descriptor.inputName,
            inputId: descriptor.inputId,
            options: optionPairs(descriptor),
          },
          pageKind
        )
        results.push(fromAdapterDecision(descriptor, decision))
      }
      continue
    }

    // 3. Deterministic aliases.
    const candidate = matchFieldDeterministically({
      kind: descriptor.kind,
      label: descriptor.label,
      inputName: descriptor.inputName,
      inputId: descriptor.inputId,
      required: descriptor.required,
      options: optionPairs(descriptor),
      inputType: descriptor.inputType,
      autocomplete: descriptor.autocomplete,
    })
    let result = fromDeterministicCandidate(descriptor, candidate)

    // 4. Confirmed task-scoped history.
    if (useHistory) {
      result = applyConfirmedHistory(history, descriptor, result)
    }

    // 5. Option matching (only when the field has options and is still unresolved).
    if (
      (result.status === 'unmapped' || result.status === 'ambiguous') &&
      descriptor.options.length > 0 &&
      (descriptor.kind === 'select' || descriptor.kind === 'radio' || descriptor.kind === 'checkbox')
    ) {
      const optionMatch = identifyOptionSet(optionPairs(descriptor))
      if (optionMatch) {
        result = resolveOptionSetTarget(descriptor, optionMatch.setName, optionMatch.result.mapping)
      }
    }

    // 6. Semantic label matching.
    if (result.status === 'unmapped' && descriptor.label.trim().length > 0) {
      const match = semanticMatch(descriptor)
      if (match) {
        const sensitive = isSensitiveCanonical(match.canonical)
        const confidence = resolveConfidence({ source: 'SEMANTIC_MATCH', score: match.score, sensitive })
        result = {
          ...result,
          status: confidence === 'LOW' ? 'unmapped' : 'mapped',
          canonical: confidence === 'LOW' ? null : match.canonical,
          reason: match.reason,
          source: 'SEMANTIC_MATCH',
          confidence,
          reasoningCategory: 'CONTEXT_INFERENCE',
          warnings: sensitive ? ['Sensitive field inferred from label; review carefully.'] : [],
          aiUsed: false,
        }
      }
    }

    // 7. Queue genuinely unresolved fields for AI fallback.
    if (
      result.status === 'unmapped' &&
      AI_ELIGIBLE_KINDS.has(descriptor.kind) &&
      descriptor.label.trim().length > 0
    ) {
      pendingAi.push(descriptor)
      results.push({ ...result, reason: result.reason + ' — queued for AI fallback' })
      continue
    }

    results.push(result)
  }

  // 8. AI fallback (batched, privacy-checked by the AI module).
  if (pendingAi.length > 0) {
    const aiResult = await recognizeFieldsWithAi(pendingAi, { signal: options.signal, sensitiveValues: options.sensitiveValues })
    anyAiUsed = aiResult.aiUsed
    aiNote = aiResult.aiNote
    if (aiResult.ok) {
      for (const aiField of aiResult.results) {
        const idx = results.findIndex(r => r.index === aiField.index)
        if (idx !== -1) {
          results[idx] = aiField
        }
      }
    }
  }

  const descriptorByIndex = new Map(fields.map(f => [f.index, f]))
  for (const r of results) {
    const d = descriptorByIndex.get(r.index)
    if (d) {
      r.label = d.label || r.label || '(no label detected)'
      r.options = d.options
    }
  }

  const summary = buildSummary(results, anyAiUsed, aiNote)
  return { results, summary }
}

function buildSummary(
  results: FieldRecognitionResult[],
  aiUsed: boolean,
  aiNote: string | null
): RecognitionSummary {
  const sourceBreakdown: Partial<Record<RecognitionSource, number>> = {}
  for (const r of results) {
    sourceBreakdown[r.source] = (sourceBreakdown[r.source] ?? 0) + 1
  }
  const unresolvedCount = results.filter(r => r.status === 'unmapped' || r.status === 'manual' || r.status === 'unsafe').length
  const warnings = results.flatMap(r => r.warnings)
  if (aiNote) warnings.push(aiNote)
  return {
    sourceBreakdown,
    aiUsed,
    aiNote,
    unresolvedCount,
    warnings: [...new Set(warnings)],
  }
}
