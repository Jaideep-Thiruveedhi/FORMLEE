import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { recordReferralClick, REFERRAL_COOKIE, REFERRAL_ATTRIBUTION_DAYS } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const clickSchema = z.object({
  code: z.string().min(1).max(40),
  source: z.string().max(80).optional(),
})

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parsed = clickSchema.safeParse({
    code: searchParams.get('code'),
    source: searchParams.get('source') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid referral code.' }, { status: 400 })
  }

  // Forwarded headers must be overwritten by the selected host's trusted proxy.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const userAgent = request.headers.get('user-agent') ?? undefined
  const landingPath = request.nextUrl.pathname + request.nextUrl.search

  const result = await recordReferralClick({
    code: parsed.data.code.toUpperCase(),
    ip,
    userAgent,
    source: parsed.data.source,
    landingPath,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Set an httpOnly cookie that the claim endpoint can read after registration.
  const cookieStore = await cookies()
  cookieStore.set(REFERRAL_COOKIE, result.code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60,
    path: '/',
  })

  return NextResponse.json({ ok: true, code: result.code })
}
