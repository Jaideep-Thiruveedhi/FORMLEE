import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import { processWebhookPaymentCaptured } from '@/lib/billing/payments'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Razorpay webhook receiver.
 *
 * - Reads the raw request body for signature verification.
 * - Verifies the X-Razorpay-Signature using HMAC-SHA256.
 * - Persists every verified event keyed by Razorpay event id to prevent duplicates.
 * - Processes payment.captured / order.paid idempotently.
 * - Always returns 200 for verified, persisted events so Razorpay stops retrying.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const rawBody = await request.text()

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const signatureValid = verifyWebhookSignature({ rawBody, signature })
  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const event = parseWebhookPayload(payload)
  if (!event) {
    return NextResponse.json({ error: 'Unrecognised payload shape' }, { status: 400 })
  }

  // Persist the verified event. The unique eventId prevents duplicate processing
  // and out-of-order delivery issues.
  const persisted = await prisma.razorpayWebhookEvent
    .upsert({
      where: { eventId: event.eventId },
      update: {},
      create: {
        eventId: event.eventId,
        event: event.event,
        rawBody,
        payload: payload as object,
        signature,
      },
    })
    .catch(error => {
      // If another worker already inserted the event, swallow the unique-key
      // violation and continue.
      if (isUniqueViolation(error)) return null
      throw error
    })

  // If this event was already processed, acknowledge immediately.
  if (persisted?.processed) {
    return NextResponse.json({ received: true, alreadyProcessed: true })
  }

  // Process supported events.
  try {
    if (event.event === 'payment.captured' && event.payment) {
      await processWebhookPaymentCaptured(event.payment)
    } else if (event.event === 'order.paid' && event.payment) {
      await processWebhookPaymentCaptured(event.payment)
    }
    // payment.failed is intentionally ignored as a single failed attempt does
    // not invalidate the order; the student can retry with the same order id.
  } catch (error) {
    // Acknowledge the webhook so Razorpay stops retrying, but do not mark the
    // event processed. A background retry / manual reconciliation can pick it up.
    const rawName = error instanceof Error ? error.name : ''
    const name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(rawName) ? rawName : 'UnknownError'
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined
    console.error('[webhook] Razorpay event processing failed', { name, code })
    return NextResponse.json({ received: true, processed: false }, { status: 200 })
  }

  // Mark the event processed if we reach here successfully.
  if (persisted) {
    await prisma.razorpayWebhookEvent.update({
      where: { id: persisted.id },
      data: { processed: true, processedAt: new Date() },
    })
  }

  return NextResponse.json({ received: true, processed: true })
}

function parseWebhookPayload(payload: unknown):
  | {
      eventId: string
      event: string
      payment?: {
        id: string
        order_id: string
        amount: number
        currency: string
        status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
      }
    }
  | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  const eventId = typeof obj.id === 'string' ? obj.id : ''
  const event = typeof obj.event === 'string' ? obj.event : ''
  if (!eventId || !event) return null

  const entity = obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>).payment : null
  if (!entity || typeof entity !== 'object') {
    return { eventId, event }
  }

  const payment = entity as Record<string, unknown>
  const paymentId = typeof payment.id === 'string' ? payment.id : ''
  const orderId = typeof payment.order_id === 'string' ? payment.order_id : ''
  const status = payment.status
  if (
    !paymentId ||
    !orderId ||
    !['created', 'authorized', 'captured', 'refunded', 'failed'].includes(String(status))
  ) return null
  return {
    eventId,
    event,
    payment: {
      id: paymentId,
      order_id: orderId,
      amount: typeof payment.amount === 'number' ? payment.amount : 0,
      currency: typeof payment.currency === 'string' ? payment.currency : '',
      status: status as 'created' | 'authorized' | 'captured' | 'refunded' | 'failed',
    },
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}
