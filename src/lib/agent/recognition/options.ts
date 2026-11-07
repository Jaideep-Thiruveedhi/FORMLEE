/**
 * Phase 7 — Deterministic option matching.
 *
 * Matches dropdown/radio option lists against canonical option sets without
 * sending student values anywhere. Used before any AI fallback.
 */

import { levenshtein } from './similarity'
import { PROFILE_OPTION_SETS } from '@/lib/agent/fields'

export interface OptionPair {
  text: string
  value: string
}

export interface OptionMatchResult {
  canonical: string
  confidence: number
  mapping: Record<string, string>
}

const OPTION_SETS: Record<string, { canonical: string; label: string }[]> = {
  state: PROFILE_OPTION_SETS.state.map(o => ({ canonical: o.value, label: o.label })),
  nationality: PROFILE_OPTION_SETS.nationality.map(o => ({ canonical: o.value, label: o.label })),
  gender: PROFILE_OPTION_SETS.gender.map(o => ({ canonical: o.value, label: o.label })),
  category: PROFILE_OPTION_SETS.category.map(o => ({ canonical: o.value, label: o.label })),
  class12Status: PROFILE_OPTION_SETS.class12Status.map(o => ({ canonical: o.value, label: o.label })),
  marksKind: PROFILE_OPTION_SETS.marksKind.map(o => ({ canonical: o.value, label: o.label })),
}

const BOARD_OPTIONS: { canonical: string; labels: string[] }[] = [
  { canonical: 'CBSE', labels: ['cbse', 'central board of secondary education', 'central board'] },
  { canonical: 'ICSE', labels: ['icse', 'council for the indian school certificate examinations', 'cisce'] },
  { canonical: 'STATE_BOARD', labels: ['state board', 'state board of education', 'board of secondary education'] },
  { canonical: 'NIOS', labels: ['nios', 'national institute of open schooling', 'open school'] },
]

function normalizeOption(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bestCanonicalMatch(
  optionText: string,
  candidates: { canonical: string; label: string }[]
): { canonical: string; score: number } | null {
  const normalized = normalizeOption(optionText)
  if (!normalized) return null
  let best: { canonical: string; score: number } | null = null
  for (const candidate of candidates) {
    const candidateNormalized = normalizeOption(candidate.label)
    const exact = normalized === candidateNormalized
    const score = exact ? 1 : 1 - levenshtein(normalized, candidateNormalized) / Math.max(normalized.length, candidateNormalized.length)
    if (score >= 0.8 && (!best || score > best.score)) {
      best = { canonical: candidate.canonical, score }
    }
  }
  return best
}

export function matchOptionsToCanonicalSet(
  options: OptionPair[],
  setName: keyof typeof OPTION_SETS
): OptionMatchResult | null {
  const candidates = OPTION_SETS[setName]
  if (!candidates || options.length === 0) return null

  const mapping: Record<string, string> = {}
  let matched = 0
  let totalScore = 0

  for (const option of options) {
    const text = option.text || option.value
    const match = bestCanonicalMatch(text, candidates)
    if (match) {
      mapping[text] = match.canonical
      matched += 1
      totalScore += match.score
    }
  }

  if (matched === 0) return null
  const coverage = matched / options.length
  const avgScore = totalScore / matched
  const confidence = coverage >= 0.85 && avgScore >= 0.9 ? 0.95 : coverage >= 0.6 ? 0.75 : 0.5

  return { canonical: setName, confidence, mapping }
}

export function matchBoardOptions(options: OptionPair[]): OptionMatchResult | null {
  if (options.length === 0) return null
  const mapping: Record<string, string> = {}
  let matched = 0

  for (const option of options) {
    const text = normalizeOption(option.text || option.value)
    for (const board of BOARD_OPTIONS) {
      if (board.labels.some(label => text === label || text.includes(label))) {
        mapping[option.text || option.value] = board.canonical
        matched += 1
        break
      }
    }
  }

  if (matched === 0) return null
  const confidence = matched / options.length
  return { canonical: 'board', confidence, mapping }
}

export function identifyOptionSet(options: OptionPair[]): {
  setName: keyof typeof OPTION_SETS | 'board'
  result: OptionMatchResult
} | null {
  const entries = Object.entries(OPTION_SETS) as [keyof typeof OPTION_SETS, { canonical: string; label: string }[]][]
  let best: { setName: keyof typeof OPTION_SETS | 'board'; result: OptionMatchResult } | null = null

  for (const [setName] of entries) {
    const result = matchOptionsToCanonicalSet(options, setName)
    if (result && (!best || result.confidence > best.result.confidence)) {
      best = { setName, result }
    }
  }

  const boardResult = matchBoardOptions(options)
  if (boardResult && (!best || boardResult.confidence > best.result.confidence)) {
    best = { setName: 'board', result: boardResult }
  }

  return best
}
