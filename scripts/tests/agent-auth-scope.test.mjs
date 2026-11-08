/**
 * Focused security tests — agent-session authorization scope.
 *
 * Three layers, no database and no Next.js runtime required:
 *   1. Pure agent-session validity policy (expired / revoked / malformed).
 *   2. Pure endpoint authorization matrix (which routes may accept an agent
 *      session; a user session satisfies everything, an agent session only
 *      the fill credit boundary).
 *   3. Source contracts: every sensitive route must resolve identity through
 *      the user-only helper, agent capability must appear ONLY in the four
 *      fill-boundary routes, and agent endpoints must keep using the agent
 *      session resolver.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  AGENT_SESSION_HEADER,
  classifyAgentSession,
  isAgentSessionUsable,
  isAgentTokenShape,
  readAgentSessionToken,
} from '../../src/lib/agent/agent-session-policy.ts'
import {
  FILL_CREDIT_BOUNDARY_ROUTES,
  routeAuthRequirement,
  satisfiesRequirement,
} from '../../src/lib/billing/auth-policy.ts'

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function functionSlice(source, functionName) {
  const start = source.indexOf(`export async function ${functionName}`)
  const fallbackStart = source.indexOf(`export function ${functionName}`)
  const at = start >= 0 ? start : fallbackStart
  assert.ok(at >= 0, `expected ${functionName} to be exported`)
  const end = source.indexOf('\nexport ', at + 1)
  return end === -1 ? source.slice(at) : source.slice(at, end)
}

test('Formlee agent-session header is canonical and accepts the historical extension header', () => {
  assert.equal(AGENT_SESSION_HEADER, 'x-formlee-agent-session')
  assert.equal(readAgentSessionToken(new Headers({
    'x-formlee-agent-session': 'current-token',
    'x-rankora-agent-session': 'legacy-token',
  })), 'current-token')
  assert.equal(readAgentSessionToken(new Headers({ 'x-rankora-agent-session': 'legacy-token' })), 'legacy-token')
  assert.equal(readAgentSessionToken(new Headers()), '')
})

/* --------------------------------------------------------------------------- */
/* 1. Agent session validity                                                    */
/* --------------------------------------------------------------------------- */

const NOW = 1_700_000_000_000
const TOKEN = 'a'.repeat(64)

function sessionRow(overrides = {}) {
  return {
    id: TOKEN,
    revokedAt: null,
    expiresAt: new Date(NOW + 60_000),
    ...overrides,
  }
}

test('well-formed, unrevoked, unexpired sessions are usable', () => {
  assert.equal(isAgentSessionUsable(sessionRow(), NOW), true)
  assert.equal(classifyAgentSession(sessionRow(), NOW), 'usable')
})

test('missing sessions are rejected', () => {
  assert.equal(isAgentSessionUsable(null, NOW), false)
  assert.equal(classifyAgentSession(null, NOW), 'missing')
})

test('expired sessions are rejected', () => {
  assert.equal(isAgentSessionUsable(sessionRow({ expiresAt: new Date(NOW) }), NOW), false)
  assert.equal(classifyAgentSession(sessionRow({ expiresAt: new Date(NOW - 1) }), NOW), 'expired')
})

test('revoked sessions are rejected even before expiry', () => {
  const row = sessionRow({ revokedAt: new Date(NOW - 5_000) })
  assert.equal(isAgentSessionUsable(row, NOW), false)
  assert.equal(classifyAgentSession(row, NOW), 'revoked')
})

test('malformed token shapes are rejected', () => {
  assert.equal(isAgentTokenShape('abc'), false)
  assert.equal(isAgentTokenShape(`${'g'.repeat(64)}`), false)
  assert.equal(isAgentTokenShape(`${TOKEN}extra`), false)
  assert.equal(isAgentTokenShape(42), false)
  assert.equal(
    classifyAgentSession(sessionRow({ id: 'short' }), NOW),
    'malformed'
  )
})

/* --------------------------------------------------------------------------- */
/* 2. Endpoint authorization matrix                                             */
/* --------------------------------------------------------------------------- */

test('only explicit fill-credit and reservation-recovery routes are agent-capable', () => {
  assert.deepEqual([...FILL_CREDIT_BOUNDARY_ROUTES], [
    'GET /api/billing/account',
    'POST /api/billing/reserve',
    'GET /api/billing/reserve/recover',
    'POST /api/billing/reserve/recover',
    'POST /api/billing/reserve/[id]/consume',
    'POST /api/billing/reserve/[id]/release',
  ])
})

test('credit purchases, payments and refunds require a user session', () => {
  assert.equal(routeAuthRequirement('/api/billing/orders', 'POST'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/billing/orders', 'GET'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/billing/verify', 'POST'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/billing/orders/[id]/refund', 'POST'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/billing/transactions', 'GET'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/partner/claim', 'POST'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/admin/referrals/commissions', 'GET'), 'user-session-only')
})

test('an agent session cannot open an unrelated billing verb or path', () => {
  // Method matters: even on boundary paths, other verbs stay user-only.
  assert.equal(routeAuthRequirement('/api/billing/account', 'DELETE'), 'user-session-only')
  assert.equal(routeAuthRequirement('/api/billing/reserve', 'GET'), 'user-session-only')
  assert.equal(satisfiesRequirement('user-session-only', 'agent'), false)
})

test('agent sessions satisfy only the fill credit boundary', () => {
  for (const route of FILL_CREDIT_BOUNDARY_ROUTES) {
    const [method, pathname] = route.split(' ')
    assert.equal(routeAuthRequirement(pathname, method), 'fill-credit-boundary')
    assert.equal(satisfiesRequirement('fill-credit-boundary', 'agent'), true)
  }
})

test('a full user session satisfies every requirement', () => {
  assert.equal(satisfiesRequirement('user-session-only', 'user'), true)
  assert.equal(satisfiesRequirement('fill-credit-boundary', 'user'), true)
})

/* --------------------------------------------------------------------------- */
/* 3. Source contracts — shared authentication helpers                          */
/* --------------------------------------------------------------------------- */

test('requireUserId is a Better-Auth-only helper with no agent fallback', () => {
  const source = readSource('../../src/lib/billing/auth.ts')
  assert.ok(!source.includes('requireAuthContext'), 'the old agent-fallback context must be gone')

  const userOnly = functionSlice(source, 'requireUserId')
  assert.ok(userOnly.includes('getAuth().api.getSession'), 'requireUserId must use the Better Auth session')
  assert.ok(
    !userOnly.includes('resolveAgentSession') &&
      !userOnly.includes('agentSession') &&
      !userOnly.includes('AGENT_SESSION_HEADER'),
    'requireUserId must not contain any agent-session fallback'
  )

  // The agent fallback is allowed in exactly one place: the fill boundary.
  const fillAuth = functionSlice(source, 'requireFillCreditAuth')
  assert.ok(fillAuth.includes('resolveAgentSessionFromHeaders'))
  assert.equal(
    (source.match(/resolveAgentSessionFromHeaders/g) || []).length,
    2,
    'agent-session resolution must appear only as import + fill-boundary call'
  )
})

test('referral auth helpers derive identity only from requireUserId', () => {
  const source = readSource('../../src/lib/referrals/auth.ts')
  assert.ok(source.includes("import { requireUserId } from '@/lib/billing/auth'"))
  assert.ok(!source.includes('requireFillCreditAuth'))
  // requireAdmin and requirePartner must build on the user-only primitive.
  assert.ok(functionSlice(source, 'requireAdmin').includes('requireUserId()'))
  assert.ok(functionSlice(source, 'requirePartner').includes('requireUserId()'))
})

/* --------------------------------------------------------------------------- */
/* 3b. Source contracts — sensitive routes stay user-only                       */
/* --------------------------------------------------------------------------- */

const USER_ONLY_ROUTES = [
  'src/app/api/billing/verify/route.ts',
  'src/app/api/billing/orders/route.ts',
  'src/app/api/billing/orders/[id]/refund/route.ts',
  'src/app/api/billing/transactions/route.ts',
  'src/app/api/partner/claim/route.ts',
]

test('purchases, verification, refunds and partner claims never accept agent sessions', () => {
  for (const path of USER_ONLY_ROUTES) {
    const source = readSource(`../../${path}`)
    assert.ok(!source.includes('requireFillCreditAuth'), `${path} must not accept agent sessions`)
    assert.ok(!source.includes('resolveAgentSession'), `${path} must not resolve agent sessions`)
    assert.ok(
      source.includes("requireUserId } from '@/lib/billing/auth'") ||
        source.includes("requireUserId'"),
      `${path} must authenticate through the user-only helper`
    )
  }
})

test('partner management and admin referral routes stay user-only', () => {
  const paths = [
    'src/app/api/partner/dashboard/route.ts',
    'src/app/api/partner/commissions/route.ts',
    'src/app/api/partner/payouts/route.ts',
    'src/app/api/admin/referrals/commissions/route.ts',
    'src/app/api/admin/referrals/partners/route.ts',
    'src/app/api/admin/referrals/payouts/route.ts',
  ]
  for (const path of paths) {
    const source = readSource(`../../${path}`)
    assert.ok(!source.includes('requireFillCreditAuth'), `${path} must not accept agent sessions`)
    assert.ok(!source.includes("from '@/lib/billing/auth'"), `${path} must not use billing auth`)
    assert.ok(
      source.includes("requireAdmin } from '@/lib/referrals/auth'") ||
        source.includes("requirePartner } from '@/lib/referrals/auth'"),
      `${path} must authenticate through user-only referral helpers`
    )
  }
})

test('Razorpay webhook keeps independent signature verification', () => {
  const source = readSource('../../src/app/api/webhooks/razorpay/route.ts')
  assert.ok(!source.includes('requireUserId'))
  assert.ok(!source.includes('AGENT_SESSION_HEADER'))
  assert.ok(source.includes('verifyWebhookSignature'))
  assert.ok(source.includes("request.headers.get('x-razorpay-signature')"))
})

/* --------------------------------------------------------------------------- */
/* 3c. Source contracts — agent-capable routes                                  */
/* --------------------------------------------------------------------------- */

const FILL_BOUNDARY_ROUTES = [
  'src/app/api/billing/account/route.ts',
  'src/app/api/billing/reserve/route.ts',
  'src/app/api/billing/reserve/recover/route.ts',
  'src/app/api/billing/reserve/[id]/consume/route.ts',
  'src/app/api/billing/reserve/[id]/release/route.ts',
]

test('exactly the fill boundary routes declare agent capability', () => {
  for (const path of FILL_BOUNDARY_ROUTES) {
    const source = readSource(`../../${path}`)
    assert.ok(
      source.includes("requireFillCreditAuth } from '@/lib/billing/auth'"),
      `${path} must declare the fill-credit boundary`
    )
  }
})

test('agent consumption and release are workspace-bound', () => {
  const consume = readSource('../../src/app/api/billing/reserve/[id]/consume/route.ts')
  assert.ok(consume.includes('consumeVerifiedAgentCredit'))
  assert.ok(consume.includes('workspaceId: auth.workspaceId'))
  assert.ok(consume.includes('agentSessionId: auth.agentToken'))
  const release = readSource('../../src/app/api/billing/reserve/[id]/release/route.ts')
  assert.ok(release.includes("if (auth.kind === 'agent')"))
  assert.ok(release.includes('workspaceId,'))
  const credits = readSource('../../src/lib/billing/credits.ts')
  assert.ok(
    credits.includes('workspaceId: workspaceId ?? undefined'),
    'consumeCredit and releaseCredit must apply the workspace filter'
  )
})

test('agent data endpoints keep resolving agent sessions directly', () => {
  const paths = [
    'src/app/api/agent/map/route.ts',
    'src/app/api/agent/values/route.ts',
    'src/app/api/agent/readiness/route.ts',
    'src/app/api/agent/profile-status/route.ts',
    'src/app/api/agent/session/route.ts',
  ]
  for (const path of paths) {
    const source = readSource(`../../${path}`)
    assert.ok(
      source.includes('resolveAgentSession') && source.includes("from '@/lib/agent/session'"),
      `${path} must use the agent session resolver`
    )
    assert.ok(!source.includes("from '@/lib/billing/auth'"), `${path} must not use billing auth`)
  }
})

test('agent sessions are validated for revocation and expiry in one place', () => {
  const source = readSource('../../src/lib/agent/session.ts')
  assert.ok(
    source.includes('return session && !isAgentSessionUsable(session)') ||
      source.includes('if (!session || !isAgentSessionUsable(session)) return null'),
    'header resolution must apply the usability policy'
  )
  assert.ok(source.includes('isAgentTokenShape(token)'))
  assert.ok(source.includes('prisma.agentSession.findUnique'))
})
