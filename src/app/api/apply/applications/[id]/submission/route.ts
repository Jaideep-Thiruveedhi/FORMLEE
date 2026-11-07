import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { withEvaluation } from '@/lib/apply-ai/applications'
import { loadWorkspaceVaultWithDimensions } from '@/lib/apply-ai/server-data'

const submissionSchema = z.object({
  action: z.enum(['CONFIRM_STUDENT_SUBMITTED', 'RECORD_PORTAL_CONFIRMATION', 'CLEAR']),
  confirmed: z.boolean().optional(),
  portalReference: z.string().trim().min(2).max(120).optional(),
})

async function workspaceData(workspaceId: string) {
  const vault = await loadWorkspaceVaultWithDimensions(workspaceId)
  return {
    profile: vault.profileRow,
    documents: vault.documents,
    documentDimensions: vault.documentDimensions,
  }
}

/**
 * Explicit submission actions. A status change to "submitted" is never inferred
 * from field-filling, checklist completion or agent activity:
 *
 *  - CONFIRM_STUDENT_SUBMITTED: the student confirms they submitted on the portal.
 *  - RECORD_PORTAL_CONFIRMATION: the student records a portal acknowledgement
 *    reference. Formly still does not verify it with the examination body.
 *  - CLEAR: removes a mistaken submission record and returns to review.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await prisma.examApplication.findFirst({ where: { id, workspaceId } })
  if (!row) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = submissionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid submission action' }, { status: 400 })
  }

  const now = new Date()
  let data: Record<string, unknown>

  switch (parsed.data.action) {
    case 'CONFIRM_STUDENT_SUBMITTED':
      if (parsed.data.confirmed !== true) {
        return NextResponse.json(
          { error: 'Tick the confirmation box to record that you submitted on the official portal.' },
          { status: 400 }
        )
      }
      data = {
        status: row.portalReferenceRecordedAt
          ? 'PORTAL_CONFIRMATION_RECORDED'
          : 'SUBMITTED_STUDENT_CONFIRMED',
        studentSubmittedAt: row.studentSubmittedAt ?? now,
      }
      break

    case 'RECORD_PORTAL_CONFIRMATION': {
      if (parsed.data.confirmed !== true) {
        return NextResponse.json(
          { error: 'Tick the confirmation box to record the portal acknowledgement.' },
          { status: 400 }
        )
      }
      if (!parsed.data.portalReference) {
        return NextResponse.json(
          { error: 'Enter the application number or acknowledgement reference shown by the official portal.' },
          { status: 400 }
        )
      }
      data = {
        status: 'PORTAL_CONFIRMATION_RECORDED',
        studentSubmittedAt: row.studentSubmittedAt ?? now,
        portalReferenceRecordedAt: now,
        portalReference: parsed.data.portalReference,
      }
      break
    }

    case 'CLEAR':
      if (parsed.data.confirmed !== true) {
        return NextResponse.json(
          { error: 'Tick the confirmation box to clear the submission record.' },
          { status: 400 }
        )
      }
      data = {
        status: 'FILLED_AWAITING_STUDENT_REVIEW',
        studentSubmittedAt: null,
        portalReferenceRecordedAt: null,
        portalReference: null,
      }
      break
  }

  const updated = await prisma.examApplication.update({
    where: { id: row.id },
    data,
  })
  const workspace = await workspaceData(workspaceId)

  return NextResponse.json({
    application: withEvaluation(updated, workspace.profile, workspace.documents, workspace.documentDimensions),
  })
}
