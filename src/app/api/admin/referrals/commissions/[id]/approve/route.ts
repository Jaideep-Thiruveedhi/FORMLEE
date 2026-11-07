import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/referrals/auth'
import { approveCommission } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { id } = await params
  try {
    const commission = await approveCommission(id)
    return NextResponse.json({ commission })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not approve commission'
    if (message === 'COMMISSION_NOT_FOUND') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message === 'COMMISSION_NOT_PENDING' || message === 'HOLDING_PERIOD_NOT_EXPIRED') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
