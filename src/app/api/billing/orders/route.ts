import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUserId } from '@/lib/billing/auth'
import { createPaymentOrder, getPaymentOrders } from '@/lib/billing/payments'
import { CREDIT_PACKAGES } from '@/lib/billing/credits'
import { isRazorpayConfigured } from '@/lib/billing/razorpay'

export const dynamic = 'force-dynamic'

const packageCodes = CREDIT_PACKAGES.map(p => p.code) as ['STARTER', 'VALUE', 'PRO']
const createOrderSchema = z.object({
  packageCode: z.enum(packageCodes),
})

export async function GET() {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const orders = await getPaymentOrders(userId)
  return NextResponse.json({ orders })
}

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

  const parsed = createOrderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid package code.' }, { status: 400 })
  }

  // Idempotency key is derived from user + package + a daily bucket so repeated
  // clicks within the same day do not create duplicate CREATED orders. Clients
  // can also supply their own key if they prefer.
  const idempotencyKey = `user-${userId}-pkg-${parsed.data.packageCode}-${new Date().toISOString().slice(0, 10)}`

  try {
    const order = await createPaymentOrder({
      userId,
      packageCode: parsed.data.packageCode as 'STARTER' | 'VALUE' | 'PRO',
      idempotencyKey,
    })
    return NextResponse.json({
      order,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? null,
      configured: isRazorpayConfigured(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create order'
    if (message === 'INVALID_PACKAGE') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (message === 'RAZORPAY_NOT_CONFIGURED') {
      return NextResponse.json({ error: message, configured: false }, { status: 503 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
