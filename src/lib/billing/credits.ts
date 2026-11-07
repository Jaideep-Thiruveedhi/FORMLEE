import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { validateStoredVerificationReceipt } from '@/lib/agent/approval'

export type LedgerType = 'GRANT' | 'RESERVE' | 'CONSUME' | 'RELEASE' | 'REVERSE'
export type ReservationStatus = 'PENDING' | 'CONSUMED' | 'RELEASED'
export type PaymentStatus = 'CREATED' | 'PAID' | 'FAILED' | 'REFUNDED'

export const CREDIT_PACKAGES = [
  { code: 'STARTER', name: 'Starter', credits: 1, amountPaise: 5000 },
  { code: 'VALUE', name: 'Value', credits: 3, amountPaise: 10000 },
  { code: 'PRO', name: 'Pro', credits: 10, amountPaise: 25000 },
] as const

export type CreditPackageCode = (typeof CREDIT_PACKAGES)[number]['code']

export async function getOrCreateCreditAccount(userId: string) {
  return prisma.creditAccount.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
    },
  })
}

export async function getCreditAccount(userId: string) {
  return prisma.creditAccount.findUnique({ where: { userId } })
}

export async function getLedgerHistory(userId: string, take = 50, skip = 0) {
  const account = await getOrCreateCreditAccount(userId)
  return prisma.creditLedgerEntry.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  })
}

interface GrantCreditsInput {
  userId: string
  amount: number
  description: string
  idempotencyKey: string
  paymentOrderId?: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Grants credits to a user's account. Idempotent: the same idempotency key
 * will return the existing ledger entry without changing the balance again.
 */
export async function grantCredits(input: GrantCreditsInput, txClient?: Prisma.TransactionClient) {
  const { userId, amount, description, idempotencyKey, paymentOrderId, metadata } = input
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Grant amount must be a positive integer.')
  }

  const executor = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.creditLedgerEntry.findUnique({ where: { idempotencyKey } })
    if (existing) {
      return existing
    }

    const account = await tx.creditAccount.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0, totalEarned: 0, totalSpent: 0 },
    })

    const balanceAfter = account.balance + amount
    const totalEarned = account.totalEarned + amount

    const [updated, entry] = await Promise.all([
      tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarned },
      }),
      tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'GRANT',
          amount,
          balanceAfter,
          description,
          idempotencyKey,
          paymentOrderId,
          metadata: metadata ?? undefined,
        },
      }),
    ])

    return entry
  }

  if (txClient) {
    return executor(txClient)
  }
  return prisma.$transaction(executor)
}

interface ReserveCreditInput {
  userId: string
  workspaceId: string
  /** Actual AgentSession.id; null for user-initiated reservations. */
  agentSessionId?: string | null
  applicationId?: string
  /** Stable per approved fill; retries for one approval reuse its reservation. */
  idempotencyKey: string
  description?: string
}

/**
 * Reserves one application credit per operation. Account, workspace and
 * AgentSession identity scope the retry; idempotencyKey is dedicated to the
 * logical reservation and never doubles as an authentication token.
 */
export async function reserveCredit(input: ReserveCreditInput) {
  const { userId, workspaceId, agentSessionId = null, applicationId, idempotencyKey, description } = input
  if (!idempotencyKey || idempotencyKey.length > 128) throw new Error('IDEMPOTENCY_KEY_REQUIRED')

  const findExisting = () => prisma.creditReservation.findFirst({
    where: { idempotencyKey, workspaceId, account: { userId } },
  })
  const assertSameIdentity = <T extends { agentSessionId: string | null }>(reservation: T): T => {
    if (reservation.agentSessionId !== agentSessionId) throw new Error('IDEMPOTENCY_KEY_CONFLICT')
    return reservation
  }

  try {
    return await prisma.$transaction(async tx => {
      const ownedWorkspace = await tx.workspace.findFirst({
        where: { id: workspaceId, userId },
        select: { id: true },
      })
      if (!ownedWorkspace) throw new Error('WORKSPACE_FORBIDDEN')

      const existing = await tx.creditReservation.findFirst({
        where: { idempotencyKey, workspaceId, account: { userId } },
      })
      if (existing) return assertSameIdentity(existing)

      // A preserved historical value cannot safely be interpreted as either
      // a session id or an idempotency key. Block exact collisions so a retry
      // cannot silently debit twice; the owner can explicitly release it.
      const possibleLegacyKeys = [...new Set([idempotencyKey, ...(agentSessionId ? [agentSessionId] : [])])]
      const legacyPending = await tx.creditReservation.findFirst({
        where: {
          legacyAgentSessionOrIdempotencyKey: { in: possibleLegacyKeys },
          workspaceId,
          status: 'PENDING',
          account: { userId },
        },
        select: { id: true, agentSessionId: true, legacyAgentSessionOrIdempotencyKey: true },
      })
      if (legacyPending) {
        // Recover an old approval-key reservation only when the row's opaque
        // value exactly equals a durable approval bound to this caller.
        const approval = agentSessionId && legacyPending.legacyAgentSessionOrIdempotencyKey === idempotencyKey
          ? await tx.agentToolApproval.findFirst({
              where: { id: idempotencyKey, workspaceId, userId, agentSessionId },
              select: { id: true },
            })
          : null
        if (approval && legacyPending.agentSessionId === null) {
          return tx.creditReservation.findUniqueOrThrow({ where: { id: legacyPending.id } })
        }
        throw new Error('LEGACY_RESERVATION_REQUIRES_RECOVERY')
      }

      const account = await tx.creditAccount.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0, totalEarned: 0, totalSpent: 0 },
      })

      // Guard the debit in SQL so concurrent approvals cannot spend the same
      // last credit or overwrite one another's balance update.
      const debited = await tx.creditAccount.updateMany({
        where: { id: account.id, balance: { gte: 1 } },
        data: { balance: { decrement: 1 }, totalSpent: { increment: 1 } },
      })
      if (debited.count !== 1) throw new Error('INSUFFICIENT_CREDITS')

      const balanceAfter = (await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } })).balance
      const reservation = await tx.creditReservation.create({
        data: {
          accountId: account.id,
          workspaceId,
          applicationId,
          agentSessionId,
          idempotencyKey,
          amount: 1,
          status: 'PENDING',
        },
      })
      await tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'RESERVE',
          amount: -1,
          balanceAfter,
          description: description ?? 'Reserved application credit',
          applicationId,
        },
      })
      return reservation
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (code === 'P2002') {
      const existing = await findExisting()
      if (existing) return assertSameIdentity(existing)
      // A global unique-key collision outside this account/workspace is
      // intentionally indistinguishable from an invalid key. Never disclose
      // another account's reservation.
      throw new Error('IDEMPOTENCY_KEY_CONFLICT')
    }
    throw error
  }
}
interface ConsumeCreditInput {
  reservationId: string
  userId: string
  /** When set, the reservation must belong to this workspace (agent scoping). */
  workspaceId?: string
  description?: string
}

/**
 * Consumes a pending reservation. Idempotent: returns the existing consumed
 * reservation if already consumed.
 */
export async function consumeCredit(input: ConsumeCreditInput) {
  const { reservationId, userId, workspaceId, description } = input

  return prisma.$transaction(async tx => {
    const reservation = await tx.creditReservation.findFirst({
      where: { id: reservationId, account: { userId }, workspaceId: workspaceId ?? undefined },
    })
    if (!reservation) {
      throw new Error('RESERVATION_NOT_FOUND')
    }
    // Agent reservations can be consumed only through the approval-bound
    // transaction below; a signed-in user cannot bypass its receipt gate.
    if (reservation.agentSessionId) throw new Error('AGENT_APPROVAL_REQUIRED')
    if (reservation.status === 'CONSUMED') {
      return reservation
    }
    if (reservation.status !== 'PENDING') {
      throw new Error('RESERVATION_NOT_PENDING')
    }

    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { id: reservation.accountId },
    })

    const claimed = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: 'PENDING' },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    })
    if (claimed.count !== 1) {
      const latest = await tx.creditReservation.findUnique({ where: { id: reservation.id } })
      if (latest?.status === 'CONSUMED') return latest
      throw new Error('RESERVATION_NOT_PENDING')
    }

    await tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'CONSUME',
          amount: 0,
          balanceAfter: account.balance,
          reservationId: reservation.id,
          applicationId: reservation.applicationId ?? undefined,
          description: description ?? 'Consumed application credit',
        },
      })

    return tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })
  })
}

interface ConsumeVerifiedAgentCreditInput {
  reservationId: string
  approvalRef: string
  pageFingerprint: string
  userId: string
  workspaceId: string
  agentSessionId: string
}

/** Consume an agent reservation only with its live session-bound approval and validated readback receipt. */
export async function consumeVerifiedAgentCredit(input: ConsumeVerifiedAgentCreditInput) {
  return prisma.$transaction(async tx => {
    const reservation = await tx.creditReservation.findFirst({
      where: {
        id: input.reservationId,
        account: { userId: input.userId },
        workspaceId: input.workspaceId,
        OR: [
          { idempotencyKey: input.approvalRef, agentSessionId: input.agentSessionId },
          // Historical rows may store this exact approval reference in the
          // renamed opaque column. The approval itself below proves session scope.
          { legacyAgentSessionOrIdempotencyKey: input.approvalRef, agentSessionId: null },
        ],
      },
    })
    if (!reservation) throw new Error('RESERVATION_NOT_FOUND')

    const approval = await tx.agentToolApproval.findFirst({
      where: {
        id: input.approvalRef,
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentSessionId: input.agentSessionId,
      },
    })
    if (!approval || approval.pageFingerprint !== input.pageFingerprint) throw new Error('APPROVAL_INVALID')
    const receipt = validateStoredVerificationReceipt(approval)
    if (!receipt.valid || receipt.verifiedCount < 1) throw new Error('VERIFICATION_RECEIPT_REQUIRED')

    if (reservation.status === 'CONSUMED' && approval.status === 'CREDIT_CONSUMED') return reservation
    if (reservation.status !== 'PENDING') throw new Error('RESERVATION_NOT_PENDING')
    if (
      approval.status !== 'FILL_VERIFIED' ||
      approval.revokedAt ||
      approval.expiresAt.getTime() <= Date.now()
    ) {
      throw new Error(approval.expiresAt.getTime() <= Date.now() ? 'APPROVAL_EXPIRED' : 'APPROVAL_NOT_VERIFIED')
    }

    const claimed = await tx.creditReservation.updateMany({
      where: {
        id: reservation.id,
        status: 'PENDING',
        OR: reservation.legacyAgentSessionOrIdempotencyKey === input.approvalRef
          ? [{ legacyAgentSessionOrIdempotencyKey: input.approvalRef, agentSessionId: null }]
          : [{ idempotencyKey: input.approvalRef, agentSessionId: input.agentSessionId }],
      },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    })
    if (claimed.count !== 1) throw new Error('RESERVATION_NOT_PENDING')
    const approvalClaimed = await tx.agentToolApproval.updateMany({
      where: {
        id: approval.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentSessionId: input.agentSessionId,
        status: 'FILL_VERIFIED',
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      data: { status: 'CREDIT_CONSUMED', usedAt: new Date() },
    })
    if (approvalClaimed.count !== 1) throw new Error('APPROVAL_NOT_VERIFIED')

    const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: reservation.accountId } })
    await tx.creditLedgerEntry.create({
      data: {
        accountId: account.id,
        type: 'CONSUME',
        amount: 0,
        balanceAfter: account.balance,
        reservationId: reservation.id,
        applicationId: reservation.applicationId ?? undefined,
        description: 'Consumed verified approved application fill',
      },
    })
    return tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })
  })
}

interface ReleaseCreditInput {
  reservationId: string
  userId: string
  /** When set, the reservation must belong to this workspace (agent scoping). */
  workspaceId?: string
  /** When set, an agent caller must own this reservation's approval/session. */
  agentSessionId?: string
  description?: string
}

/**
 * Releases a pending reservation, returning the credit to the available balance.
 * Idempotent: returns the existing released reservation if already released.
 */
export async function releaseCredit(input: ReleaseCreditInput, txClient?: Prisma.TransactionClient) {
  const { reservationId, userId, workspaceId, agentSessionId, description } = input

  const executor = async (tx: Prisma.TransactionClient) => {
    const reservation = await tx.creditReservation.findFirst({
      where: { id: reservationId, account: { userId }, workspaceId: workspaceId ?? undefined },
    })
    if (!reservation) {
      throw new Error('RESERVATION_NOT_FOUND')
    }
    const approvalRef = reservation.idempotencyKey ?? reservation.legacyAgentSessionOrIdempotencyKey
    const linkedApproval = approvalRef
      ? await tx.agentToolApproval.findFirst({
          where: { id: approvalRef, workspaceId: reservation.workspaceId, userId },
        })
      : null
    if (reservation.legacyAgentSessionOrIdempotencyKey && !linkedApproval) {
      // A session id and an approval/idempotency key are indistinguishable in
      // this historical field. Never refund an unclassified row automatically.
      throw new Error('LEGACY_RESERVATION_REQUIRES_RECONCILIATION')
    }
    if (agentSessionId && reservation.agentSessionId && reservation.agentSessionId !== agentSessionId) {
      throw new Error('RESERVATION_SESSION_MISMATCH')
    }
    if (agentSessionId && linkedApproval && linkedApproval.agentSessionId !== agentSessionId) {
      throw new Error('RESERVATION_SESSION_MISMATCH')
    }
    if (agentSessionId && !reservation.agentSessionId && !linkedApproval) {
      throw new Error('RESERVATION_SESSION_MISMATCH')
    }
    if (linkedApproval?.status === 'FILL_VERIFIED' || linkedApproval?.status === 'CREDIT_CONSUMED') {
      throw new Error('APPROVAL_VERIFIED_CANNOT_RELEASE')
    }
    if (reservation.status === 'RELEASED') {
      return reservation
    }
    if (reservation.status !== 'PENDING') {
      throw new Error('RESERVATION_NOT_PENDING')
    }

    if (linkedApproval && ['APPROVED', 'FILL_REQUESTED'].includes(linkedApproval.status)) {
      const approvalClaim = await tx.agentToolApproval.updateMany({
        where: {
          id: linkedApproval.id,
          workspaceId: reservation.workspaceId,
          status: { in: ['APPROVED', 'FILL_REQUESTED'] },
        },
        data: { status: 'RELEASED' },
      })
      if (approvalClaim.count !== 1) {
        const latestApproval = await tx.agentToolApproval.findUnique({ where: { id: linkedApproval.id }, select: { status: true } })
        if (latestApproval?.status === 'FILL_VERIFIED' || latestApproval?.status === 'CREDIT_CONSUMED') {
          throw new Error('APPROVAL_VERIFIED_CANNOT_RELEASE')
        }
        if (!latestApproval || !['RELEASED', 'REJECTED', 'EXPIRED', 'REVOKED'].includes(latestApproval.status)) {
          throw new Error('APPROVAL_STATE_CONFLICT')
        }
      }
    }

    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { id: reservation.accountId },
    })

    const claimed = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: 'PENDING' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    })
    if (claimed.count !== 1) {
      const latest = await tx.creditReservation.findUnique({ where: { id: reservation.id } })
      if (latest?.status === 'RELEASED') return latest
      throw new Error('RESERVATION_NOT_PENDING')
    }

    await tx.creditAccount.update({
      where: { id: account.id },
      data: { balance: { increment: 1 }, totalSpent: { decrement: 1 } },
    })
    const balanceAfter = (await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } })).balance

    await tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'RELEASE',
          amount: 1,
          balanceAfter,
          reservationId: reservation.id,
          applicationId: reservation.applicationId ?? undefined,
          description: description ?? 'Released application credit',
        },
      })

    return tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })
  }

  return txClient ? executor(txClient) : prisma.$transaction(executor)
}

interface ReverseCreditInput {
  reservationId: string
  userId: string
  description?: string
}

/**
 * Reverses a consumed credit, returning it to the available balance. Used for
 * refunds or corrections. The reservation must already be consumed.
 */
export async function reverseCredit(input: ReverseCreditInput) {
  const { reservationId, userId, description } = input

  return prisma.$transaction(async tx => {
    const reservation = await tx.creditReservation.findFirst({
      where: { id: reservationId, account: { userId }, status: 'CONSUMED' },
    })
    if (!reservation) {
      throw new Error('CONSUMED_RESERVATION_NOT_FOUND')
    }

    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { id: reservation.accountId },
    })

    const balanceAfter = account.balance + 1
    const totalSpent = account.totalSpent - 1

    const [updatedAccount, updatedReservation, entry] = await Promise.all([
      tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalSpent },
      }),
      tx.creditReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      }),
      tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'REVERSE',
          amount: 1,
          balanceAfter,
          reservationId: reservation.id,
          applicationId: reservation.applicationId ?? undefined,
          description: description ?? 'Reversed application credit',
        },
      }),
    ])

    return updatedReservation
  })
}

export async function getActiveReservations(userId: string) {
  const account = await getOrCreateCreditAccount(userId)
  return prisma.creditReservation.findMany({
    where: { accountId: account.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  })
}

interface ReverseGrantInput {
  userId: string
  paymentOrderId: string
  amount: number
  description: string
  idempotencyKey: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Reverses a credit grant (e.g. after a refund). Deducts credits from the
 * account balance and writes a REVERSE ledger entry. Idempotent.
 */
export async function reverseGrant(input: ReverseGrantInput, txClient?: Prisma.TransactionClient) {
  const { userId, paymentOrderId, amount, description, idempotencyKey, metadata } = input
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Reverse amount must be a positive integer.')
  }

  const executor = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.creditLedgerEntry.findUnique({ where: { idempotencyKey } })
    if (existing) {
      return existing
    }

    const account = await tx.creditAccount.findUnique({ where: { userId } })
    if (!account) {
      throw new Error('ACCOUNT_NOT_FOUND')
    }
    if (account.balance < amount) {
      throw new Error('INSUFFICIENT_BALANCE_FOR_REFUND')
    }

    const balanceAfter = account.balance - amount
    const totalEarned = account.totalEarned - amount

    const [updated, entry] = await Promise.all([
      tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarned },
      }),
      tx.creditLedgerEntry.create({
        data: {
          accountId: account.id,
          type: 'REVERSE',
          amount: -amount,
          balanceAfter,
          description,
          idempotencyKey,
          paymentOrderId,
          metadata: metadata ?? undefined,
        },
      }),
    ])

    return entry
  }

  if (txClient) {
    return executor(txClient)
  }
  return prisma.$transaction(executor)
}
