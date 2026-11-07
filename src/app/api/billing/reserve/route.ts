import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import { resolveWorkspaceContext } from '@/lib/apply-ai/workspace'
import { reserveCredit } from '@/lib/billing/credits'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const reserveSchema = z.object({
  applicationId: z.string().min(1).max(80).optional(),
  idempotencyKey: z.string().min(1).max(128),
})

export async function POST(request: NextRequest) {
  // Fill-flow credit boundary: user session or scoped agent session only.
  const auth = await requireFillCreditAuth()
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let workspaceId: string
  if (auth.kind === 'agent') {
    workspaceId = auth.workspaceId
  } else {
    const workspace = await resolveWorkspaceContext()
    if (workspace.mode === 'empty' || workspace.mode === 'signed-in-empty') {
      return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
    }
    workspaceId = workspace.workspaceId
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = reserveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid reservation payload.' }, { status: 400 })
  }

  if (auth.kind === 'agent') {
    const approval = /^[0-9a-f]{64}$/.test(parsed.data.idempotencyKey)
      ? await prisma.agentToolApproval.findFirst({
          where: {
            id: parsed.data.idempotencyKey,
            workspaceId,
            userId: auth.userId,
            agentSessionId: auth.agentToken,
            status: 'FILL_REQUESTED',
            expiresAt: { gt: new Date() },
            revokedAt: null,
          },
          select: { id: true },
        })
      : null
    if (!approval) {
      return NextResponse.json({ error: 'A live approval from this AgentSession is required.', code: 'APPROVAL_INVALID' }, { status: 409 })
    }
  }

  try {
    const reservation = await reserveCredit({
      userId: auth.userId,
      workspaceId,
      agentSessionId: auth.kind === 'agent' ? auth.agentToken : null,
      applicationId: parsed.data.applicationId,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ reservation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reservation failed'
    if (message === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json(
        { error: 'You do not have any application credits left.', code: 'INSUFFICIENT_CREDITS' },
        { status: 402 }
      )
    }
    if (message === 'LEGACY_RESERVATION_REQUIRES_RECOVERY' || message === 'IDEMPOTENCY_KEY_CONFLICT') {
      return NextResponse.json({ error: 'This reservation key cannot be reused safely. Recover or release the outstanding reservation first.', code: message }, { status: 409 })
    }
    if (message === 'WORKSPACE_FORBIDDEN') {
      return NextResponse.json({ error: 'Workspace access denied.', code: 'CROSS_WORKSPACE' }, { status: 403 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
