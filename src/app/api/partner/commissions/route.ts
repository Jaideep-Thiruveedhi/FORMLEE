import { NextResponse } from 'next/server'
import { requirePartner } from '@/lib/referrals/auth'
import { getPartnerCommissions } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

export async function GET() {
  const partner = await requirePartner()
  if (!partner) {
    return NextResponse.json({ error: 'Partner access required' }, { status: 403 })
  }

  const commissions = await getPartnerCommissions(partner.partnerId)
  return NextResponse.json({ commissions })
}
