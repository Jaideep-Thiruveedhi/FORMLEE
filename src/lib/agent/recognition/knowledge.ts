/**
 * Phase 7 — task-scoped reusable mapping knowledge.
 *
 * Confirmed mappings are scoped to a lightweight signature derived from the
 * field label, kind and option list. They live only in task context (or an
 * in-memory plan) and are never persisted as universal rules or learned from
 * one student's data. They are applied after deterministic mappings and before
 * semantic/option/AI fallback.
 */

import type { AgentFieldDescriptor } from '@/lib/agent/mapper'
import type { FieldRecognitionResult, RecognitionConfidence, RecognitionSource, ReasoningCategory } from './types'
import { isFillableAgentField } from './semantic'

export interface ConfirmedMapping {
  signature: string
  canonical: string
  confirmedAt: string
}

function normalizeForSignature(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildFieldSignature(descriptor: AgentFieldDescriptor): string {
  const label = normalizeForSignature(descriptor.label)
  const kind = descriptor.kind
  const group = normalizeForSignature(descriptor.group ?? '')
  const options = descriptor.options
    .map(o => normalizeForSignature(o.text))
    .filter(Boolean)
    .sort()
    .join('|')
  return JSON.stringify({ label, kind, group, options })
}

export function applyConfirmedHistory(
  history: Record<string, string>,
  descriptor: AgentFieldDescriptor,
  current: FieldRecognitionResult
): FieldRecognitionResult {
  if (current.status === 'mapped' && current.source !== 'UNRESOLVED' && current.source !== 'AI_SUGGESTION') {
    return current
  }
  const signature = buildFieldSignature(descriptor)
  const canonical = history[signature]
  if (!canonical || !isFillableAgentField(canonical)) return current

  return {
    ...current,
    status: 'mapped',
    canonical,
    ambiguous: [],
    needsReview: true,
    reason: 'Previously confirmed mapping for this label + options',
    source: 'CONFIRMED_HISTORY' as RecognitionSource,
    confidence: 'HIGH' as RecognitionConfidence,
    reasoningCategory: 'HISTORY' as ReasoningCategory,
    warnings: current.warnings,
    aiUsed: current.aiUsed,
  }
}

export function confirmFieldMapping(
  history: Record<string, string>,
  descriptor: AgentFieldDescriptor,
  canonical: string
): Record<string, string> {
  if (!isFillableAgentField(canonical)) return history
  const signature = buildFieldSignature(descriptor)
  return { ...history, [signature]: canonical }
}

export function rejectFieldMapping(
  history: Record<string, string>,
  descriptor: AgentFieldDescriptor
): Record<string, string> {
  const signature = buildFieldSignature(descriptor)
  const next = { ...history }
  delete next[signature]
  return next
}
