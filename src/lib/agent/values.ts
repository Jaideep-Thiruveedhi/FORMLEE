import { AGENT_FILLABLE_SET, AGENT_MANUAL_ONLY_SET } from './fields'
import { valueFromProfileRow } from './value-source'
import { prisma } from '@/lib/prisma'

/**
 * Apply Agent V1 — value resolution.
 *
 * Canonical field names in, concrete values out — resolved ONLY from the
 * student's own saved profile row of the paired workspace. The agent never
 * invents values: a canonical field with no saved value is reported as
 * "missing" so the extension leaves the form field untouched and tells the
 * student to fill it by hand.
 */

export interface AgentValuesResult {
  values: Record<string, string | boolean>
  missing: string[]
}

const MAX_REQUESTED_FIELDS = 30

export async function resolveAgentValues(workspaceId: string, requested: unknown): Promise<AgentValuesResult> {
  const fields = (Array.isArray(requested) ? requested : [])
    .filter((f): f is string => typeof f === 'string')
    .filter(f => AGENT_FILLABLE_SET.has(f) && !AGENT_MANUAL_ONLY_SET.has(f))
    .slice(0, MAX_REQUESTED_FIELDS)

  const values: Record<string, string | boolean> = {}
  const missing: string[] = []
  if (fields.length === 0) return { values, missing }

  const profile = await prisma.studentProfile.findUnique({ where: { workspaceId } })
  if (!profile) {
    return { values, missing: [...fields] }
  }

  for (const field of fields) {
    const value = valueFromProfileRow(profile as unknown as Record<string, unknown>, field)
    if (value === null || value === '' || value === false) {
      missing.push(field)
    } else {
      values[field] = value
    }
  }

  return { values, missing }
}
