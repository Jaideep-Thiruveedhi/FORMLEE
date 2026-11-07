/**
 * Phase 7 — field mapping conflict detection.
 *
 * Pure function: given recognition results and the student's resolved vault
 * values, surface anything that needs student attention before a fill can be
 * approved. No values are invented.
 */

import { isSensitiveCanonical } from './semantic'
import type { FieldRecognitionResult, RecognitionSource } from './types'

export type ConflictType =
  | 'MULTIPLE_MATCHES'
  | 'MISSING_VALUE'
  | 'AMBIGUOUS_LABEL'
  | 'UNSUPPORTED_OPTION'
  | 'SENSITIVE_INFERENCE'
  | 'LOW_CONFIDENCE'
  | 'UNSUPPORTED_FIELD'
  | 'VALUE_FORMAT'

export interface FieldConflict {
  index: number
  label: string
  kind: string
  type: ConflictType
  message: string
  canonical?: string | null
  source?: RecognitionSource
  confidence?: string
}

export interface ValuesResult {
  values: Record<string, string | boolean>
  missing: string[]
}

export function detectFieldMappingConflicts(
  results: FieldRecognitionResult[],
  values: ValuesResult
): FieldConflict[] {
  const conflicts: FieldConflict[] = []

  for (const item of results) {
    const base = {
      index: item.index,
      label: item.label ?? '',
      kind: 'unknown',
      canonical: item.canonical,
      source: item.source,
      confidence: item.confidence,
    }

    if (item.status === 'ambiguous') {
      const options = item.ambiguous.join(' / ')
      conflicts.push({
        ...base,
        type: 'MULTIPLE_MATCHES',
        message: `Could match several vault fields${options ? ': ' + options : ''}.`,
      })
    }

    if (item.status === 'unmapped' || item.status === 'manual' || item.status === 'unsafe') {
      const reason =
        item.status === 'unsafe'
          ? 'Skipped for safety — fill manually.'
          : item.status === 'manual'
            ? 'Left for manual entry.'
            : 'No confident mapping found — select the correct vault field or enter manually.'
      conflicts.push({
        ...base,
        type: 'UNSUPPORTED_FIELD',
        message: reason,
      })
    }

    if (item.status !== 'mapped') continue

    if (item.canonical && values.missing.includes(item.canonical)) {
      conflicts.push({
        ...base,
        type: 'MISSING_VALUE',
        message: `The saved ${item.canonical} value is missing from your Student Vault.`,
      })
    }

    if (item.confidence === 'LOW') {
      conflicts.push({
        ...base,
        type: 'LOW_CONFIDENCE',
        message: 'Mapping confidence is low — confirm before approving.',
      })
    }

    if (item.canonical && isSensitiveCanonical(item.canonical) && (item.source === 'AI_SUGGESTION' || item.source === 'SEMANTIC_MATCH')) {
      conflicts.push({
        ...base,
        type: 'SENSITIVE_INFERENCE',
        message: `Sensitive field (${item.canonical}) was inferred by ${item.source === 'AI_SUGGESTION' ? 'AI' : 'semantic matching'} — review carefully.`,
      })
    }

    if (item.optionMappingSuggestion && item.canonical) {
      const mappedOptions = Object.keys(item.optionMappingSuggestion)
      const unmapped = item.options?.filter(o => !mappedOptions.includes(o.text)) ?? []
      if (unmapped.length > 0) {
        conflicts.push({
          ...base,
          type: 'UNSUPPORTED_OPTION',
          message: `${unmapped.length} option(s) could not be matched to a canonical value.`,
        })
      }
    }

    for (const warning of item.warnings) {
      conflicts.push({
        ...base,
        type: 'AMBIGUOUS_LABEL',
        message: warning,
      })
    }
  }

  return conflicts
}
