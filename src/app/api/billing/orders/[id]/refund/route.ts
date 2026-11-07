import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireUserId } from '@/lib/billing/auth'
import { refundPaymentOrder } from '@/lib/billing/payments'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { id } = await params
  try {
    const order = await refundPaymentOrder(userId, id)
    return NextResponse.json({ order })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refund failed'
    if (message === 'ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }
    if (message === 'ORDER_NOT_REFUNDABLE') {
      return NextResponse.json({ error: 'This order cannot be refunded.' }, { status: 409 })
    }
    if (message === 'INSUFFICIENT_BALANCE_FOR_REFUND') {
      return NextResponse.json(
        { error: 'Credits from this order have already been spent and cannot be reversed.' },
        { status: 409 }
      )
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
