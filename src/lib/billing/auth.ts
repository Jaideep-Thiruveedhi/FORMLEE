import { headers } from 'next/headers'
import { getAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveAgentSessionFromHeaders } from '@/lib/agent/session'

/**
 * Authentication split (security fix).
 *
 *   - requireUserId          — NORMAL USER authentication: Better Auth session
 *     only. Billing purchases, payment verification, refunds, ledger history,
 *     partner claims, partner management and admin endpoints use this. It
 *     NEVER falls back to the extension agent session.
 *
 *   - requireFillCreditAuth  — RESTRICTED BROWSER-AGENT authentication for the
 *     fill-flow credit boundary endpoints ONLY (GET /api/billing/account,
 *     POST /api/billing/reserve, .../consume, .../release, and explicit
 *     reservation recovery). An agent session
 *     is scoped to the workspace's own credit account; it must never be
 *     reused as general user authentication anywhere else.
 *
 * The authorization matrix is defined in ./auth-policy.
 */

export type FillCreditContext =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; userId: string; workspaceId: string; agentToken: string }

/** Normal user authentication: valid Better Auth session, nothing else. */
export async function requireUserId(): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

/**
 * Authorization for the fill-flow credit boundary exclusively.
 *
 *   user  — full authority over their own credit account (same as before).
 *   agent — the caller presented a valid, non-expired, non-revoked
 *           AgentSession; access is limited to that session's workspace and
 *           the credit account of the workspace owner. The userId returned
 *           here must not leak into any other endpoint: other APIs resolve
 *           identity through requireUserId, which ignores agent tokens.
 */
export async function requireFillCreditAuth(): Promise<FillCreditContext | null> {
  const authHeaders = await headers()

  // Prefer the signed-in Better Auth session.
  const session = await getAuth().api.getSession({ headers: authHeaders })
  if (session?.user?.id) {
    return { kind: 'user', userId: session.user.id }
  }

  // Restricted fallback: an explicitly valid agent session, scoped to its own
  // workspace. The extension's httpOnly workspace cookie never reaches here,
  // and this context must not be treated as the signed-in user's identity.
  const agentSession = await resolveAgentSessionFromHeaders(authHeaders)
  if (!agentSession) {
    return null
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: agentSession.workspaceId },
    select: { userId: true },
  })
  if (!workspace?.userId) {
    return null
  }
  return {
    kind: 'agent',
    userId: workspace.userId,
    workspaceId: agentSession.workspaceId,
    agentToken: agentSession.token,
  }
}
