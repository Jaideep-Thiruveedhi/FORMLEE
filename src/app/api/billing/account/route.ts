import { NextResponse } from 'next/server'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import { getCreditAccount, getActiveReservations } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Fill-flow credit boundary: accepts a user session OR a valid agent
  // session scoped to its own workspace (see lib/billing/auth). Returns
  // balance counts only — no profile data, no user identity.
  const auth = await requireFillCreditAuth()
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const account = await getCreditAccount(auth.userId)
  const reservations = await getActiveReservations(auth.userId)

  return NextResponse.json({
    balance: account?.balance ?? 0,
    totalEarned: account?.totalEarned ?? 0,
    totalSpent: account?.totalSpent ?? 0,
    activeReservations: reservations.length,
  })
}
