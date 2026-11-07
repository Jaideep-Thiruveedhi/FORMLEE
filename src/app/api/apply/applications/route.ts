import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { EXAM_BY_ID, findExamSession } from '@/lib/apply-ai/exams'
import { buildReminders, withEvaluation } from '@/lib/apply-ai/applications'
import {
  buildVaultSnapshot,
  loadWorkspaceVaultWithDimensions,
} from '@/lib/apply-ai/server-data'
import type { ExamId } from '@/lib/apply-ai/types'

const examIdSchema = z.enum(['JEE_MAIN', 'BITSAT', 'VITEEE', 'MET', 'CUET_UG'])

const createSchema = z.object({
  examId: examIdSchema,
  sessionId: z.string().trim().min(1).max(80),
  notes: z.string().max(4000).optional().nullable(),
})

function duplicateTarget(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target
    if (typeof target === 'string') return target
    if (Array.isArray(target)) return target.filter(item => typeof item === 'string').join(',')
  }
  return ''
}

export async function GET() {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const [rows, vault] = await Promise.all([
    prisma.examApplication.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: 'desc' }],
    }),
    loadWorkspaceVaultWithDimensions(workspaceId),
  ])

  const applications = rows.map(row =>
    withEvaluation(row, vault.profile, vault.documents, vault.documentDimensions)
  )

  return NextResponse.json({
    applications,
    reminders: buildReminders(applications),
  })
}

export async function POST(request: NextRequest) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Choose an examination and a current application session.' },
      { status: 400 }
    )
  }

  const examId = parsed.data.examId as ExamId
  const exam = EXAM_BY_ID[examId]
  const session = findExamSession(examId, parsed.data.sessionId)
  if (!session) {
    return NextResponse.json(
      { error: 'That application session is not in the current catalog. Refresh the page and choose again.' },
      { status: 400 }
    )
  }

  const vault = await loadWorkspaceVaultWithDimensions(workspaceId)
  const deadline = session.deadline
  const snapshot = vault.profile
    ? buildVaultSnapshot(vault.profile, vault.documents)
    : null

  const data = {
    workspaceId,
    examId,
    sessionId: session.id,
    examSession: session.label,
    applicationYear: session.applicationYear,
    status: 'NOT_STARTED',
    notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
    deadlineDate: deadline.date,
    deadlineState: deadline.state,
    deadlineLabel: deadline.label,
    deadlineSourceLabel: deadline.source?.label ?? null,
    deadlineSourceUrl: deadline.source?.url ?? null,
    deadlineVerifiedAt: deadline.source?.verifiedOn
      ? new Date(`${deadline.source.verifiedOn}T00:00:00.000Z`)
      : null,
    deadlineNeedsUpdate: deadline.needsUpdate,
    profileSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    profileSnapshotAt: snapshot ? new Date() : null,
    profileVersion: vault.profile?.profileVersion ?? null,
    mappingReviewRequired: false,
    mappingChangedFields: Prisma.JsonNull,
    mappingReviewedAt: snapshot ? new Date() : null,
  }

  try {
    const row = await prisma.examApplication.create({ data })
    return NextResponse.json(
      { application: withEvaluation(row, vault.profile, vault.documents, vault.documentDimensions) },
      { status: 201 }
    )
  } catch (error) {
    if (duplicateTarget(error)) {
      const existing = await prisma.examApplication.findUnique({
        where: {
          workspaceId_examId_sessionId_applicationYear: {
            workspaceId,
            examId,
            sessionId: session.id,
            applicationYear: session.applicationYear,
          },
        },
        select: { id: true },
      })
      return NextResponse.json(
        {
          error: 'You are already tracking this examination session. Open the existing application instead.',
          code: 'DUPLICATE_APPLICATION',
          existingId: existing?.id ?? null,
        },
        { status: 409 }
      )
    }
    throw error
  }
}
