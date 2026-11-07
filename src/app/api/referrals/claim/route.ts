import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { getAuth } from '@/lib/auth'
import { claimReferralAttribution, REFERRAL_COOKIE } from '@/lib/referrals/referrals'

export const dynamic = 'force-dynamic'

const claimSchema = z.object({
  code: z.string().min(1).max(40).optional(),
})

export async function POST(request: NextRequest) {
  const authHeaders = request.headers
  const session = await getAuth().api.getSession({ headers: authHeaders })
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = claimSchema.safeParse(body)

  const cookieStore = await cookies()
  const cookieCode = cookieStore.get(REFERRAL_COOKIE)?.value
  const code = parsed.data?.code?.toUpperCase() ?? cookieCode

  const result = await claimReferralAttribution({
    userId: session.user.id,
    userEmail: session.user.email,
    code,
  })

  // Clear the referral cookie regardless of outcome so it is not reused.
  cookieStore.set(REFERRAL_COOKIE, '', { maxAge: 0, path: '/' })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ attribution: result.attribution, alreadyAttributed: result.alreadyAttributed })
}
