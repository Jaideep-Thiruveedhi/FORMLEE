/**
 * Agent Tool Audit service.
 *
 * Minimal, privacy-preserving record of tool executions. Never stores secrets,
 * tokens, document contents or raw student field values. Resource references
 * are intentionally limited to ids and safe metadata.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface AuditInput {
  toolName: string
  workspaceId: string
  userId: string
  agentSessionId?: string
  status: 'success' | 'validation_error' | 'permission_denied' | 'execution_error'
  durationMs?: number
  permissionDecision: {
    granted: boolean
    required: string[]
    held: string[]
  }
  errorCategory?: string
  resourceRefs?: Record<string, unknown>
}

const SENSITIVE_KEYS = new Set([
  'password',
  'otp',
  'token',
  'apiKey',
  'secret',
  'accessToken',
  'refreshToken',
  'idToken',
  'rawBody',
  'payload',
  'documentContent',
  'value',
  'values',
])

function redactValue(key: string, value: unknown): unknown {
  if (typeof key === 'string' && SENSITIVE_KEYS.has(key.toLowerCase())) {
    return '[REDACTED]'
  }
  if (Array.isArray(value)) return value.map((v, i) => redactValue(String(i), v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v)
    }
    return out
  }
  return value
}

export async function recordToolAudit(input: AuditInput): Promise<void> {
  const safeRefs = input.resourceRefs ? redactValue('refs', input.resourceRefs) : null
  try {
    await prisma.agentToolAudit.create({
      data: {
        toolName: input.toolName,
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentSessionId: input.agentSessionId ?? null,
        status: input.status,
        durationMs: input.durationMs ?? null,
        permissionDecision: input.permissionDecision as unknown as Prisma.InputJsonValue,
        errorCategory: input.errorCategory ?? null,
        resourceRefs: safeRefs as unknown as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (error) {
    // Audit failure must never break a real tool execution. Log to stderr only.
    console.error('[AgentToolAudit] failed to record audit entry:', error instanceof Error ? error.message : String(error))
  }
}
