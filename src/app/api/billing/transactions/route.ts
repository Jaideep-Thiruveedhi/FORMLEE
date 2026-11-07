import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUserId } from '@/lib/billing/auth'
import { getLedgerHistory } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    take: searchParams.get('take'),
    skip: searchParams.get('skip'),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid pagination.' }, { status: 400 })
  }

  const entries = await getLedgerHistory(userId, parsed.data.take, parsed.data.skip)
  return NextResponse.json({ entries })
}
