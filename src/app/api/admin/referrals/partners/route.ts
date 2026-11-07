import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/referrals/auth'
import { createPartner, listPartners } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.email(),
  phone: z.string().max(20).optional(),
  tier: z.enum(['STUDENT_AMBASSADOR', 'CAMPUS_REPRESENTATIVE', 'MARKETING_PARTNER']).optional(),
  commissionBasisPoints: z.number().int().min(0).max(5000).optional(),
  holdingDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(500).optional(),
})

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const partners = await listPartners()
  return NextResponse.json({ partners })
}

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

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid partner payload.' }, { status: 400 })
  }

  try {
    const partner = await createPartner(parsed.data)
    return NextResponse.json({ partner })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create partner'
    if (message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'A partner with this email or code already exists.' }, { status: 409 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
