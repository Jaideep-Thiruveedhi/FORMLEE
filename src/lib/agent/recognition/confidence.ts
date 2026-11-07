/**
 * Phase 7 — confidence policy.
 *
 * Confidence is derived from the recognition source and match quality. It is
 * NOT authorization: every mapped field still requires student review and a
 * server-side approval before filling.
 */

import type { RecognitionConfidence, RecognitionSource } from './types'

export interface ConfidenceInput {
  source: RecognitionSource
  score?: number
  optionCoverage?: number
  sensitive?: boolean
  historyConfirmed?: boolean
}

export function resolveConfidence(input: ConfidenceInput): RecognitionConfidence {
  if (input.source === 'UNRESOLVED' || input.source === 'AI_SUGGESTION') return 'LOW'
  if (input.source === 'CONFIRMED_HISTORY' && input.historyConfirmed) return 'HIGH'
  if (input.source === 'EXACT_ADAPTER') return 'HIGH'
  if (input.source === 'DETERMINISTIC_ALIAS') return 'HIGH'

  if (input.source === 'OPTION_MATCH') {
    if ((input.optionCoverage ?? 0) >= 0.85) return input.sensitive ? 'MEDIUM' : 'HIGH'
    if ((input.optionCoverage ?? 0) >= 0.6) return 'MEDIUM'
    return 'LOW'
  }

  if (input.source === 'SEMANTIC_MATCH') {
    if ((input.score ?? 0) >= 0.9) return input.sensitive ? 'MEDIUM' : 'HIGH'
    if ((input.score ?? 0) >= 0.75) return 'MEDIUM'
    return 'LOW'
  }

  return 'LOW'
}

export function confidenceRequiresReview(confidence: RecognitionConfidence): boolean {
  return true // Every mapping requires student review before filling.
}

export function confidenceThresholdForAutoMap(confidence: RecognitionConfidence): boolean {
  return confidence === 'HIGH' // Only HIGH is pre-selected; MEDIUM/LOW are not.
}
