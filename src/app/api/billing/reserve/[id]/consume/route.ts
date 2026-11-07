import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import { consumeCredit, consumeVerifiedAgentCredit } from '@/lib/billing/credits'
import { resolveWorkspaceContext } from '@/lib/apply-ai/workspace'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Fill-flow credit boundary: user session or scoped agent session only.
  const auth = await requireFillCreditAuth()
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { id } = await params
  let userWorkspaceId: string | undefined
  if (auth.kind === 'user') {
    const workspace = await resolveWorkspaceContext()
    if (workspace.mode === 'empty' || workspace.mode === 'signed-in-empty') {
      return NextResponse.json({ error: 'Workspace not initialised.' }, { status: 401 })
    }
    userWorkspaceId = workspace.workspaceId
  }
  try {
    let reservation: Awaited<ReturnType<typeof consumeCredit>>
    if (auth.kind === 'agent') {
      const body = await request.json().catch(() => null) as { approvalRef?: unknown; pageFingerprint?: unknown } | null
      if (
        !body ||
        typeof body.approvalRef !== 'string' ||
        !/^[0-9a-f]{64}$/.test(body.approvalRef) ||
        typeof body.pageFingerprint !== 'string' ||
        body.pageFingerprint.length === 0 ||
        body.pageFingerprint.length > 256
      ) {
        return NextResponse.json({ error: 'A valid approval reference and page fingerprint are required.', code: 'APPROVAL_INVALID' }, { status: 400 })
      }
      reservation = await consumeVerifiedAgentCredit({
        reservationId: id,
        approvalRef: body.approvalRef,
        pageFingerprint: body.pageFingerprint,
        userId: auth.userId,
        workspaceId: auth.workspaceId,
        agentSessionId: auth.agentToken,
      })
    } else {
      reservation = await consumeCredit({ reservationId: id, userId: auth.userId, workspaceId: userWorkspaceId })
    }
    return NextResponse.json({ reservation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Consume failed'
    if (message === 'RESERVATION_NOT_FOUND') {
      return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 })
    }
    if (message === 'RESERVATION_NOT_PENDING') {
      return NextResponse.json({ error: 'Reservation is no longer pending.' }, { status: 409 })
    }
    if (message === 'AGENT_APPROVAL_REQUIRED' || message === 'APPROVAL_INVALID' || message === 'VERIFICATION_RECEIPT_REQUIRED' || message === 'APPROVAL_NOT_VERIFIED' || message === 'APPROVAL_EXPIRED') {
      return NextResponse.json({ error: 'A matching live approval and verified readback receipt are required.', code: message }, { status: 409 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
