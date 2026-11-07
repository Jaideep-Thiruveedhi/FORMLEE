/**
 * Phase 6 — Task-scoped working memory.
 *
 * Stores only the information needed to resume the current task. Values are
 * categorized so the engine never treats a model-generated suggestion as a
 * verified fact. Secrets and raw document contents are never stored.
 */

import type { Prisma } from '@prisma/client'
import type { TaskContext } from './types'

export type MemorySource = 'vault' | 'page' | 'model' | 'student' | 'verified'

export interface MemoryEntry {
  key: string
  source: MemorySource
  value: unknown
  stepIndex?: number
  note?: string
}

export function getMemoryValue(ctx: TaskContext, key: string): unknown {
  return ctx.lastToolResults?.[key]
}

export function setMemoryValue(
  ctx: TaskContext,
  entry: MemoryEntry
): TaskContext {
  const results = { ...(ctx.lastToolResults ?? {}) }
  results[entry.key] = {
    source: entry.source,
    value: entry.value,
    stepIndex: entry.stepIndex,
    note: entry.note,
    storedAt: new Date().toISOString(),
  }
  return { ...ctx, lastToolResults: results }
}

export function rememberModelSuggestion(ctx: TaskContext, key: string, value: unknown, stepIndex?: number): TaskContext {
  return setMemoryValue(ctx, { key, source: 'model', value, stepIndex, note: 'AI-generated suggestion; not verified.' })
}

export function rememberStudentDecision(ctx: TaskContext, key: string, value: unknown, stepIndex?: number): TaskContext {
  return setMemoryValue(ctx, { key, source: 'student', value, stepIndex, note: 'Student-confirmed decision.' })
}

export function rememberVerifiedResult(ctx: TaskContext, key: string, value: unknown, stepIndex?: number): TaskContext {
  return setMemoryValue(ctx, { key, source: 'verified', value, stepIndex, note: 'Verified by browser readback or trusted source.' })
}

export function rememberPageFact(ctx: TaskContext, key: string, value: unknown, stepIndex?: number): TaskContext {
  return setMemoryValue(ctx, { key, source: 'page', value, stepIndex, note: 'Observed from examination page; treat as untrusted input.' })
}

export function rememberVaultFact(ctx: TaskContext, key: string, value: unknown, stepIndex?: number): TaskContext {
  return setMemoryValue(ctx, { key, source: 'vault', value, stepIndex, note: 'Retrieved from Student Vault.' })
}

export function addUnresolvedIssue(ctx: TaskContext, issue: string): TaskContext {
  const issues = [...(ctx.unresolvedIssues ?? [])]
  if (!issues.includes(issue)) issues.push(issue)
  return { ...ctx, unresolvedIssues: issues }
}

export function resolveIssue(ctx: TaskContext, issue: string): TaskContext {
  const issues = (ctx.unresolvedIssues ?? []).filter(i => i !== issue)
  return { ...ctx, unresolvedIssues: issues }
}

export function serializeContext(ctx: TaskContext): Prisma.InputJsonValue {
  return ctx as unknown as Prisma.InputJsonValue
}

export function parseContext(json: Prisma.JsonValue | null): TaskContext {
  return (json as TaskContext | null) ?? {}
}

/**
 * Redact sensitive values before storing in task context. Called automatically
 * by the engine before every context persistence.
 */
export function redactContext(ctx: TaskContext): TaskContext {
  const clone: TaskContext = JSON.parse(JSON.stringify(ctx))
  const sensitiveKeys = new Set([
    'password',
    'otp',
    'token',
    'apiKey',
    'secret',
    'accessToken',
    'refreshToken',
    'idToken',
    'rawBody',
    'documentContent',
  ])
  function walk(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(walk)
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = sensitiveKeys.has(k.toLowerCase()) ? '[REDACTED]' : walk(v)
      }
      return out
    }
    return obj
  }
  return walk(clone) as TaskContext
}
