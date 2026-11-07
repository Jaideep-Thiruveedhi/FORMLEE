/**
 * Endpoint authorization matrix — dependency-free.
 *
 * Encodes, in one testable place, which API routes may accept a restricted
 * browser-agent session and which require a full Better Auth user session.
 *
 * The ONLY agent-capable routes are the fill-flow credit boundary: the
 * extension checks the balance, reserves one credit when the student approves
 * a fill, consumes it after at least one field is verified, and releases it
 * on failure. Every other billing, payment, partner, referral-admin and
 * account endpoint is user-session-only. Razorpay webhooks are outside this
 * matrix entirely — they use independent payment-provider signature
 * verification.
 */

export type AuthKind = 'user' | 'agent'

export type AuthRequirement = 'user-session-only' | 'fill-credit-boundary'

/**
 * Exactly the routes an agent session may call. Method matters: an agent
 * session gains no other verb on these paths.
 */
export const FILL_CREDIT_BOUNDARY_ROUTES = [
  'GET /api/billing/account',
  'POST /api/billing/reserve',
  'GET /api/billing/reserve/recover',
  'POST /api/billing/reserve/recover',
  'POST /api/billing/reserve/[id]/consume',
  'POST /api/billing/reserve/[id]/release',
] as const

export function isFillCreditBoundaryRoute(pathname: string, method: string): boolean {
  const key = `${method.toUpperCase()} ${pathname}`
  return (FILL_CREDIT_BOUNDARY_ROUTES as readonly string[]).includes(key)
}

export function routeAuthRequirement(pathname: string, method: string = 'GET'): AuthRequirement {
  return isFillCreditBoundaryRoute(pathname, method) ? 'fill-credit-boundary' : 'user-session-only'
}

/**
 * Whether a resolved auth context kind satisfies a route requirement.
 * A full user session satisfies everything; an agent session satisfies only
 * the fill credit boundary.
 */
export function satisfiesRequirement(requirement: AuthRequirement, kind: AuthKind): boolean {
  if (kind === 'user') return true
  return requirement === 'fill-credit-boundary'
}
