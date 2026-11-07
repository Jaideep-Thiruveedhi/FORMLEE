import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const REFERRAL_COOKIE = 'formlee_ref_code'
export const REFERRAL_ATTRIBUTION_DAYS = 30

export const COMMISSION_TIERS = {
  STUDENT_AMBASSADOR: { label: 'Student Ambassador', basisPoints: 500 },
  CAMPUS_REPRESENTATIVE: { label: 'Campus Representative', basisPoints: 750 },
  MARKETING_PARTNER: { label: 'Marketing Partner', basisPoints: 1000 },
} as const

export type ReferralTier = keyof typeof COMMISSION_TIERS

export function isValidTier(tier: string): tier is ReferralTier {
  return tier in COMMISSION_TIERS
}

export function basisPointsForTier(tier: ReferralTier): number {
  return COMMISSION_TIERS[tier].basisPoints
}

export function formatCommissionPercent(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, '') + '%'
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex')
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export async function recordReferralClick(input: {
  code: string
  ip: string
  userAgent?: string
  source?: string
  landingPath?: string
}) {
  const { code, ip, userAgent, source, landingPath } = input

  const referralCode = await prisma.referralCode.findUnique({
    where: { code },
    include: { partner: true },
  })
  if (!referralCode || !referralCode.isActive || !referralCode.partner.isActive) {
    return { ok: false as const, error: 'INVALID_CODE' }
  }

  const ipHash = hashIp(ip)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recentClicks = await prisma.referralClick.count({
    where: { codeId: referralCode.id, ipHash, clickedAt: { gte: oneHourAgo } },
  })
  if (recentClicks >= 10) {
    return { ok: false as const, error: 'RATE_LIMITED' }
  }

  await prisma.referralClick.create({
    data: {
      codeId: referralCode.id,
      ipHash,
      userAgent,
      source,
      landingPath,
    },
  })

  return {
    ok: true as const,
    partnerId: referralCode.partnerId,
    codeId: referralCode.id,
    code: referralCode.code,
  }
}

export async function claimReferralAttribution(input: {
  userId: string
  userEmail: string
  code?: string
}) {
  const { userId, userEmail, code } = input

  // Prevent duplicate attribution.
  const existing = await prisma.referralAttribution.findUnique({ where: { userId } })
  if (existing) {
    return { ok: true as const, attribution: existing, alreadyAttributed: true }
  }

  if (!code) {
    return { ok: false as const, error: 'NO_REFERRAL_CODE' }
  }

  const referralCode = await prisma.referralCode.findUnique({
    where: { code },
    include: { partner: true },
  })
  if (!referralCode || !referralCode.isActive || !referralCode.partner.isActive) {
    return { ok: false as const, error: 'INVALID_CODE' }
  }

  // Self-referral protection: partner email or linked user matches referred user.
  if (referralCode.partner.email.toLowerCase() === userEmail.toLowerCase()) {
    return { ok: false as const, error: 'SELF_REFERRAL' }
  }
  if (referralCode.partner.userId === userId) {
    return { ok: false as const, error: 'SELF_REFERRAL' }
  }

  // Require a recent click (within the attribution window) for this code.
  const recentClick = await prisma.referralClick.findFirst({
    where: { codeId: referralCode.id, clickedAt: { gte: addDays(new Date(), -REFERRAL_ATTRIBUTION_DAYS) } },
    orderBy: { clickedAt: 'desc' },
  })
  if (!recentClick) {
    return { ok: false as const, error: 'ATTRIBUTION_WINDOW_EXPIRED' }
  }

  const attribution = await prisma.referralAttribution.create({
    data: {
      userId,
      partnerId: referralCode.partnerId,
      codeId: referralCode.id,
      attributedAt: new Date(),
      expiresAt: addDays(new Date(), 365 * 10), // persistent; 10-year practical expiry
    },
  })

  return { ok: true as const, attribution, alreadyAttributed: false }
}

export async function createCommissionForPayment(paymentOrderId: string, txClient?: Prisma.TransactionClient) {
  const executor = async (tx: Prisma.TransactionClient) => {
    const paymentOrder = await tx.paymentOrder.findUnique({
      where: { id: paymentOrderId },
      include: { account: { include: { user: { include: { referralAttribution: { include: { partner: true } } } } } } },
    })
    if (!paymentOrder) {
      throw new Error('PAYMENT_ORDER_NOT_FOUND')
    }
    if (paymentOrder.status !== 'PAID' || !paymentOrder.paidAmountPaise) {
      throw new Error('PAYMENT_NOT_CAPTURED')
    }

    const attribution = paymentOrder.account.user.referralAttribution
    if (!attribution) {
      return null
    }

    const partner = attribution.partner
    if (!partner.isActive) {
      return null
    }

    const idempotencyKey = `commission-${paymentOrderId}`
    const existing = await tx.referralCommission.findUnique({ where: { idempotencyKey } })
    if (existing) {
      return existing
    }

    const basisPoints = partner.commissionBasisPoints
    const amountPaise = Math.floor((paymentOrder.paidAmountPaise * basisPoints) / 10000)
    if (amountPaise <= 0) {
      return null
    }

    const commission = await tx.referralCommission.create({
      data: {
        partnerId: partner.id,
        paymentOrderId: paymentOrder.id,
        amountPaise,
        basisPoints,
        status: 'PENDING',
        holdingUntil: addDays(new Date(), partner.holdingDays),
        idempotencyKey,
      },
    })

    // Mark attribution as converted.
    await tx.referralAttribution.update({
      where: { id: attribution.id },
      data: { convertedAt: new Date() },
    })

    return commission
  }

  if (txClient) {
    return executor(txClient)
  }
  return prisma.$transaction(executor)
}

export async function reverseCommissionForRefund(paymentOrderId: string, txClient?: Prisma.TransactionClient) {
  const executor = async (tx: Prisma.TransactionClient) => {
    const commission = await tx.referralCommission.findUnique({
      where: { paymentOrderId },
      include: { reversal: true },
    })
    if (!commission || commission.reversal) {
      return commission?.reversal ?? null
    }

    const updated = await tx.referralCommission.update({
      where: { id: commission.id },
      data: { status: 'REVERSED' },
    })

    const reversal = await tx.referralCommissionReversal.create({
      data: {
        commissionId: commission.id,
        partnerId: commission.partnerId,
        amountPaise: -commission.amountPaise,
        reason: 'refund',
      },
    })

    return reversal
  }

  if (txClient) {
    return executor(txClient)
  }
  return prisma.$transaction(executor)
}

export async function getPartnerDashboard(partnerId: string) {
  const partner = await prisma.referralPartner.findUnique({
    where: { id: partnerId },
    include: {
      codes: true,
      _count: {
        select: {
          attributions: true,
          commissions: true,
          payouts: true,
        },
      },
    },
  })
  if (!partner) {
    throw new Error('PARTNER_NOT_FOUND')
  }

  const [clickCount, registrationCount, conversionCount, commissionAgg] = await Promise.all([
    prisma.referralClick.count({ where: { code: { partnerId } } }),
    prisma.referralAttribution.count({ where: { partnerId } }),
    prisma.referralAttribution.count({ where: { partnerId, convertedAt: { not: null } } }),
    prisma.referralCommission.aggregate({
      where: { partnerId },
      _sum: { amountPaise: true },
    }),
  ])

  const pending = await prisma.referralCommission.aggregate({
    where: { partnerId, status: 'PENDING' },
    _sum: { amountPaise: true },
  })
  const approved = await prisma.referralCommission.aggregate({
    where: { partnerId, status: 'APPROVED' },
    _sum: { amountPaise: true },
  })
  const paid = await prisma.referralPayout.aggregate({
    where: { partnerId, status: 'PAID' },
    _sum: { amountPaise: true },
  })

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      tier: partner.tier,
      commissionBasisPoints: partner.commissionBasisPoints,
      isActive: partner.isActive,
    },
    codes: partner.codes.map(c => c.code),
    stats: {
      clicks: clickCount,
      registrations: registrationCount,
      conversions: conversionCount,
      conversionRate: registrationCount > 0 ? (conversionCount / registrationCount) * 100 : 0,
      totalCommission: commissionAgg._sum.amountPaise ?? 0,
      pendingCommission: pending._sum.amountPaise ?? 0,
      approvedCommission: approved._sum.amountPaise ?? 0,
      paidCommission: paid._sum.amountPaise ?? 0,
    },
  }
}

export async function getPartnerCommissions(partnerId: string) {
  return prisma.referralCommission.findMany({
    where: { partnerId },
    orderBy: { createdAt: 'desc' },
    include: { paymentOrder: { select: { id: true, packageId: true, paidAmountPaise: true, paidAt: true } }, reversal: true },
  })
}

export async function getPartnerPayouts(partnerId: string) {
  return prisma.referralPayout.findMany({
    where: { partnerId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createPartner(input: {
  name: string
  email: string
  phone?: string
  tier?: ReferralTier
  commissionBasisPoints?: number
  holdingDays?: number
  notes?: string
}) {
  const tier = input.tier && isValidTier(input.tier) ? input.tier : 'STUDENT_AMBASSADOR'
  const basisPoints = input.commissionBasisPoints ?? basisPointsForTier(tier)

  // Generate a default code from the partner name, e.g. JAIDEEP10.
  const base = input.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12)
  const suffix = Math.floor(10 + Math.random() * 90)
  let code = `${base}${suffix}`

  const partner = await prisma.referralPartner.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone,
      tier,
      commissionBasisPoints: basisPoints,
      holdingDays: input.holdingDays ?? 7,
      notes: input.notes,
      isActive: true,
      codes: {
        create: { code },
      },
    },
    include: { codes: true },
  })

  return partner
}

export async function generatePartnerCode(partnerId: string, code: string) {
  return prisma.referralCode.create({
    data: {
      partnerId,
      code: code.toUpperCase(),
    },
  })
}

export async function togglePartnerActive(partnerId: string, isActive: boolean) {
  return prisma.referralPartner.update({
    where: { id: partnerId },
    data: { isActive },
  })
}

export async function approveCommission(commissionId: string) {
  const commission = await prisma.referralCommission.findUnique({ where: { id: commissionId } })
  if (!commission) {
    throw new Error('COMMISSION_NOT_FOUND')
  }
  if (commission.status !== 'PENDING') {
    throw new Error('COMMISSION_NOT_PENDING')
  }
  if (commission.holdingUntil > new Date()) {
    throw new Error('HOLDING_PERIOD_NOT_EXPIRED')
  }
  return prisma.referralCommission.update({
    where: { id: commissionId },
    data: { status: 'APPROVED', approvedAt: new Date() },
  })
}

export async function rejectCommission(commissionId: string) {
  return prisma.referralCommission.update({
    where: { id: commissionId },
    data: { status: 'REJECTED' },
  })
}

export async function recordPayout(input: {
  partnerId: string
  amountPaise: number
  commissionIds: string[]
  method?: string
  reference?: string
  notes?: string
}) {
  const { partnerId, amountPaise, commissionIds, method, reference, notes } = input

  return prisma.$transaction(async tx => {
    const payout = await tx.referralPayout.create({
      data: {
        partnerId,
        amountPaise,
        status: 'PAID',
        method,
        reference,
        notes,
        paidAt: new Date(),
      },
    })

    await tx.referralCommission.updateMany({
      where: { id: { in: commissionIds }, partnerId, status: 'APPROVED' },
      data: { status: 'APPROVED', payoutId: payout.id, paidAt: new Date() },
    })

    return payout
  })
}

export async function listPartners() {
  return prisma.referralPartner.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      codes: true,
      _count: {
        select: {
          attributions: true,
          commissions: true,
        },
      },
    },
  })
}

export async function listCommissions(status?: string) {
  return prisma.referralCommission.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      partner: { select: { id: true, name: true, email: true } },
      paymentOrder: { select: { id: true, packageId: true, paidAmountPaise: true } },
      reversal: true,
    },
  })
}
