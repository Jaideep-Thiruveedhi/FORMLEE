import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/referrals/auth'
import { generatePartnerCode } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const codeSchema = z.object({
  code: z.string().min(3).max(20),
})

export async function POST(
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

  const parsed = codeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid code payload.' }, { status: 400 })
  }

  const { id } = await params
  try {
    const code = await generatePartnerCode(id, parsed.data.code)
    return NextResponse.json({ code })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create code'
    if (message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'This referral code is already in use.' }, { status: 409 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
