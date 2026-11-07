import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const schema = read('prisma/schema.prisma')
const credits = read('src/lib/billing/credits.ts')
const approval = read('src/lib/agent/approval.ts')
const consumeRoute = read('src/app/api/billing/reserve/[id]/consume/route.ts')
const recoveryRoute = read('src/app/api/billing/reserve/recover/route.ts')
const approvalVerifyRoute = read('src/app/api/agent/approvals/verify/route.ts')
const background = read('extensions/rankora-apply-agent/background.js')
const extensionCredits = read('extensions/rankora-apply-agent/credits.js')
const migration = read('prisma/migrations/20261103000006_credit_wallet_integrity/migration.sql')

test('reservation identity and idempotency are separate Prisma fields', () => {
  const reservation = schema.slice(schema.indexOf('model CreditReservation {'), schema.indexOf('model PaymentOrder {'))
  assert.match(reservation, /legacyAgentSessionOrIdempotencyKey\s+String\?\s+@unique/)
  assert.match(reservation, /agentSessionId\s+String\?/)
  assert.doesNotMatch(reservation, /agentSessionId\s+String\?\s+@unique/)
  assert.match(reservation, /idempotencyKey\s+String\?\s+@unique/)
  assert.match(reservation, /@@index\(\[agentSessionId\]\)/)
})

test('migration preserves the ambiguous historical column and inspects its actual unique index name', () => {
  const initialCredits = read('prisma/migrations/20261103000001_add_credits/migration.sql')
  assert.match(initialCredits, /CREATE UNIQUE INDEX "credit_reservation_agentSessionId_key"/)
  assert.match(migration, /RENAME COLUMN "agentSessionId" TO "legacyAgentSessionOrIdempotencyKey"/)
  assert.match(migration, /ALTER INDEX "credit_reservation_agentSessionId_key"\s+RENAME TO "credit_reservation_legacyAgentSessionOrIdempotencyKey_key"/)
  assert.match(migration, /ADD COLUMN "agentSessionId" TEXT/)
  assert.match(migration, /ADD COLUMN "idempotencyKey" TEXT/)
  assert.match(migration, /CREATE UNIQUE INDEX "credit_reservation_idempotencyKey_key"/)
  assert.match(migration, /CREATE INDEX "credit_reservation_agentSessionId_idx"/)
  assert.doesNotMatch(migration, /\b(UPDATE|DELETE|DROP)\b/i)
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/)
})

test('new reservations deduplicate by scoped key and bind the caller’s actual session identity', () => {
  assert.match(credits, /where: \{ idempotencyKey, workspaceId, account: \{ userId \} \}/)
  assert.match(credits, /reservation\.agentSessionId !== agentSessionId/)
  assert.match(credits, /agentSessionId,\s+idempotencyKey,/)
  assert.match(credits, /LEGACY_RESERVATION_REQUIRES_RECOVERY/)
  assert.match(credits, /if \(code === 'P2002'\)[\s\S]*findExisting\(\)/)
})

test('legacy approval-key reservations recover only through an exactly matching session-bound approval', () => {
  assert.match(credits, /legacyAgentSessionOrIdempotencyKey: \{ in: possibleLegacyKeys \}/)
  assert.match(credits, /legacyPending\.legacyAgentSessionOrIdempotencyKey === idempotencyKey/)
  assert.match(credits, /where: \{ id: idempotencyKey, workspaceId, userId, agentSessionId \}/)
  assert.match(credits, /legacyAgentSessionOrIdempotencyKey: input\.approvalRef, agentSessionId: null/)
  assert.match(approval, /legacyAgentSessionOrIdempotencyKey: approval\.id, agentSessionId: null/)
  assert.match(approval, /agentSessionId: input\.agentSessionId/)
  assert.match(approvalVerifyRoute, /legacyAgentSessionOrIdempotencyKey: approvalRef, agentSessionId: null/)
  assert.match(credits, /LEGACY_RESERVATION_REQUIRES_RECONCILIATION/)
})

test('legacy values without a matching scoped approval cannot be automatically refunded', () => {
  assert.match(credits, /reservation\.legacyAgentSessionOrIdempotencyKey && !linkedApproval[\s\S]*LEGACY_RESERVATION_REQUIRES_RECONCILIATION/)
  assert.match(credits, /linkedApproval\?\.status === 'FILL_VERIFIED' \|\| linkedApproval\?\.status === 'CREDIT_CONSUMED'/)
  assert.match(recoveryRoute, /auth\.kind === 'agent' \? auth\.agentToken : undefined/)
  assert.match(recoveryRoute, /LEGACY_RESERVATION_REQUIRES_RECONCILIATION/)
})

test('reservation creation independently checks workspace ownership and hides global key collisions', () => {
  assert.match(credits, /tx\.workspace\.findFirst\([\s\S]*where: \{ id: workspaceId, userId \}/)
  assert.match(credits, /where: \{ idempotencyKey, workspaceId, account: \{ userId \} \}/)
  assert.match(credits, /throw new Error\('IDEMPOTENCY_KEY_CONFLICT'\)/)
})

test('user reservations store null session identity while agent reservations use the authenticated token', () => {
  const reserveRoute = read('src/app/api/billing/reserve/route.ts')
  assert.match(reserveRoute, /agentSessionId: auth\.kind === 'agent' \? auth\.agentToken : null/)
  assert.match(reserveRoute, /A live approval from this AgentSession is required/)
})

test('approval lifecycle uses conditional APPROVED to FILL_REQUESTED transitions', () => {
  assert.match(approval, /status: 'APPROVED'/)
  assert.match(approval, /status: 'FILL_REQUESTED'/)
  assert.match(approval, /\? 'FILL_VERIFIED'/)
  assert.match(credits, /status: 'CREDIT_CONSUMED'/)
  assert.match(approval, /status: verifiedCount > 0 \? 'FILL_VERIFIED' : 'RELEASED'/)
  assert.match(approval, /status: 'REJECTED'/)
  assert.match(approval, /updateMany\([\s\S]*status: 'APPROVED'[\s\S]*data: \{ status: 'FILL_REQUESTED' \}/)
  assert.match(approval, /expiresAt: \{ gt: now \}/)
  assert.match(approval, /revokedAt: null/)
})

test('readback receipts bind approved identifiers, values, adapter, URL and page fingerprint', () => {
  assert.match(approval, /createHash\('sha256'\)/)
  assert.match(approval, /receipt\.adapterId !== approval\.adapterId/)
  assert.match(approval, /receipt\.pageUrl !== approval\.pageUrl/)
  assert.match(approval, /receipt\.pageFingerprint !== approval\.pageFingerprint/)
  assert.match(approval, /expectedPairs/)
  assert.match(approval, /item\.valueHash !== byCanonical\.get\(item\.canonical\)/)
  assert.match(approval, /verificationReceipt: receipt/)
})

test('changed or empty readback cannot produce a consumable receipt and marks release state', () => {
  assert.match(approval, /const mismatch = input\.results\.some/)
  assert.match(approval, /outcome: mismatch \? 'MISMATCH' : verifiedCount > 0 \? 'VERIFIED' : 'NO_FIELDS'/)
  assert.match(approval, /status: verifiedCount > 0 \? 'FILL_VERIFIED' : 'RELEASED'/)
  assert.match(approval, /releaseRequired: verifiedCount === 0/)
})

test('consume endpoint requires authenticated session, reservation id, approval reference and page fingerprint', () => {
  assert.match(consumeRoute, /requireFillCreditAuth\(\)/)
  assert.match(consumeRoute, /typeof body\.approvalRef !== 'string'/)
  assert.match(consumeRoute, /typeof body\.pageFingerprint !== 'string'/)
  assert.match(consumeRoute, /consumeVerifiedAgentCredit\(/)
  assert.match(consumeRoute, /agentSessionId: auth\.agentToken/)
  assert.match(consumeRoute, /workspaceId: auth\.workspaceId/)
  assert.doesNotMatch(consumeRoute, /consumeCredit\([\s\S]*workspaceId: auth\.kind === 'agent'/)
})

test('agent consume revalidates receipt and claims reservation and approval atomically', () => {
  assert.match(credits, /validateStoredVerificationReceipt\(approval\)/)
  assert.match(credits, /approval\.status !== 'FILL_VERIFIED'/)
  assert.match(credits, /status: 'CREDIT_CONSUMED'/)
  assert.match(credits, /status: 'CONSUMED'/)
  assert.match(credits, /if \(reservation\.agentSessionId\) throw new Error\('AGENT_APPROVAL_REQUIRED'\)/)
  assert.match(credits, /APPROVAL_VERIFIED_CANNOT_RELEASE/)
})

test('same-session recovery can look up its live approval; another session can only explicitly release', () => {
  assert.match(recoveryRoute, /action: z\.literal\('lookup'\)/)
  assert.match(recoveryRoute, /agentSessionId: auth\.agentToken/)
  assert.match(recoveryRoute, /status: 'FILL_REQUESTED'/)
  assert.match(recoveryRoute, /action: z\.literal\('release'\)/)
  assert.match(recoveryRoute, /releaseCredit\(/)
  assert.doesNotMatch(recoveryRoute, /consumeVerifiedAgentCredit/)
})

test('expired verification approvals transition to rejected and release only their pending reservation', () => {
  const expiryPath = approvalVerifyRoute.slice(approvalVerifyRoute.indexOf('if (approval && approval.expiresAt'))
  assert.match(approvalVerifyRoute, /import \{ verifyApproval, hashSingleValue, rejectExpiredApproval \}/)
  assert.match(expiryPath, /rejectExpiredApproval\(/)
  assert.match(expiryPath, /releaseCredit\(/)
  assert.match(expiryPath, /status: 'PENDING'/)
  assert.match(expiryPath, /agentSessionId: session\.token/)
  assert.match(expiryPath, /code: 'APPROVAL_EXPIRED'/)
  assert.doesNotMatch(approvalVerifyRoute.slice(approvalVerifyRoute.indexOf('const approval ='), approvalVerifyRoute.indexOf('if (approval && approval.expiresAt')), /expiresAt: \{ gt:/)
})

test('extension persists reservation before browser writes and retains pending state until server confirmation', () => {
  const trackAt = background.indexOf('const storedReservation = await Credits.trackReservation')
  const writeAt = background.indexOf("type: 'RANKORA_FILL'", trackAt)
  assert.ok(trackAt >= 0 && writeAt > trackAt)
  assert.match(extensionCredits, /await storeReservation\(reservationId, approvalRef, 'pending'\)/)
  assert.match(extensionCredits, /if \(res\.ok\)[\s\S]*writePending\(pending\.filter/)
  assert.doesNotMatch(extensionCredits, /items\.slice\(-20\)/)
  assert.match(extensionCredits, /listRecoverableReservations/)
  assert.match(extensionCredits, /releaseRecoveredReservation/)
})

test('wallet packages and free scan policy remain unchanged', () => {
  assert.match(credits, /credits: 1, amountPaise: 5000/)
  assert.match(credits, /credits: 3, amountPaise: 10000/)
  assert.match(credits, /credits: 10, amountPaise: 25000/)
  assert.match(extensionCredits, /Scanning, mapping preview and editing mappings remain free/)
})

test('extension finalization retries reuse the approval reference without replaying DOM writes', async () => {
  const memory = { agentToken: 'a'.repeat(64) }
  const requests = []
  let status = 503
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get(keys, callback) { callback(Object.fromEntries(keys.map(key => [key, memory[key]]))) },
        set(values, callback) { Object.assign(memory, values); callback() },
      },
    },
  }
  const testModule = { exports: {} }
  runInNewContext(extensionCredits + '\nmodule.exports = Credits', {
    module: testModule,
    chrome,
    FormleeConfig: { getBaseUrl: async () => 'https://formlee.example' },
    fetch: async (url, options) => {
      requests.push({ url, options })
      return { ok: status >= 200 && status < 300, status, json: async () => ({}) }
    },
  })
  const client = testModule.exports
  assert.equal((await client.trackReservation('r1', 'b'.repeat(64))).ok, true)
  assert.equal(memory.pendingCreditFinalizations[0].action, 'pending')
  const failed = await client.confirmConsumption({ reservationId: 'r1', approvalRef: 'b'.repeat(64), pageFingerprint: 'fp' })
  assert.equal(failed.pending, true)
  assert.equal(memory.pendingCreditFinalizations[0].action, 'consume')
  status = 200
  const flushed = await client.flushPendingOperations()
  assert.equal(flushed.pending, 0)
  const body = JSON.parse(requests.at(-1).options.body)
  assert.deepEqual(body, { approvalRef: 'b'.repeat(64), pageFingerprint: 'fp' })
  assert.equal(memory.pendingCreditFinalizations.length, 0)
  assert.equal(requests.some(item => item.url.includes('RANKORA_FILL')), false)
})
