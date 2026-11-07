import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/referrals/auth'
import { togglePartnerActive } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const toggleSchema = z.object({
  isActive: z.boolean(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid toggle payload.' }, { status: 400 })
  }

  const { id } = await params
  try {
    const partner = await togglePartnerActive(id, parsed.data.isActive)
    return NextResponse.json({ partner })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update partner'
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
