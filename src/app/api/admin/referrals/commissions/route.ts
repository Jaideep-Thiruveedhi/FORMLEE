import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/referrals/auth'
import { listCommissions } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REVERSED']).optional(),
})

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({ status: searchParams.get('status') ?? undefined })
  const commissions = await listCommissions(parsed.data?.status)
  return NextResponse.json({ commissions })
}
