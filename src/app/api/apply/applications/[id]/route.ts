import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { EXAM_BY_ID, findExamSession } from '@/lib/apply-ai/exams'
import { normalizeChecklist, withEvaluation } from '@/lib/apply-ai/applications'
import { HUB_APPLICATION_STATUSES, isSubmissionStatus } from '@/lib/apply-ai/application-status'
import {
  loadWorkspaceVaultWithDimensions,
  refreshApplicationSnapshot,
} from '@/lib/apply-ai/server-data'
import type { ExamId, HubApplicationStatus } from '@/lib/apply-ai/types'

const patchSchema = z.object({
  status: z.enum(HUB_APPLICATION_STATUSES as [HubApplicationStatus, ...HubApplicationStatus[]]).optional(),
  notes: z.string().max(4000).optional().nullable(),
  preferences: z.record(z.string().min(1).max(60), z.string().max(500)).optional(),
  checklist: z.record(z.string().min(1).max(80), z.boolean()).optional(),
  refreshDeadline: z.boolean().optional(),
  reviewMapping: z.boolean().optional(),
})

async function findOwnedApplication(workspaceId: string, id: string) {
  return prisma.examApplication.findFirst({ where: { id, workspaceId } })
}

function notFound() {
  return NextResponse.json({ error: 'Application not found' }, { status: 404 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await findOwnedApplication(workspaceId, id)
  if (!row) return notFound()

  const vault = await loadWorkspaceVaultWithDimensions(workspaceId)
  return NextResponse.json({
    application: withEvaluation(row, vault.profile, vault.documents, vault.documentDimensions),
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await findOwnedApplication(workspaceId, id)
  if (!row) return notFound()

  const exam = EXAM_BY_ID[row.examId as ExamId]
  if (!exam) {
    return NextResponse.json({ error: 'Application catalog entry is unavailable' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid application update' }, { status: 400 })
  }

  if (parsed.data.status && isSubmissionStatus(parsed.data.status)) {
    return NextResponse.json(
      {
        error: 'Submission states are recorded only through the explicit submission action.',
        code: 'USE_SUBMISSION_ENDPOINT',
      },
      { status: 400 }
    )
  }

  // Once a submission is recorded, preparation statuses cannot be written over
  // it: that would leave submission timestamps attached to a "not submitted"
  // status. The student must clear the submission record explicitly first.
  if (
    parsed.data.status &&
    (row.studentSubmittedAt !== null || row.portalReferenceRecordedAt !== null)
  ) {
    return NextResponse.json(
      {
        error:
          'Clear the recorded submission in the submission panel before changing preparation status.',
        code: 'CLEAR_SUBMISSION_FIRST',
      },
      { status: 409 }
    )
  }

  const update: Record<string, unknown> = {}

  if (parsed.data.status) update.status = parsed.data.status

  if (parsed.data.notes !== undefined) {
    const notes = parsed.data.notes?.trim() ?? ''
    update.notes = notes.length > 0 ? notes : null
  }

  if (parsed.data.preferences !== undefined) {
    const allowed = new Set(exam.preferenceFields.map(field => field.id))
    const unknownKey = Object.keys(parsed.data.preferences).find(key => !allowed.has(key))
    if (unknownKey) {
      return NextResponse.json(
        { error: `Unknown preference field: ${unknownKey}` },
        { status: 400 }
      )
    }
    for (const field of exam.preferenceFields) {
      const value = parsed.data.preferences[field.id]
      if (value && value.length > field.maxLength) {
        return NextResponse.json(
          { error: `${field.label} must be ${field.maxLength} characters or fewer.` },
          { status: 400 }
        )
      }
    }
    update.preferences = parsed.data.preferences
  }

  if (parsed.data.checklist !== undefined) {
    const manualIds = new Set(
      exam.requirements.filter(requirement => requirement.kind === 'manual').map(r => r.id)
    )
    const unknownKey = Object.keys(parsed.data.checklist).find(key => !manualIds.has(key))
    if (unknownKey) {
      return NextResponse.json(
        { error: `Unknown or non-manual checklist item: ${unknownKey}` },
        { status: 400 }
      )
    }

    const current = normalizeChecklist(row.checklist)
    const now = new Date().toISOString()
    for (const [requirementId, done] of Object.entries(parsed.data.checklist)) {
      current[requirementId] = { done, updatedAt: now }
    }
    update.checklist = current
  }

  if (parsed.data.refreshDeadline) {
    const session = findExamSession(exam.id, row.sessionId)
    if (!session) {
      return NextResponse.json(
        { error: 'This session is no longer in the catalog; verify the deadline on the official portal.' },
        { status: 409 }
      )
    }
    update.deadlineDate = session.deadline.date
    update.deadlineState = session.deadline.state
    update.deadlineLabel = session.deadline.label
    update.deadlineSourceLabel = session.deadline.source?.label ?? null
    update.deadlineSourceUrl = session.deadline.source?.url ?? null
    update.deadlineVerifiedAt = session.deadline.source?.verifiedOn
      ? new Date(`${session.deadline.source.verifiedOn}T00:00:00.000Z`)
      : null
    update.deadlineNeedsUpdate = session.deadline.needsUpdate
  }

  if (parsed.data.reviewMapping) {
    const vault = await loadWorkspaceVaultWithDimensions(workspaceId)
    if (!vault.profile) {
      return NextResponse.json(
        { error: 'Save your vault profile before approving an application mapping.' },
        { status: 409 }
      )
    }

    const updated = await prisma.$transaction(async tx => {
      if (Object.keys(update).length > 0) {
        await tx.examApplication.update({ where: { id: row.id }, data: update })
      }
      await refreshApplicationSnapshot(tx, row.id, vault.profile!, vault.documents)
      return tx.examApplication.findUniqueOrThrow({ where: { id: row.id } })
    })

    return NextResponse.json({
      application: withEvaluation(updated, vault.profile, vault.documents, vault.documentDimensions),
    })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No supported changes were supplied' }, { status: 400 })
  }

  const updated = await prisma.examApplication.update({
    where: { id: row.id },
    data: update,
  })
  const vault = await loadWorkspaceVaultWithDimensions(workspaceId)

  return NextResponse.json({
    application: withEvaluation(updated, vault.profile, vault.documents, vault.documentDimensions),
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await findOwnedApplication(workspaceId, id)
  if (!row) return notFound()

  await prisma.examApplication.delete({ where: { id: row.id } })
  return NextResponse.json({ deleted: true })
}
