import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUserId } from '@/lib/billing/auth'
import { verifyAndFulfillPayment } from '@/lib/billing/payments'
import { logInternalApiError } from '@/lib/api-errors'

export const dynamic = 'force-dynamic'

const verifySchema = z.object({
  internalOrderId: z.string().min(1).max(80),
  razorpayPaymentId: z.string().min(1).max(80),
  razorpayOrderId: z.string().min(1).max(80),
  razorpaySignature: z.string().min(1).max(512),
})

export async function POST(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid verification payload.' }, { status: 400 })
  }

  try {
    const order = await verifyAndFulfillPayment({
      userId,
      internalOrderId: parsed.data.internalOrderId,
      razorpayPaymentId: parsed.data.razorpayPaymentId,
      razorpayOrderId: parsed.data.razorpayOrderId,
      razorpaySignature: parsed.data.razorpaySignature,
    })
    return NextResponse.json({ order })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed'
    const status = statusForError(message)
    if (status === 500) {
      return NextResponse.json(logInternalApiError('payment verification', error), { status })
    }
    return NextResponse.json({ error: message }, { status })
  }
}

function statusForError(message: string): number {
  switch (message) {
    case 'ORDER_NOT_FOUND':
      return 404
    case 'ORDER_NOT_PAYABLE':
    case 'ORDER_ID_MISMATCH':
    case 'SIGNATURE_INVALID':
    case 'AMOUNT_CURRENCY_MISMATCH':
    case 'ORDER_NOT_PAID':
    case 'PAYMENT_NOT_CAPTURED':
      return 400
    case 'RAZORPAY_STATUS_UNAVAILABLE':
      return 503
    default:
      return 500
  }
}
