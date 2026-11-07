import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/referrals/auth'
import { recordPayout } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const payoutSchema = z.object({
  partnerId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  commissionIds: z.array(z.string().min(1)).min(1),
  method: z.string().max(40).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = payoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payout payload.' }, { status: 400 })
  }

  try {
    const payout = await recordPayout(parsed.data)
    return NextResponse.json({ payout })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not record payout'
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
