/**
 * Agent Tool Approval service.
 *
 * Durable server-side approvals for browser fills. Created only after explicit
 * student action, bound to workspace + agent session + page fingerprint, and
 * invalidated by page/mapping changes, expiry, or revocation.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type ApprovalStatus =
  | 'APPROVED'
  | 'FILL_REQUESTED'
  | 'FILL_VERIFIED'
  | 'CREDIT_CONSUMED'
  | 'RELEASED'
  | 'REJECTED'
  | 'REVOKED'
  | 'EXPIRED'

export interface ProposedMappingItem {
  index: number
  canonical: string
  label: string
}

export interface ValueFingerprintItem {
  canonical: string
  hash: string
}

export interface CreateApprovalInput {
  workspaceId: string
  userId: string
  agentSessionId: string
  adapterId: string
  pageUrl: string
  pageFingerprint: string
  origin: string
  tabRef?: string
  proposedMapping: ProposedMappingItem[]
  approvedFieldIds: string[]
  valueFingerprint: ValueFingerprintItem[]
  expiresInMinutes?: number
}

export interface ApprovalVerificationInput {
  approvalRef: string
  workspaceId: string
  agentSessionId: string
  adapterId: string
  pageUrl: string
  pageFingerprint: string
  approved: { index: number; canonical: string }[]
  valueFingerprint?: ValueFingerprintItem[]
}

export interface FillVerificationReport {
  approvalRef: string
  workspaceId: string
  userId: string
  agentSessionId: string
  adapterId: string
  pageUrl: string
  pageFingerprint: string
  results: { index: number; canonical: string; status: string; valueHash?: string }[]
}

export interface StoredVerificationReceipt {
  version: 1
  adapterId: string
  pageUrl: string
  pageFingerprint: string
  outcome: 'VERIFIED' | 'NO_FIELDS' | 'MISMATCH'
  verifiedCount: number
  results: { index: number; canonical: string; status: string; valueHash?: string }[]
  verifiedAt: string
}

export interface ApprovalVerificationResult {
  ok: boolean
  approval?: {
    id: string
    workspaceId: string
    userId: string
    agentSessionId: string
    adapterId: string
    pageUrl: string
    pageFingerprint: string
    approvedFieldIds: string[]
  }
  error?: string
  code?: string
}

const DEFAULT_APPROVAL_TTL_MINUTES = 10
const MAX_APPROVAL_TTL_MINUTES = 60

function approvalRef(): string {
  // Cuid is used for the id; the student-facing ref is a separate unguessable
  // token displayed briefly and hashed when stored in external contexts.
  return randomBytes(32).toString('hex')
}

export function hashValueFingerprint(items: ValueFingerprintItem[]): Prisma.InputJsonValue {
  const sorted = [...items].sort((a, b) => a.canonical.localeCompare(b.canonical))
  return {
    algorithm: 'sha256-canonical-sort',
    items: sorted.map(item => ({ canonical: item.canonical, hash: item.hash })),
    hash: createHash('sha256')
      .update(sorted.map(i => `${i.canonical}:${i.hash}`).join('|'))
      .digest('hex'),
  } as unknown as Prisma.InputJsonValue
}

/**
 * Per-value fingerprint used by both the extension and the server. It must be
 * deterministic and fast; it is not a secret (the combined fingerprint is
 * stored and compared, not the raw value).
 */
export function hashSingleValue(value: unknown): string {
  const text = String(value == null ? '' : value)
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function createApproval(input: CreateApprovalInput): Promise<{ ok: true; approvalRef: string } | { ok: false; error: string }> {
  const selectedByIndex = new Map<number, string>()
  for (const item of input.proposedMapping) {
    if (!Number.isInteger(item.index) || item.index < 0 || selectedByIndex.has(item.index)) {
      return { ok: false, error: 'Proposed mappings must use unique non-negative field indexes.' }
    }
    selectedByIndex.set(item.index, item.canonical)
  }
  const selectedCanonicals = [...new Set(selectedByIndex.values())].sort()
  const approvedCanonicals = [...new Set(input.approvedFieldIds)].sort()
  if (JSON.stringify(selectedCanonicals) !== JSON.stringify(approvedCanonicals)) {
    return { ok: false, error: 'Approved fields must match the reviewed proposed mappings.' }
  }
  const fingerprintCanonicals = [...new Set(input.valueFingerprint.map(item => item.canonical))].sort()
  if (JSON.stringify(selectedCanonicals) !== JSON.stringify(fingerprintCanonicals)) {
    return { ok: false, error: 'Value fingerprints must match the reviewed proposed mappings.' }
  }

  const ttl = Math.min(
    input.expiresInMinutes ?? DEFAULT_APPROVAL_TTL_MINUTES,
    MAX_APPROVAL_TTL_MINUTES
  )
  const ref = approvalRef()
  await prisma.agentToolApproval.create({
    data: {
      id: ref,
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentSessionId: input.agentSessionId,
      adapterId: input.adapterId,
      pageUrl: input.pageUrl,
      pageFingerprint: input.pageFingerprint,
      origin: input.origin,
      tabRef: input.tabRef ?? null,
      proposedMapping: input.proposedMapping as unknown as Prisma.InputJsonValue,
      approvedFieldIds: [...new Set(input.approvedFieldIds)],
      valueFingerprint: hashValueFingerprint(input.valueFingerprint),
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + ttl * 60 * 1000),
    },
  })
  return { ok: true, approvalRef: ref }
}

export async function findApprovalByRef(ref: string) {
  return prisma.agentToolApproval.findUnique({ where: { id: ref } })
}

export async function revokeApproval(ref: string, workspaceId: string): Promise<boolean> {
  const result = await prisma.agentToolApproval.updateMany({
    where: { id: ref, workspaceId, status: { in: ['APPROVED', 'FILL_REQUESTED'] } },
    data: { status: 'REVOKED', revokedAt: new Date() },
  })
  return result.count > 0
}

/**
 * A failed insufficient-credit check has not authorized a browser write. Keep
 * the student's still-valid approval retryable after they add credits.
 */
export async function restoreApprovalAfterInsufficientCredits(input: {
  approvalRef: string
  workspaceId: string
  agentSessionId: string
}): Promise<boolean> {
  const result = await prisma.agentToolApproval.updateMany({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      agentSessionId: input.agentSessionId,
      status: 'FILL_REQUESTED',
      expiresAt: { gt: new Date() },
    },
    data: { status: 'APPROVED', usedAt: null },
  })
  return result.count > 0
}

export async function markApprovalFillRequested(input: {
  approvalRef: string
  workspaceId: string
  userId: string
  agentSessionId: string
}): Promise<boolean> {
  const now = new Date()
  const changed = await prisma.agentToolApproval.updateMany({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentSessionId: input.agentSessionId,
      status: 'APPROVED',
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { status: 'FILL_REQUESTED' },
  })
  if (changed.count === 1) return true
  const existing = await prisma.agentToolApproval.findFirst({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentSessionId: input.agentSessionId,
      status: 'FILL_REQUESTED',
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  })
  return !!existing
}

export async function rejectApproval(input: {
  approvalRef: string
  workspaceId: string
  agentSessionId: string
  status: 'REJECTED' | 'EXPIRED'
}): Promise<void> {
  await prisma.agentToolApproval.updateMany({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      agentSessionId: input.agentSessionId,
      status: { in: ['APPROVED', 'FILL_REQUESTED'] },
    },
    data: { status: input.status },
  })
}

/**
 * Transition an expired approval to REJECTED using a conditional update.
 * Repeated expiry handling is idempotent: already-terminal approvals are left
 * untouched and reported as already handled. This function intentionally does
 * NOT release reservations; the caller owns that wallet boundary so the
 * approval service never depends on the billing module.
 */
export async function rejectExpiredApproval(input: {
  approvalRef: string
  workspaceId: string
  agentSessionId: string
}): Promise<'REJECTED' | 'ALREADY_HANDLED' | 'NOT_FOUND' | 'NOT_EXPIRED'> {
  const approval = await prisma.agentToolApproval.findFirst({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      agentSessionId: input.agentSessionId,
    },
    select: { id: true, status: true, expiresAt: true },
  })
  if (!approval) return 'NOT_FOUND'
  if (['REJECTED', 'EXPIRED', 'REVOKED', 'RELEASED', 'CREDIT_CONSUMED', 'FILL_VERIFIED'].includes(approval.status)) {
    return 'ALREADY_HANDLED'
  }
  if (approval.expiresAt.getTime() > Date.now()) return 'NOT_EXPIRED'

  const changed = await prisma.agentToolApproval.updateMany({
    where: {
      id: input.approvalRef,
      workspaceId: input.workspaceId,
      agentSessionId: input.agentSessionId,
      status: { in: ['APPROVED', 'FILL_REQUESTED'] },
      expiresAt: { lte: new Date() },
    },
    data: { status: 'REJECTED' },
  })
  if (changed.count === 1) return 'REJECTED'

  const latest = await prisma.agentToolApproval.findUnique({
    where: { id: input.approvalRef },
    select: { status: true },
  })
  return latest && ['REJECTED', 'EXPIRED', 'REVOKED', 'RELEASED', 'CREDIT_CONSUMED', 'FILL_VERIFIED'].includes(latest.status)
    ? 'ALREADY_HANDLED'
    : 'NOT_EXPIRED'
}

export async function verifyApproval(input: ApprovalVerificationInput): Promise<ApprovalVerificationResult> {
  const approval = await prisma.agentToolApproval.findUnique({ where: { id: input.approvalRef } })
  if (!approval) {
    return { ok: false, code: 'APPROVAL_NOT_FOUND', error: 'Approval reference not found.' }
  }

  if (approval.workspaceId !== input.workspaceId) {
    return { ok: false, code: 'CROSS_WORKSPACE', error: 'Approval does not belong to this workspace.' }
  }
  if (approval.agentSessionId !== input.agentSessionId) {
    return { ok: false, code: 'SESSION_MISMATCH', error: 'Approval was issued for a different agent session.' }
  }
  if (approval.adapterId !== input.adapterId) {
    await rejectApproval({ ...input, status: 'REJECTED' })
    return { ok: false, code: 'ADAPTER_MISMATCH', error: 'The examination adapter does not match the approved context.' }
  }
  if (approval.pageUrl !== input.pageUrl) {
    await rejectApproval({ ...input, status: 'REJECTED' })
    return { ok: false, code: 'PAGE_CHANGED', error: 'The approved page URL changed.' }
  }
  if (approval.pageFingerprint !== input.pageFingerprint) {
    await rejectApproval({ ...input, status: 'REJECTED' })
    return { ok: false, code: 'PAGE_CHANGED', error: 'The page changed after approval — scan again and re-approve.' }
  }
  if (input.valueFingerprint) {
    const stored = approval.valueFingerprint as { hash?: string } | null
    const computed = hashValueFingerprint(input.valueFingerprint) as { hash?: string }
    if (!stored || stored.hash !== computed.hash) {
      await rejectApproval({ ...input, status: 'REJECTED' })
      return { ok: false, code: 'VALUES_CHANGED', error: 'Approved values changed after approval — scan again and re-approve.' }
    }
  }
  if (approval.status === 'REVOKED') {
    return { ok: false, code: 'APPROVAL_REVOKED', error: 'Approval was revoked.' }
  }
  if (approval.status === 'EXPIRED' || approval.expiresAt.getTime() <= Date.now()) {
    await rejectExpiredApproval({
      approvalRef: input.approvalRef,
      workspaceId: input.workspaceId,
      agentSessionId: input.agentSessionId,
    })
    return { ok: false, code: 'APPROVAL_EXPIRED', error: 'Approval expired. Scan again and re-approve.' }
  }
  if (!['APPROVED', 'FILL_REQUESTED'].includes(approval.status)) {
    return { ok: false, code: 'APPROVAL_USED', error: 'Approval is no longer available for a fill.' }
  }

  const requestedMappings = input.approved
    .map(item => `${item.index}:${item.canonical}`)
    .sort()
  const proposedMappings = Array.isArray(approval.proposedMapping)
    ? (approval.proposedMapping as unknown as ProposedMappingItem[])
        .map(item => `${item.index}:${item.canonical}`)
        .sort()
    : []
  const requestedCanonicals = [...new Set(input.approved.map(a => a.canonical))].sort()
  const approvedCanonicals = [...new Set(approval.approvedFieldIds)].sort()
  if (
    JSON.stringify(requestedMappings) !== JSON.stringify(proposedMappings) ||
    JSON.stringify(requestedCanonicals) !== JSON.stringify(approvedCanonicals)
  ) {
    await rejectApproval({ ...input, status: 'REJECTED' })
    return { ok: false, code: 'MAPPING_CHANGED', error: 'The approved field list does not match the approval record.' }
  }

  return {
    ok: true,
    approval: {
      id: approval.id,
      workspaceId: approval.workspaceId,
      userId: approval.userId,
      agentSessionId: approval.agentSessionId,
      adapterId: approval.adapterId,
      pageUrl: approval.pageUrl,
      pageFingerprint: approval.pageFingerprint,
      approvedFieldIds: approval.approvedFieldIds,
    },
  }
}

function fingerprintItems(value: unknown): Map<string, string> {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { algorithm?: unknown }).algorithm !== 'sha256-canonical-sort' ||
    !Array.isArray((value as { items?: unknown }).items)
  ) return new Map()
  const items = (value as { items: unknown[] }).items
  const out = new Map<string, string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') return new Map()
    const canonical = (item as { canonical?: unknown }).canonical
    const hash = (item as { hash?: unknown }).hash
    if (typeof canonical !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || out.has(canonical)) return new Map()
    out.set(canonical, hash)
  }
  return out
}

export function validateStoredVerificationReceipt(approval: {
  adapterId: string
  pageUrl: string
  pageFingerprint: string
  proposedMapping: unknown
  approvedFieldIds: string[]
  valueFingerprint: unknown
  verificationReceipt: unknown
}): { valid: boolean; verifiedCount: number } {
  const receipt = approval.verificationReceipt as StoredVerificationReceipt | null
  if (!receipt || typeof receipt !== 'object' || receipt.version !== 1 || receipt.outcome !== 'VERIFIED') {
    return { valid: false, verifiedCount: 0 }
  }
  if (
    receipt.adapterId !== approval.adapterId ||
    receipt.pageUrl !== approval.pageUrl ||
    receipt.pageFingerprint !== approval.pageFingerprint ||
    !Array.isArray(receipt.results)
  ) {
    return { valid: false, verifiedCount: 0 }
  }
  const expected = Array.isArray(approval.proposedMapping)
    ? (approval.proposedMapping as ProposedMappingItem[])
    : []
  const byCanonical = fingerprintItems(approval.valueFingerprint)
  if (byCanonical.size === 0) return { valid: false, verifiedCount: 0 }
  const expectedCanonicals = [...new Set(expected.map(item => item.canonical))].sort()
  const approvedCanonicals = [...new Set(approval.approvedFieldIds)].sort()
  const fingerprintCanonicals = [...byCanonical.keys()].sort()
  if (
    JSON.stringify(expectedCanonicals) !== JSON.stringify(approvedCanonicals) ||
    JSON.stringify(expectedCanonicals) !== JSON.stringify(fingerprintCanonicals)
  ) return { valid: false, verifiedCount: 0 }
  const expectedPairs = expected.map(item => `${item.index}:${item.canonical}`).sort()
  const gotPairs = receipt.results.map(item => `${item.index}:${item.canonical}`).sort()
  if (expectedPairs.length === 0 || JSON.stringify(expectedPairs) !== JSON.stringify(gotPairs)) {
    return { valid: false, verifiedCount: 0 }
  }
  let verifiedCount = 0
  for (const item of receipt.results) {
    if (!['filled', 'unverified', 'no-saved-value', 'refused', 'skipped', 'unsupported', 'no-option', 'stale'].includes(item.status)) {
      return { valid: false, verifiedCount: 0 }
    }
    if (item.status === 'filled') {
      if (!item.valueHash || item.valueHash !== byCanonical.get(item.canonical)) return { valid: false, verifiedCount: 0 }
      verifiedCount += 1
    } else if (item.valueHash !== undefined) {
      return { valid: false, verifiedCount: 0 }
    }
  }
  return {
    valid: verifiedCount > 0 && receipt.verifiedCount === verifiedCount,
    verifiedCount,
  }
}

export async function recordVerificationReport(input: FillVerificationReport): Promise<
  | { ok: true; verifiedCount: number; unverifiedCount: number; releaseRequired: boolean }
  | { ok: false; code: string; error: string }
> {
  return prisma.$transaction(async tx => {
    const approval = await tx.agentToolApproval.findFirst({
      where: {
        id: input.approvalRef,
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentSessionId: input.agentSessionId,
      },
    })
    if (!approval) return { ok: false, code: 'APPROVAL_INVALID', error: 'The fill approval is missing or belongs to a different session.' }
    if (approval.status !== 'FILL_REQUESTED') {
      return { ok: false, code: 'APPROVAL_INVALID', error: 'The approval is not awaiting fill verification.' }
    }
    if (approval.revokedAt || approval.expiresAt.getTime() <= Date.now()) {
      const nextStatus = approval.revokedAt ? 'REVOKED' : 'EXPIRED'
      await tx.agentToolApproval.updateMany({
        where: { id: approval.id, status: 'FILL_REQUESTED' },
        data: { status: nextStatus },
      })
      return { ok: false, code: nextStatus === 'EXPIRED' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REVOKED', error: 'The approval is no longer valid.' }
    }
    if (approval.pageFingerprint !== input.pageFingerprint) {
      await tx.agentToolApproval.updateMany({ where: { id: approval.id, status: 'FILL_REQUESTED' }, data: { status: 'REJECTED' } })
      return { ok: false, code: 'PAGE_CHANGED', error: 'The page changed before readback verification.' }
    }
    if (approval.adapterId !== input.adapterId || approval.pageUrl !== input.pageUrl) {
      await tx.agentToolApproval.updateMany({ where: { id: approval.id, status: 'FILL_REQUESTED' }, data: { status: 'REJECTED' } })
      return { ok: false, code: 'PAGE_CHANGED', error: 'The approved page or form context changed before readback verification.' }
    }

    const reservation = await tx.creditReservation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        account: { userId: input.userId },
        status: 'PENDING',
        OR: [
          { idempotencyKey: approval.id, agentSessionId: input.agentSessionId },
          { legacyAgentSessionOrIdempotencyKey: approval.id, agentSessionId: null },
        ],
      },
      select: { id: true },
    })
    if (!reservation) return { ok: false, code: 'RESERVATION_NOT_FOUND', error: 'The matching pending reservation was not found.' }

    const mappings = Array.isArray(approval.proposedMapping)
      ? (approval.proposedMapping as unknown as ProposedMappingItem[])
      : []
    const mappingCanonicals = [...new Set(mappings.map(item => item.canonical))].sort()
    const approvedCanonicals = [...new Set(approval.approvedFieldIds)].sort()
    if (JSON.stringify(mappingCanonicals) !== JSON.stringify(approvedCanonicals)) {
      return { ok: false, code: 'MAPPING_CHANGED', error: 'The approved field identifiers no longer match the approval record.' }
    }
    const submittedPairs = input.results.map(item => `${item.index}:${item.canonical}`).sort()
    const expectedPairs = mappings.map(item => `${item.index}:${item.canonical}`).sort()
    if (new Set(submittedPairs).size !== submittedPairs.length || JSON.stringify(submittedPairs) !== JSON.stringify(expectedPairs)) {
      return { ok: false, code: 'MAPPING_CHANGED', error: 'Readback results do not match the approved field identifiers.' }
    }

    const valueHashes = fingerprintItems(approval.valueFingerprint)
    const mismatch = input.results.some(item =>
      item.status === 'filled'
        ? (!item.valueHash || item.valueHash !== valueHashes.get(item.canonical))
        : item.valueHash !== undefined
    )
    const verifiedCount = mismatch ? 0 : input.results.filter(item => item.status === 'filled').length
    const normalizedResults = input.results.map(item => ({
      index: item.index,
      canonical: item.canonical,
      status: mismatch && item.status === 'filled' ? 'unverified' : item.status,
      ...(verifiedCount > 0 && item.status === 'filled' ? { valueHash: item.valueHash } : {}),
    }))
    const receipt: StoredVerificationReceipt = {
      version: 1,
      adapterId: input.adapterId,
      pageUrl: input.pageUrl,
      pageFingerprint: input.pageFingerprint,
      outcome: mismatch ? 'MISMATCH' : verifiedCount > 0 ? 'VERIFIED' : 'NO_FIELDS',
      verifiedCount,
      results: normalizedResults,
      verifiedAt: new Date().toISOString(),
    }
    const transition = await tx.agentToolApproval.updateMany({
      where: {
        id: approval.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentSessionId: input.agentSessionId,
        status: 'FILL_REQUESTED',
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      data: {
        status: verifiedCount > 0 ? 'FILL_VERIFIED' : 'RELEASED',
        verificationReceipt: receipt as unknown as Prisma.InputJsonValue,
      },
    })
    if (transition.count !== 1) return { ok: false, code: 'APPROVAL_INVALID', error: 'The approval state changed during verification.' }
    return {
      ok: true,
      verifiedCount,
      unverifiedCount: input.results.length - verifiedCount,
      releaseRequired: verifiedCount === 0,
    }
  })
}

/** Mark expired rows so the database state stays honest with the executor. */
export async function expireStaleApprovals(workspaceId: string): Promise<number> {
  const result = await prisma.agentToolApproval.updateMany({
    where: {
      workspaceId,
      status: { in: ['APPROVED', 'FILL_REQUESTED'] },
      expiresAt: { lte: new Date() },
    },
    data: { status: 'REJECTED' },
  })
  return result.count
}
