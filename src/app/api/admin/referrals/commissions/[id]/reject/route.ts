import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/referrals/auth'
import { rejectCommission } from '@/lib/referrals/referrals'

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
    const commission = await rejectCommission(id)
    return NextResponse.json({ commission })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reject commission'
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
