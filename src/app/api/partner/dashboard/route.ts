import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import { requirePartner } from '@/lib/referrals/auth'
import { getPartnerDashboard } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

export async function GET() {
  const partner = await requirePartner()
  if (!partner) {
    return NextResponse.json({ error: 'Partner access required' }, { status: 403 })
  }

  try {
    const dashboard = await getPartnerDashboard(partner.partnerId)
    return NextResponse.json(dashboard)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load dashboard'
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
