import { requireUserId } from '@/lib/billing/auth'
import { prisma } from '@/lib/prisma'

export async function requireAuthUserId(): Promise<string | null> {
  return requireUserId()
}

export async function requireAdmin(): Promise<{ userId: string } | null> {
  const userId = await requireUserId()
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role !== 'ADMIN') return null
  return { userId }
}

export async function requirePartner(): Promise<{ userId: string; partnerId: string } | null> {
  const userId = await requireUserId()
  if (!userId) return null
  const partner = await prisma.referralPartner.findUnique({
    where: { userId },
    select: { id: true, isActive: true },
  })
  if (!partner || !partner.isActive) return null
  return { userId, partnerId: partner.id }
}

export async function getPartnerByUserId(userId: string) {
  return prisma.referralPartner.findUnique({ where: { userId } })
}
