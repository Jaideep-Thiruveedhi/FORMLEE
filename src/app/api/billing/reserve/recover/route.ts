import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import { resolveWorkspaceContext } from '@/lib/apply-ai/workspace'
import { prisma } from '@/lib/prisma'
import { releaseCredit } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const recoverySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lookup'), approvalRef: z.string().min(1).max(128) }),
  z.object({ action: z.literal('release'), reservationId: z.string().min(1).max(128) }),
])

async function workspaceFor(auth: NonNullable<Awaited<ReturnType<typeof requireFillCreditAuth>>>) {
  if (auth.kind === 'agent') return auth.workspaceId
  const workspace = await resolveWorkspaceContext()
  if (workspace.mode === 'empty' || workspace.mode === 'signed-in-empty') return null
  return workspace.workspaceId
}

export async function GET() {
  const auth = await requireFillCreditAuth()
  if (!auth) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const workspaceId = await workspaceFor(auth)
  if (!workspaceId) return NextResponse.json({ error: 'Workspace not initialised.' }, { status: 401 })

  const reservations = await prisma.creditReservation.findMany({
    where: { workspaceId, status: 'PENDING', account: { userId: auth.userId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, createdAt: true, expiresAt: true },
  })
  return NextResponse.json({ reservations })
}

export async function POST(request: NextRequest) {
  const auth = await requireFillCreditAuth()
  if (!auth) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  const workspaceId = await workspaceFor(auth)
  if (!workspaceId) return NextResponse.json({ error: 'Workspace not initialised.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = recoverySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid recovery request.' }, { status: 400 })

  if (parsed.data.action === 'lookup') {
    // Lookup is deliberately session-bound for agents. A new AgentSession
    // cannot inherit an old approval or retrieve its reservation by approvalRef.
    if (auth.kind === 'agent') {
      const approval = await prisma.agentToolApproval.findFirst({
        where: {
          id: parsed.data.approvalRef,
          workspaceId,
          userId: auth.userId,
          agentSessionId: auth.agentToken,
          status: 'FILL_REQUESTED',
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        select: { id: true },
      })
      if (!approval) return NextResponse.json({ error: 'The original live approval is required for recovery.', code: 'APPROVAL_INVALID' }, { status: 409 })
    }
    const reservation = await prisma.creditReservation.findFirst({
      where: {
        workspaceId,
        account: { userId: auth.userId },
        status: 'PENDING',
        OR: auth.kind === 'agent'
          ? [
              { idempotencyKey: parsed.data.approvalRef, agentSessionId: auth.agentToken },
              { legacyAgentSessionOrIdempotencyKey: parsed.data.approvalRef, agentSessionId: null },
            ]
          : [{ idempotencyKey: parsed.data.approvalRef, agentSessionId: null }],
      },
      select: { id: true, amount: true, status: true, createdAt: true },
    })
    if (!reservation) return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 })
    return NextResponse.json({ reservation })
  }

  try {
    const reservation = await releaseCredit({
      reservationId: parsed.data.reservationId,
      userId: auth.userId,
      workspaceId,
      agentSessionId: auth.kind === 'agent' ? auth.agentToken : undefined,
      description: 'Released outstanding reservation through authenticated recovery',
    })
    return NextResponse.json({ reservation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recovery failed'
    if (message === 'RESERVATION_NOT_FOUND') return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 })
    if (
      message === 'RESERVATION_NOT_PENDING' ||
      message === 'APPROVAL_VERIFIED_CANNOT_RELEASE' ||
      message === 'LEGACY_RESERVATION_REQUIRES_RECONCILIATION' ||
      message === 'RESERVATION_SESSION_MISMATCH'
    ) {
      return NextResponse.json({ error: 'This reservation cannot be released through recovery.', code: message }, { status: 409 })
    }
    return NextResponse.json({ error: 'Reservation recovery failed.' }, { status: 500 })
  }
}
