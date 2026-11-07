import { NextRequest, NextResponse } from 'next/server'
import { resolveAgentSession } from '@/lib/agent/session'
import { verifyApproval, hashSingleValue, rejectExpiredApproval } from '@/lib/agent/approval'
import { releaseCredit } from '@/lib/billing/credits'
import { resolveAgentValues } from '@/lib/agent/values'
import { prisma } from '@/lib/prisma'

/**
 * Extension-side fill pre-check.
 *
 * Before the content script writes any field, the service worker asks the
 * server to verify the durable approval record. The server checks workspace,
 * agent session, adapter, page fingerprint and approved field list, then marks
 * the approval USED. This is the server-side half of the fill authorization;
 * the extension-side plan/fingerprint checks remain in place.
 */
export async function POST(request: NextRequest) {
  const session = await resolveAgentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Agent session missing or expired.', code: 'AGENT_SESSION_INVALID' },
      { status: 401 }
    )
  }

  const body = (await request.json().catch(() => null)) as unknown
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Malformed request.', code: 'MALFORMED_REQUEST' }, { status: 400 })
  }
  const { approvalRef, adapterId, pageUrl, pageFingerprint, approved } = body as {
    approvalRef?: unknown
    adapterId?: unknown
    pageUrl?: unknown
    pageFingerprint?: unknown
    approved?: unknown
  }

  if (
    typeof approvalRef !== 'string' ||
    !/^[0-9a-f]{64}$/.test(approvalRef) ||
    typeof adapterId !== 'string' ||
    adapterId.length > 80 ||
    typeof pageUrl !== 'string' ||
    pageUrl.length > 2048 ||
    typeof pageFingerprint !== 'string' ||
    pageFingerprint.length === 0 ||
    pageFingerprint.length > 256 ||
    !Array.isArray(approved) ||
    approved.length > 120
  ) {
    return NextResponse.json({ error: 'approvalRef, adapterId, pageUrl, pageFingerprint and approved are required.', code: 'MALFORMED_REQUEST' }, { status: 400 })
  }

  const cleanApproved = approved.filter(
    (item): item is { index: number; canonical: string } =>
      !!item && typeof item === 'object' && typeof (item as { index?: unknown }).index === 'number' && typeof (item as { canonical?: unknown }).canonical === 'string'
  )
  if (cleanApproved.length !== approved.length || cleanApproved.length === 0) {
    return NextResponse.json({ error: 'Approved field identifiers are malformed.', code: 'MALFORMED_REQUEST' }, { status: 400 })
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: session.workspaceId }, select: { userId: true } })
  if (!workspace?.userId) {
    return NextResponse.json({ error: 'Workspace is unavailable.', code: 'CROSS_WORKSPACE' }, { status: 403 })
  }
  // Fetch expired approvals as well: filtering them out here used to make the
  // expiry transition below unreachable from the extension verification path.
  const approval = await prisma.agentToolApproval.findFirst({
    where: {
      id: approvalRef,
      workspaceId: session.workspaceId,
      userId: workspace.userId,
      agentSessionId: session.token,
      status: 'FILL_REQUESTED',
      revokedAt: null,
    },
    select: { id: true, expiresAt: true },
  })
  if (approval && approval.expiresAt.getTime() <= Date.now()) {
    await rejectExpiredApproval({
      approvalRef,
      workspaceId: session.workspaceId,
      agentSessionId: session.token,
    })
    const expiredReservation = await prisma.creditReservation.findFirst({
      where: {
        workspaceId: session.workspaceId,
        account: { userId: workspace.userId },
        status: 'PENDING',
        OR: [
          { idempotencyKey: approvalRef, agentSessionId: session.token },
          { legacyAgentSessionOrIdempotencyKey: approvalRef, agentSessionId: null },
        ],
      },
      select: { id: true },
    })
    if (expiredReservation) {
      await releaseCredit({
        reservationId: expiredReservation.id,
        userId: workspace.userId,
        workspaceId: session.workspaceId,
        agentSessionId: session.token,
        description: 'Released reservation for expired approval',
      })
    }
    return NextResponse.json({ error: 'Approval expired. Scan again and re-approve.', code: 'APPROVAL_EXPIRED' }, { status: 409 })
  }
  const reservation = approval && await prisma.creditReservation.findFirst({
    where: {
      workspaceId: session.workspaceId,
      account: { userId: workspace.userId },
      status: 'PENDING',
      OR: [
        { idempotencyKey: approvalRef, agentSessionId: session.token },
        { legacyAgentSessionOrIdempotencyKey: approvalRef, agentSessionId: null },
      ],
    },
    select: { id: true },
  })
  if (!approval || !reservation) {
    return NextResponse.json({ error: 'The approval has no matching pending reservation.', code: 'APPROVAL_INVALID' }, { status: 409 })
  }
  const canonicals = [...new Set(cleanApproved.map(item => item.canonical))]
  const valueResult = await resolveAgentValues(session.workspaceId, canonicals)
  const valueFingerprint = canonicals.map(canonical => ({
    canonical,
    hash: hashSingleValue(valueResult.values[canonical]),
  }))

  const result = await verifyApproval({
    approvalRef,
    workspaceId: session.workspaceId,
    agentSessionId: session.token,
    adapterId,
    pageUrl,
    pageFingerprint,
    approved: cleanApproved,
    valueFingerprint,
  })

  if (!result.ok) {
    const status =
      result.code === 'APPROVAL_NOT_FOUND' ? 404 :
      result.code === 'CROSS_WORKSPACE' ? 403 :
      409
    return NextResponse.json(result, { status })
  }

  return NextResponse.json({ ok: true, approval: result.approval })
}
