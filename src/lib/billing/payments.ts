import { prisma } from '@/lib/prisma'
import { CREDIT_PACKAGES, type CreditPackageCode } from './credits'
import {
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  isRazorpayConfigured,
  verifyPaymentSignature,
  type RazorpayPaymentResponse,
} from './razorpay'

export type PaymentProvider = 'razorpay'

export interface CreateOrderInput {
  userId: string
  packageCode: CreditPackageCode
  provider?: PaymentProvider
  idempotencyKey: string
}

export interface OrderResult {
  id: string
  provider: PaymentProvider
  providerOrderId: string | null
  providerPaymentId: string | null
  packageCode: string
  credits: number
  amountPaise: number
  currency: string
  status: string
  paidAt: string | null
  verifiedAt: string | null
  createdAt: string
}

function packageByCode(code: CreditPackageCode) {
  const pkg = CREDIT_PACKAGES.find(p => p.code === code)
  if (!pkg) {
    throw new Error('INVALID_PACKAGE')
  }
  return pkg
}

function generateReceipt(internalOrderId: string): string {
  // Razorpay receipts are max 40 chars.
  return `FLY-${internalOrderId.slice(-32)}`
}

/**
 * Creates a payment order and a matching Razorpay Order. All pricing and
 * credit quantities are resolved server-side from the package catalogue.
 */
export async function createPaymentOrder(input: CreateOrderInput): Promise<OrderResult> {
  const { userId, packageCode, provider = 'razorpay', idempotencyKey } = input
  const pkg = packageByCode(packageCode)

  if (!isRazorpayConfigured()) {
    throw new Error('RAZORPAY_NOT_CONFIGURED')
  }

  return prisma.$transaction(async tx => {
    const existing = await tx.paymentOrder.findUnique({ where: { idempotencyKey } })
    if (existing) {
      // If a Razorpay order was already created, reuse it.
      return mapOrder(existing)
    }

    const account = await tx.creditAccount.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0, totalEarned: 0, totalSpent: 0 },
    })

    const internalOrder = await tx.paymentOrder.create({
      data: {
        accountId: account.id,
        provider,
        packageId: pkg.code,
        credits: pkg.credits,
        amountPaise: pkg.amountPaise,
        currency: 'INR',
        status: 'CREATED',
        idempotencyKey,
        receipt: generateReceipt('tmp'),
      },
    })

    const receipt = generateReceipt(internalOrder.id)
    const razorpayOrder = await createRazorpayOrder({
      amountPaise: pkg.amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        internalOrderId: internalOrder.id,
        packageCode: pkg.code,
        credits: String(pkg.credits),
        userId,
      },
    })

    const order = await tx.paymentOrder.update({
      where: { id: internalOrder.id },
      data: {
        providerOrderId: razorpayOrder.id,
        receipt,
      },
    })

    return mapOrder(order)
  })
}

export async function getPaymentOrders(userId: string) {
  const account = await prisma.creditAccount.findUnique({ where: { userId } })
  if (!account) return []
  const orders = await prisma.paymentOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'desc' },
  })
  return orders.map(mapOrder)
}

function mapOrder(order: {
  id: string
  provider: string
  providerOrderId: string | null
  providerPaymentId: string | null
  packageId: string
  credits: number
  amountPaise: number
  currency: string
  status: string
  paidAt: Date | null
  verifiedAt: Date | null
  createdAt: Date
}): OrderResult {
  return {
    id: order.id,
    provider: order.provider as PaymentProvider,
    providerOrderId: order.providerOrderId,
    providerPaymentId: order.providerPaymentId,
    packageCode: order.packageId,
    credits: order.credits,
    amountPaise: order.amountPaise,
    currency: order.currency,
    status: order.status,
    paidAt: order.paidAt?.toISOString() ?? null,
    verifiedAt: order.verifiedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  }
}

interface VerifyPaymentInput {
  userId: string
  internalOrderId: string
  razorpayPaymentId: string
  razorpayOrderId: string
  razorpaySignature: string
}

/**
 * Verifies a Razorpay payment signature, fetches authoritative order/payment
 * status from Razorpay, and fulfills the order if everything checks out.
 */
export async function verifyAndFulfillPayment(input: VerifyPaymentInput): Promise<OrderResult> {
  const { userId, internalOrderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = input

  const order = await prisma.paymentOrder.findFirst({
    where: { id: internalOrderId, account: { userId } },
  })
  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }
  if (order.status === 'PAID') {
    return mapOrder(order)
  }
  if (order.status !== 'CREATED') {
    throw new Error('ORDER_NOT_PAYABLE')
  }
  if (order.providerOrderId !== razorpayOrderId) {
    throw new Error('ORDER_ID_MISMATCH')
  }

  const signatureValid = verifyPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  })
  if (!signatureValid) {
    throw new Error('SIGNATURE_INVALID')
  }

  // Authoritative status checks.
  const [razorpayOrder, razorpayPayment] = await Promise.all([
    fetchRazorpayOrder(razorpayOrderId),
    fetchRazorpayPayment(razorpayPaymentId),
  ])
  if (!razorpayOrder || !razorpayPayment) {
    throw new Error('RAZORPAY_STATUS_UNAVAILABLE')
  }
  if (razorpayOrder.status !== 'paid') {
    throw new Error('ORDER_NOT_PAID')
  }
  if (razorpayPayment.status !== 'captured') {
    throw new Error('PAYMENT_NOT_CAPTURED')
  }
  if (razorpayPayment.amount !== order.amountPaise || razorpayPayment.currency !== order.currency) {
    throw new Error('AMOUNT_CURRENCY_MISMATCH')
  }

  return fulfillPaymentOrder(order.id, razorpayOrderId, razorpayPaymentId, razorpayPayment.amount)
}

export async function fulfillPaymentOrder(
  orderId: string,
  providerOrderId: string,
  providerPaymentId: string,
  paidAmountPaise: number
) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } })
  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }
  if (order.status === 'PAID') {
    return mapOrder(order)
  }
  if (order.status !== 'CREATED') {
    throw new Error('ORDER_NOT_PAYABLE')
  }

  const { grantCredits } = await import('./credits')

  return prisma.$transaction(async tx => {
    const [updated, account] = await Promise.all([
      tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          providerOrderId,
          providerPaymentId,
          paidAmountPaise,
          paidAt: new Date(),
          verifiedAt: new Date(),
        },
      }),
      tx.creditAccount.findUniqueOrThrow({ where: { id: order.accountId } }),
    ])

    await grantCredits(
      {
        userId: account.userId,
        amount: order.credits,
        description: `Purchased ${order.credits} credits via ${order.provider}`,
        idempotencyKey: `payment-${order.idempotencyKey}`,
        paymentOrderId: order.id,
        metadata: {
          packageId: order.packageId,
          amountPaise: order.amountPaise,
          paidAmountPaise,
          providerOrderId,
          providerPaymentId,
        },
      },
      tx
    )

    // Create referral commission if this user was referred by a partner.
    const { createCommissionForPayment } = await import('@/lib/referrals/referrals')
    await createCommissionForPayment(order.id, tx).catch(error => {
      // Commission creation must never fail the payment fulfillment.
      console.error('Referral commission creation failed:', error)
    })

    return mapOrder(updated)
  })
}

export async function processWebhookPaymentCaptured(
  payment: RazorpayPaymentResponse
): Promise<OrderResult | null> {
  if (!payment.order_id || payment.status !== 'captured') return null

  const order = await prisma.paymentOrder.findUnique({
    where: { providerOrderId: payment.order_id },
  })
  if (!order) return null
  if (order.status === 'PAID') {
    return mapOrder(order)
  }
  if (order.status !== 'CREATED') return null
  if (payment.amount !== order.amountPaise || payment.currency !== order.currency) return null

  return fulfillPaymentOrder(order.id, payment.order_id, payment.id, payment.amount)
}

/**
 * Refunds a paid order through Razorpay and reverses the granted credits.
 * Only full refunds of the paid amount are supported in this implementation.
 */
export async function refundPaymentOrder(userId: string, orderId: string) {
  const order = await prisma.paymentOrder.findFirst({
    where: { id: orderId, account: { userId } },
  })
  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }
  if (order.status !== 'PAID') {
    throw new Error('ORDER_NOT_REFUNDABLE')
  }
  if (!order.providerPaymentId || !order.paidAmountPaise) {
    throw new Error('ORDER_MISSING_PAYMENT')
  }

  const refund = await createRazorpayRefund(order.providerPaymentId, order.paidAmountPaise)
  if (!refund) {
    throw new Error('RAZORPAY_REFUND_FAILED')
  }

  const { reverseGrant } = await import('./credits')

  return prisma.$transaction(async tx => {
    const updated = await tx.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', metadata: { refund: refund as unknown as import('@prisma/client').Prisma.InputJsonValue } },
    })
    await reverseGrant(
      {
        userId,
        paymentOrderId: order.id,
        amount: order.credits,
        description: `Refunded ${order.credits} credits for ${order.packageId}`,
        idempotencyKey: `refund-${order.idempotencyKey}`,
        metadata: {
          packageId: order.packageId,
          paidAmountPaise: order.paidAmountPaise,
          refundId: refund.id,
          providerPaymentId: order.providerPaymentId,
        },
      },
      tx
    )

    // Reverse any referral commission tied to this payment.
    const { reverseCommissionForRefund } = await import('@/lib/referrals/referrals')
    await reverseCommissionForRefund(order.id, tx).catch(error => {
      console.error('Referral commission reversal failed:', error)
    })

    return mapOrder(updated)
  })
}
