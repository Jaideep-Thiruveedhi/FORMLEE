import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  type AgentSessionRowLike,
  AGENT_SESSION_HEADER,
  isAgentSessionUsable,
  isAgentTokenShape,
  readAgentSessionToken,
} from './agent-session-policy'

export { AGENT_SESSION_HEADER } from './agent-session-policy'

/**
 * Apply Agent V1 — extension pairing & session management.
 *
 * The browser sends ONLY:
 *   1. a human-readable pairing CODE (displayed on /apply/agent), exchanged
 *      once for
 *   2. a short-lived agent SESSION token (64-hex) scoped to the workspace the
 *      code was issued for.
 *
 * The httpOnly workspace cookie is read server-side only and never enters
 * extension JavaScript. Tickets are single-use and expire quickly; sessions
 * expire on their own and can be revoked by the student from the agent page.
 */

const TICKET_TTL_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 30 * 60 * 1000

/** Unambiguous alphabet (no I/L/O/0/1) for human-typed pairing codes. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_GROUPS = 3
const CODE_GROUP_LENGTH = 5

const TOKEN_HEX_LENGTH = 64

export interface IssuedTicket {
  code: string
  expiresAt: Date
}

function readSecureRandomAlphabet(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

function displayCode(code: string): string {
  const groups: string[] = []
  for (let i = 0; i < code.length; i += CODE_GROUP_LENGTH) {
    groups.push(code.slice(i, i + CODE_GROUP_LENGTH))
  }
  return groups.join('-')
}

export async function createAgentPairingTicket(workspaceId: string): Promise<IssuedTicket> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = readSecureRandomAlphabet(CODE_GROUPS * CODE_GROUP_LENGTH)
    const exists = await prisma.agentPairingTicket.findUnique({ where: { code }, select: { id: true } })
    if (exists) continue
    const row = await prisma.agentPairingTicket.create({
      data: {
        code,
        workspaceId,
        expiresAt: new Date(Date.now() + TICKET_TTL_MS),
      },
    })
    return { code: displayCode(row.code), expiresAt: row.expiresAt }
  }
  throw new Error('Could not allocate a unique pairing code')
}

export type PairAttemptResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; status: number; code: string; error: string }

export function normalizePairingCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export async function pairWithCode(rawCode: unknown): Promise<PairAttemptResult> {
  const code = normalizePairingCode(rawCode)
  if (code.length !== CODE_GROUPS * CODE_GROUP_LENGTH) {
    return { ok: false, status: 400, code: 'PAIRING_CODE_INVALID', error: 'Enter the pairing code as shown on the Formlee agent page.' }
  }

  const ticket = await prisma.agentPairingTicket.findUnique({ where: { code } })
  if (!ticket) {
    return { ok: false, status: 404, code: 'PAIRING_CODE_INVALID', error: 'This pairing code is not valid. Generate a fresh one on the Formlee agent page.' }
  }
  if (ticket.usedAt) {
    return { ok: false, status: 409, code: 'PAIRING_ALREADY_USED', error: 'This pairing code was already used. Generate a fresh one on the Formlee agent page.' }
  }
  if (ticket.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 410, code: 'PAIRING_EXPIRED', error: 'This pairing code expired. Generate a fresh one on the Formlee agent page.' }
  }

  // Single-use enforcement is a conditional update: the first caller wins,
  // concurrent callers get the already-used answer.
  const claimed = await prisma.agentPairingTicket.updateMany({
    where: { id: ticket.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count !== 1) {
    return { ok: false, status: 409, code: 'PAIRING_ALREADY_USED', error: 'This pairing code was already used. Generate a fresh one on the Formlee agent page.' }
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.agentSession.create({
    data: { id: token, workspaceId: ticket.workspaceId, expiresAt },
  })

  return { ok: true, token, expiresAt }
}

/**
 * Single validation point for the agent-session header: shape, existence,
 * revocation and expiry. Both the agent endpoints (via resolveAgentSession)
 * and the explicitly scoped fill-credit boundary in billing/auth use this.
 */
export async function resolveAgentSessionFromHeaders(
  requestHeaders: Headers
): Promise<{ workspaceId: string; token: string } | null> {
  const token = readAgentSessionToken(requestHeaders)
  const session = await loadAgentSessionByToken(token)
  if (!session || !isAgentSessionUsable(session)) return null
  return { workspaceId: session.workspaceId, token: session.id }
}

export async function resolveAgentSession(request: Request): Promise<{ workspaceId: string; token: string } | null> {
  return resolveAgentSessionFromHeaders(request.headers)
}

interface LoadedAgentSession extends AgentSessionRowLike {
  workspaceId: string
}

async function loadAgentSessionByToken(token: string): Promise<LoadedAgentSession | null> {
  if (!isAgentTokenShape(token)) return null
  const row = await prisma.agentSession.findUnique({ where: { id: token } })
  if (!row) return null
  return { id: row.id, revokedAt: row.revokedAt, expiresAt: row.expiresAt, workspaceId: row.workspaceId }
}

/** Token-shape guard used by the /api/agent/session probe endpoint. */
export function isValidAgentTokenShape(token: unknown): boolean {
  return isAgentTokenShape(token) && token.length === TOKEN_HEX_LENGTH
}

export interface AgentPlanForPage {
  connected: boolean
  pairedAt: string | null
  expiresAt: string | null
  plan: Prisma.JsonValue | null
  planAt: string | null
}

export async function agentConnectionStateForWorkspace(workspaceId: string): Promise<AgentPlanForPage> {
  const session = await prisma.agentSession.findFirst({
    where: { workspaceId, planAt: { not: null } },
    orderBy: [{ planAt: 'desc' }, { createdAt: 'desc' }],
  })
  const active = await prisma.agentSession.findFirst({
    where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  return {
    connected: !!active,
    pairedAt: session?.createdAt.toISOString() ?? null,
    expiresAt: active?.expiresAt.toISOString() ?? null,
    plan: (session?.plan ?? null) as Prisma.JsonValue | null,
    planAt: session?.planAt ? session.planAt.toISOString() : null,
  }
}

export async function revokeAgentSessions(workspaceId: string): Promise<number> {
  const result = await prisma.agentSession.updateMany({
    where: { workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count
}

/** Revoke only the paired extension session used by an explicit Disconnect. */
export async function revokeAgentSession(token: string): Promise<boolean> {
  const result = await prisma.agentSession.updateMany({
    where: { id: token, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  })
  return result.count === 1
}

/* ---------------------------------------------------------------------------
 * Light in-process rate limiting for the pairing endpoint
 * ------------------------------------------------------------------------- */

interface RateBucket {
  count: number
  resetAt: number
}

const rateBuckets = new Map<string, RateBucket>()

export function rateLimitKey(clientKey: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(clientKey)
  if (rateBuckets.size > 500) {
    for (const [key, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(key)
    }
  }
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(clientKey, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0].trim() || 'local'
}
