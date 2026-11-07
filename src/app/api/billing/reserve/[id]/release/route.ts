import { logInternalApiError } from '@/lib/api-errors'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import { releaseCredit } from '@/lib/billing/credits'
import { resolveWorkspaceContext } from '@/lib/apply-ai/workspace'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Fill-flow credit boundary: user session or scoped agent session only.
  const auth = await requireFillCreditAuth()
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { id } = await params
  let workspaceId: string
  if (auth.kind === 'agent') {
    workspaceId = auth.workspaceId
  } else {
    const workspace = await resolveWorkspaceContext()
    if (workspace.mode === 'empty' || workspace.mode === 'signed-in-empty') {
      return NextResponse.json({ error: 'Workspace not initialised.' }, { status: 401 })
    }
    workspaceId = workspace.workspaceId
  }
  try {
    // Agent callers are bound to reservations created inside their own
    // workspace; user sessions act on their own account as before.
    const reservation = await releaseCredit({
      reservationId: id,
      userId: auth.userId,
      workspaceId,
      agentSessionId: auth.kind === 'agent' ? auth.agentToken : undefined,
    })
    return NextResponse.json({ reservation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Release failed'
    if (message === 'RESERVATION_NOT_FOUND') {
      return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 })
    }
    if (message === 'RESERVATION_NOT_PENDING') {
      return NextResponse.json({ error: 'Reservation is no longer pending.' }, { status: 409 })
    }
    if (message === 'LEGACY_RESERVATION_REQUIRES_RECONCILIATION' || message === 'RESERVATION_SESSION_MISMATCH') {
      return NextResponse.json({ error: 'This historical reservation requires owner reconciliation.', code: message }, { status: 409 })
    }
    if (message === 'APPROVAL_VERIFIED_CANNOT_RELEASE') {
      return NextResponse.json({ error: 'A verified fill must be finalized through the approval-bound consume endpoint.', code: message }, { status: 409 })
    }
    return NextResponse.json(logInternalApiError('unexpected request failure', error), { status: 500 })
  }
}
