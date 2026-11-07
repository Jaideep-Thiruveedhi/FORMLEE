/**
 * Agent session validity policy — dependency-free.
 *
 * The foreseeable ways an agent session must be rejected live here so the
 * rules can be unit-tested without a database or the Next.js runtime:
 * missing session, malformed token, revoked session, expired session.
 *
 * The database access itself stays in `agent/session.ts`; it uses these
 * predicates so the decision logic has exactly one definition.
 */

export const AGENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** Shape the Prisma AgentSession row is narrowed to for these checks. */
export interface AgentSessionRowLike {
  id: string
  revokedAt: Date | null
  expiresAt: Date
}

export function isAgentTokenShape(token: unknown): token is string {
  return typeof token === 'string' && AGENT_TOKEN_PATTERN.test(token)
}

export type AgentSessionState =
  | 'usable'
  | 'missing'
  | 'malformed'
  | 'revoked'
  | 'expired'

/**
 * Classifies an agent session row against a point in time. A session is
 * usable ONLY when it exists, has a well-formed token, has never been
 * revoked and has not reached its expiry.
 */
export function classifyAgentSession(
  session: AgentSessionRowLike | null,
  nowMs: number = Date.now()
): AgentSessionState {
  if (!session) return 'missing'
  if (!isAgentTokenShape(session.id)) return 'malformed'
  if (session.revokedAt) return 'revoked'
  if (!(session.expiresAt instanceof Date) || Number.isNaN(session.expiresAt.getTime())) {
    return 'expired'
  }
  return session.expiresAt.getTime() > nowMs ? 'usable' : 'expired'
}

export function isAgentSessionUsable(
  session: AgentSessionRowLike | null,
  nowMs: number = Date.now()
): boolean {
  return classifyAgentSession(session, nowMs) === 'usable'
}
