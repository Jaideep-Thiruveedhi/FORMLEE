/**
 * Phase 7 — public exports for the field recognition and mapping system.
 */

export { recognizeFields } from './pipeline'
export { detectFieldMappingConflicts } from './conflicts'
export {
  buildFieldSignature,
  applyConfirmedHistory,
  confirmFieldMapping,
  rejectFieldMapping,
  type ConfirmedMapping,
} from './knowledge'
export { identifyOptionSet, matchOptionsToCanonicalSet, matchBoardOptions } from './options'
export { semanticMatch, isSensitiveCanonical, canonicalLabel, isFillableAgentField } from './semantic'
export { resolveConfidence, confidenceRequiresReview, confidenceThresholdForAutoMap } from './confidence'
export { recognizeFieldsWithAi } from './ai'
export type {
  FieldRecognitionResult,
  RecognitionConfidence,
  RecognitionOptions,
  RecognitionSource,
  RecognitionSummary,
  ReasoningCategory,
} from './types'
