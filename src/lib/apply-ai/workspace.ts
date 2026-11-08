import { randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { getAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// Historical cookie name retained so existing anonymous workspaces keep
// resolving to their original data. It is never shown to students.
export const WORKSPACE_COOKIE = 'rankora_workspace'

/**
 * Formlee workspace ownership (Milestone 3).
 *
 * Two kinds of workspace coexist and are resolved ONLY in this module:
 *
 *  - anonymous: an httpOnly 64-hex token cookie identifies the workspace. Same
 *    behavior as Milestone 2 for everyone who has not registered or signed in.
 *  - owned: a `Workspace` registry row links the workspace id to a Better Auth
 *    user. Resolution then comes from the SESSION (auth + database), never
 *    from the cookie value alone.
 *
 * Security properties:
 *  - the token is never readable by JavaScript and never returned in API bodies
 *  - every request is authorized against the resolved id (object-level checks
 *    keep their 401/404 semantics downstream)
 *  - a CLAIMED workspace stops answering to its cookie: once linked to an
 *    account, access requires that account's session, so a stale cookie, a
 *    copied value, or another person at a shared computer gains nothing
 *  - claiming is explicit ("Save my work") and transactional: a workspace can
 *    never end up owned by two accounts, and it is never merged with another
 */
export function createWorkspaceToken(): string {
  return randomBytes(32).toString('hex')
}

export function readWorkspaceToken(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null
  // Hex-only sanity check; never trust arbitrary cookie bytes.
  return /^[0-9a-f]{64}$/.test(cookieValue) ? cookieValue : null
}

export const workspaceCookieOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // one year; workspace data stays until cookie expiry
}

// ---------------------------------------------------------------------------
// Ownership resolution (the single seam the API routes read)
// ---------------------------------------------------------------------------

export type WorkspaceMode =
  | 'anonymous' // signed out; valid workspace cookie that no account has claimed
  | 'owned' // signed in; workspace linked to the session user (authoritative)
  | 'empty' // signed out and nothing accessible (no cookie / claimed-by-anyone cookie)
  | 'signed-in-empty' // signed in but no workspace yet (a cookie workspace may be claimable)

export type WorkspaceContext =
  | { mode: 'anonymous'; workspaceId: string }
  | { mode: 'owned'; workspaceId: string }
  | { mode: 'empty' }
  | { mode: 'signed-in-empty'; claimable: boolean }

/**
 * Resolves who is calling and which workspace applies. Signed-in users always
 * resolve from their session + the registry (the cookie is ignored once a
 * workspace is owned). Anonymous users keep the exact Milestone 2 cookie
 * semantics until the workspace is claimed by some account.
 */
export async function resolveWorkspaceContext(): Promise<WorkspaceContext> {
  const [authHeaders, cookieStore] = await Promise.all([headers(), cookies()])
  const token = readWorkspaceToken(cookieStore.get(WORKSPACE_COOKIE)?.value)

  const session = await getAuth().api.getSession({ headers: authHeaders })

  if (session?.user) {
    const owned = await prisma.workspace.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (owned) return { mode: 'owned', workspaceId: owned.id }
    // Signed in without a workspace: the browser's cookie may hold an
    // unclaimed workspace that an explicit "Save my work" could claim.
    return { mode: 'signed-in-empty', claimable: !!token }
  }

  if (token) {
    // Anonymous possession. The cookie keeps its Milestone 2 power only while
    // no account has claimed this workspace; claimed ones closed the cookie.
    const registry = await prisma.workspace.findUnique({
      where: { id: token },
      select: { userId: true },
    })
    if (registry?.userId) return { mode: 'empty' }
    return { mode: 'anonymous', workspaceId: token }
  }

  return { mode: 'empty' }
}

/**
 * Guard-compatible resolver for the data routes: returns the workspace id the
 * caller may act on, or null when nothing is authorized (routes answer 401 —
 * identical to the Milestone 2 "no cookie" behavior, and still no existence
 * leak).
 */
export async function requireWorkspaceId(): Promise<string | null> {
  const context = await resolveWorkspaceContext()
  if (context.mode === 'anonymous' || context.mode === 'owned') return context.workspaceId
  return null
}

// ---------------------------------------------------------------------------
// Ensure (used by POST /api/apply/workspace)
// ---------------------------------------------------------------------------

export type WorkspaceStatus =
  | 'existing' // anonymous: cookie already held an unclaimed workspace
  | 'created' // a fresh workspace was minted (anonymous, or owned for a signed-in user)
  | 'owned' // signed in; everything already resolves to the account's workspace
  | 'claimable' // signed in, nothing owned, but the browser cookie holds an unclaimed workspace
  | 'unavailable' // signed out; the cookie's workspace is claimed and needs its owner's session

/** Creates a workspace row owned by the given user (fresh random 64-hex id). */
async function createUserWorkspace(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.workspace.create({
        data: { id: createWorkspaceToken(), userId, claimedAt: new Date() },
      })
      return
    } catch (error) {
      // Primary-key collision means a (theoretical) random-id clash: retry once.
      if (attempt === 1 || !prismaUniqueTarget(error)) throw error
    }
  }
}

/**
 * Idempotent "give me a workspace". Milestone 2 minting is preserved bit for
 * bit for signed-out visitors, except that a cookie pointing at a CLAIMED
 * workspace no longer mints a lookalike (access must go through its owner).
 * Signed-in users get an account-owned workspace — but when their browser
 * still holds an unclaimed anonymous workspace, nothing is minted: that
 * workspace stays claimable so the student can link their real data.
 */
export async function ensureWorkspace(): Promise<WorkspaceStatus> {
  const [authHeaders, cookieStore] = await Promise.all([headers(), cookies()])
  const token = readWorkspaceToken(cookieStore.get(WORKSPACE_COOKIE)?.value)

  const session = await getAuth().api.getSession({ headers: authHeaders })

  if (session?.user) {
    const owned = await prisma.workspace.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (owned) return 'owned'

    if (token) {
      const registry = await prisma.workspace.findUnique({
        where: { id: token },
        select: { userId: true },
      })
      // Unclaimed (or unregistered) cookie workspace → keep it claimable.
      if (!registry?.userId) return 'claimable'
      // The cookie's workspace belongs to a DIFFERENT account: this user's own
      // fresh workspace is minted instead (never merged, never touched).
      await createUserWorkspace(session.user.id)
      return 'created'
    }

    await createUserWorkspace(session.user.id)
    return 'created'
  }

  // Signed out — Milestone 2 behavior (registry-aware).
  if (token) {
    const registry = await prisma.workspace.findUnique({
      where: { id: token },
      select: { userId: true },
    })
    if (registry?.userId) return 'unavailable'
    return 'existing'
  }

  cookieStore.set(WORKSPACE_COOKIE, createWorkspaceToken(), workspaceCookieOptions)
  return 'created'
}

// ---------------------------------------------------------------------------
// Explicit claim ("Save my work" → POST /api/apply/claim-workspace)
// ---------------------------------------------------------------------------

export type ClaimWorkspaceResult =
  | { ok: true; workspaceId: string; changed: boolean }
  | { ok: false; status: number; code: string; error: string }

function prismaUniqueTarget(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target
    if (typeof target === 'string') return target
    if (Array.isArray(target)) return target.filter(t => typeof t === 'string').join(',')
  }
  return ''
}

/**
 * Claims the browser's anonymous workspace for the signed-in user, using the
 * existing workspace cookie as POSSESSION PROOF. Concurrency-safe:
 *
 *  - one workspace per account (@@unique userId); a second claim attempt gets
 *    409 ALREADY_HAVE_WORKSPACE — never an overwrite, never a merge
 *  - the first-time claim is a single conditional create; losing the race to
 *    another account surfaces as 409 with the database state re-read for an
 *    accurate message
 *  - a registry row that is still unclaimed is claimed via a conditional
 *    update (WHERE userId IS NULL), so two concurrent claimers cannot both win
 *  - an already-claimed workspace owned by ANOTHER account always rejects
 */
export async function claimWorkspaceFromCookie(): Promise<ClaimWorkspaceResult> {
  const [authHeaders, cookieStore] = await Promise.all([headers(), cookies()])
  const session = await getAuth().api.getSession({ headers: authHeaders })

  if (!session?.user) {
    return {
      ok: false,
      status: 401,
      code: 'SIGN_IN_REQUIRED',
      error: 'Sign in first, then save your work.',
    }
  }
  const userId = session.user.id

  const token = readWorkspaceToken(cookieStore.get(WORKSPACE_COOKIE)?.value)
  if (!token) {
    return {
      ok: false,
      status: 409,
      code: 'NOTHING_TO_CLAIM',
      error: 'Nothing to save from this browser yet. Start by filling in your profile or uploading documents.',
    }
  }

  try {
    return await prisma.$transaction(async tx => {
      const owned = await tx.workspace.findFirst({ where: { userId }, select: { id: true } })
      if (owned) {
        if (owned.id === token) {
          // Idempotent: this workspace is already this account's.
          return { ok: true, workspaceId: owned.id, changed: false }
        }
        return {
          ok: false,
          status: 409,
          code: 'ALREADY_HAVE_WORKSPACE',
          error: 'Your account already has a saved workspace. Signing in will always open that one; nothing was changed.',
        }
      }

      const existing = await tx.workspace.findUnique({
        where: { id: token },
        select: { userId: true },
      })
      if (existing?.userId) {
        return {
          ok: false,
          status: 409,
          code: 'CLAIMED_BY_OTHER_ACCOUNT',
          error: 'This workspace is already saved to a different account. Your own data is untouched.',
        }
      }

      if (existing) {
        // Conditional claim: the userId IS NULL guard means a concurrent claim
        // loses with a zero-count update instead of overwriting ownership.
        const updated = await tx.workspace.updateMany({
          where: { id: token, userId: null },
          data: { userId, claimedAt: new Date() },
        })
        if (updated.count !== 1) {
          return {
            ok: false,
            status: 409,
            code: 'CLAIM_CONFLICT',
            error: 'Another sign-in tried to claim this workspace at the same moment. Nothing was changed — try again.',
          }
        }
        return { ok: true, workspaceId: token, changed: true }
      }

      const created = await tx.workspace.create({
        data: { id: token, userId, claimedAt: new Date() },
      })
      return { ok: true, workspaceId: created.id, changed: true }
    })
  } catch (error) {
    const target = prismaUniqueTarget(error)
    if (target) {
      // Unique constraint fired (transaction rolled back): re-read the outcome.
      const row = await prisma.workspace.findUnique({
        where: { id: token },
        select: { userId: true },
      })
      if (row?.userId === userId) {
        return { ok: true, workspaceId: token, changed: false }
      }
      return {
        ok: false,
        status: 409,
        code: row?.userId ? 'CLAIMED_BY_OTHER_ACCOUNT' : target.includes('userId') ? 'ALREADY_HAVE_WORKSPACE' : 'CLAIM_CONFLICT',
        error: row?.userId
          ? 'This workspace is already saved to a different account. Your own data is untouched.'
          : target.includes('userId')
            ? 'Your account already has a saved workspace. Signing in will always open that one; nothing was changed.'
            : 'Another sign-in tried to claim this workspace at the same moment. Nothing was changed — try again.',
      }
    }
    throw error
  }
}
