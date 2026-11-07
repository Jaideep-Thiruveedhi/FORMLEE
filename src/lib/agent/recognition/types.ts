/**
 * Phase 7 — Field recognition and mapping types.
 *
 * Privacy-first structured results for understanding examination form fields.
 * No student values appear in these types.
 */

import type { AgentFieldDescriptor } from '@/lib/agent/mapper'

export type RecognitionSource =
  | 'EXACT_ADAPTER'
  | 'DETERMINISTIC_ALIAS'
  | 'SEMANTIC_MATCH'
  | 'OPTION_MATCH'
  | 'AI_SUGGESTION'
  | 'CONFIRMED_HISTORY'
  | 'UNRESOLVED'

export type RecognitionConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type ReasoningCategory =
  | 'LABEL_MATCH'
  | 'OPTION_MATCH'
  | 'CONTEXT_INFERENCE'
  | 'ADAPTER_RULE'
  | 'HISTORY'
  | 'UNKNOWN'

export interface FieldRecognitionResult {
  index: number
  label: string
  status: 'mapped' | 'ambiguous' | 'manual' | 'unsafe' | 'unmapped'
  canonical: string | null
  ambiguous: string[]
  needsReview: boolean
  reason: string
  source: RecognitionSource
  confidence: RecognitionConfidence
  reasoningCategory: ReasoningCategory
  optionMappingSuggestion?: Record<string, string>
  options?: { text: string; value: string }[]
  warnings: string[]
  aiUsed: boolean
}

export interface RecognitionOptions {
  adapterId?: string
  pageKind?: string
  pageFingerprint?: string
  useHistory?: boolean
  history?: Record<string, string>
  signal?: AbortSignal
  sensitiveValues?: string[]
}

export interface RecognitionSummary {
  sourceBreakdown: Partial<Record<RecognitionSource, number>>
  aiUsed: boolean
  aiNote: string | null
  unresolvedCount: number
  warnings: string[]
}

export interface RecognizeFieldsInput {
  fields: AgentFieldDescriptor[]
  options?: RecognitionOptions
}
