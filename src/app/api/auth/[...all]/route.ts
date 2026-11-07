import { handleAuthRequest } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { revokeAgentSessions } from '@/lib/agent/session'

// Better Auth catch-all. Every core endpoint lives under /api/auth/*:
// sign-in, sign-up, get-session, sign-out, ... No other route is needed.
// Secrets stay server-side; the React client targets the same origin and
// authentication state travels only in the library-managed httpOnly cookie.
export const dynamic = 'force-dynamic'

export const GET = (request: Request) => handleAuthRequest(request)
export async function POST(request: Request) {
  const isSignOut = new URL(request.url).pathname.endsWith('/sign-out')
  let workspaceId: string | null = null
  if (isSignOut) {
    try {
      workspaceId = await requireWorkspaceId()
    } catch {
      // Sign-out must remain available even if the best-effort revocation lookup fails.
      console.warn('[Formlee] Workspace lookup failed during sign-out; extension tokens will expire normally.')
    }
  }

  const response = await handleAuthRequest(request)
  if (isSignOut && workspaceId) {
    try {
      await revokeAgentSessions(workspaceId)
    } catch {
      // Server-side token expiry remains the fallback if revocation storage is unavailable.
      console.warn('[Formlee] Agent-session revocation failed during sign-out; tokens will expire normally.')
    }
  }
  return response
}
