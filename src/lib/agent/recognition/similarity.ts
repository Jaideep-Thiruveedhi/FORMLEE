/**
 * Phase 7 — lightweight string similarity helpers.
 *
 * No external dependencies; small, predictable functions for semantic label
 * matching.
 */

export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[b.length][a.length]
}

export function similarityScore(a: string, b: string): number {
  const normalizedA = normalize(a)
  const normalizedB = normalize(b)
  if (normalizedA === normalizedB) return 1
  if (!normalizedA || !normalizedB) return 0
  const distance = levenshtein(normalizedA, normalizedB)
  const maxLen = Math.max(normalizedA.length, normalizedB.length)
  return 1 - distance / maxLen
}

export function containsWords(haystack: string, needles: string[]): boolean {
  const normalized = normalize(haystack)
  const words = normalized.split(' ')
  return needles.every(needle => words.includes(needle) || normalized.includes(needle))
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
