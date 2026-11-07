import { NextResponse } from 'next/server'
import { requireUserId } from '@/lib/billing/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST() {
  const userId = await requireUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user?.email) {
    return NextResponse.json({ error: 'User email not found' }, { status: 400 })
  }

  const partner = await prisma.referralPartner.findUnique({
    where: { email: user.email.toLowerCase() },
  })
  if (!partner) {
    return NextResponse.json({ error: 'No partner record matches this email.' }, { status: 404 })
  }
  if (partner.userId && partner.userId !== userId) {
    return NextResponse.json({ error: 'Partner account is already linked.' }, { status: 409 })
  }

  await prisma.referralPartner.update({
    where: { id: partner.id },
    data: { userId },
  })

  return NextResponse.json({ partner: { id: partner.id, name: partner.name } })
}
