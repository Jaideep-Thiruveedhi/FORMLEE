/**
 * Phase 7 — semantic field matching.
 *
 * Uses label similarity, field kind and structural context to suggest mappings
 * when deterministic aliases did not match. No student values are used.
 */

import { AGENT_FILLABLE_FIELDS, type AgentFillableField } from '@/lib/agent/fields'
import { similarityScore, containsWords } from './similarity'
import type { AgentFieldDescriptor } from '@/lib/agent/mapper'

export interface SemanticMatch {
  canonical: AgentFillableField
  score: number
  reason: string
}

const SEMANTIC_PATTERNS: { canonical: AgentFillableField; phrases: string[]; kindHint?: string[]; reject?: string[] }[] = [
  {
    canonical: 'fullName',
    phrases: ['candidate name', 'name of candidate', 'applicant name', 'student name', 'your name', 'full name'],
    kindHint: ['text'],
    reject: ['father', 'mother', 'guardian', 'parent'],
  },
  {
    canonical: 'email',
    phrases: ['email address', 'email id', 'e-mail', 'mail address'],
    kindHint: ['text', 'email'],
    reject: ['alternate', 'secondary'],
  },
  {
    canonical: 'mobileNumber',
    phrases: ['mobile number', 'mobile no', 'phone number', 'contact number', 'cell number'],
    kindHint: ['text', 'tel'],
    reject: ['alternate', 'parent', 'guardian', 'landline'],
  },
  {
    canonical: 'gender',
    phrases: ['gender', 'sex'],
    kindHint: ['select', 'radio'],
  },
  {
    canonical: 'dateOfBirth',
    phrases: ['date of birth', 'birth date', 'dob', 'date of brith'],
    kindHint: ['date'],
  },
  {
    canonical: 'nationality',
    phrases: ['nationality', 'country of citizenship', 'citizenship'],
    kindHint: ['select', 'radio', 'text'],
  },
  {
    canonical: 'category',
    phrases: ['category', 'reservation category', 'community', 'caste category', 'social category'],
    kindHint: ['select', 'radio'],
  },
  {
    canonical: 'class10Board',
    phrases: ['class 10 board', 'class x board', '10th board', 'secondary board', 'matriculation board'],
    kindHint: ['text', 'select'],
  },
  {
    canonical: 'class12Board',
    phrases: ['class 12 board', 'class xii board', '12th board', 'senior secondary board', 'intermediate board'],
    kindHint: ['text', 'select'],
  },
  {
    canonical: 'class12Status',
    phrases: ['qualifying examination passed appearing', 'class 12 status', 'qualifying exam status', 'examination passed or appearing'],
    kindHint: ['select', 'radio'],
  },
  {
    canonical: 'pwdStatus',
    phrases: ['person with disability', 'pwd', 'pwbd', 'disability status', 'differently abled'],
    kindHint: ['checkbox', 'select', 'radio'],
  },
]

const SENSITIVE_FIELDS: AgentFillableField[] = ['category', 'pwdStatus', 'nationality', 'gender']

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function semanticMatch(descriptor: AgentFieldDescriptor): SemanticMatch | null {
  const label = normalizeLabel(descriptor.label)
  const group = normalizeLabel(descriptor.group ?? '')
  const combined = group ? `${group} ${label}` : label
  let best: SemanticMatch | null = null

  for (const pattern of SEMANTIC_PATTERNS) {
    if (pattern.kindHint && descriptor.kind && !pattern.kindHint.includes(descriptor.kind)) continue
    if (pattern.reject && pattern.reject.some(word => combined.includes(word))) continue

    for (const phrase of pattern.phrases) {
      const phraseWords = phrase.split(' ')
      const contains = containsWords(combined, phraseWords)
      const score = contains ? 0.85 : similarityScore(combined, phrase)
      if (score >= 0.7 && (!best || score > best.score)) {
        best = {
          canonical: pattern.canonical,
          score,
          reason: `Semantic label match: "${phrase}"`,
        }
      }
    }
  }

  return best
}

export function isSensitiveCanonical(canonical: string): boolean {
  return SENSITIVE_FIELDS.includes(canonical as AgentFillableField)
}

export function canonicalLabel(canonical: string): string {
  // Convert camelCase to spaced words for display.
  return canonical.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
}

export function isFillableAgentField(field: string): field is AgentFillableField {
  return AGENT_FILLABLE_FIELDS.includes(field as AgentFillableField)
}
