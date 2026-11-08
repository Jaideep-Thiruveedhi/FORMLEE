import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { parseProfileDraft } from '@/lib/apply-ai/validation'
import { evaluateProfile } from '@/lib/apply-ai/requirements'
import {
  buildVaultSnapshot,
  changedFieldsSinceSnapshot,
  flagAffectedApplications,
  loadWorkspaceVault,
  profileRowToDTO,
  recordProfileVersion,
} from '@/lib/apply-ai/server-data'

const resultSchema = z.object({
  class12PassingYear: z.string().min(4).max(4),
  class12RollNumber: z.string().max(40).optional().nullable(),
  class12MarksKind: z.string().max(20).optional().nullable(),
  class12Marks: z.string().max(24).optional().nullable(),
  class12Percentage: z.string().max(10).optional().nullable(),
  class12Subjects: z.array(z.unknown()).max(12).optional(),
  resultDeclaredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the result date as YYYY-MM-DD')
    .optional()
    .nullable(),
})

/**
 * "Update Class 12 Results" action.
 *
 * This updates the SAME StudentProfile row — it never creates a second
 * education profile. The previous pending/appearing state is preserved in
 * StudentProfileVersion history. Marks and percentage are optional: the
 * student must enter only what the official result actually states, and Formlee
 * never computes or invents missing values.
 */
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

  const parsed = resultSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Enter the passing year. Marks, grades and percentage are optional.',
        invalidFields: parsed.error.issues.map(issue => ({
          field: String(issue.path[0] ?? 'class12'),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  const existing = await prisma.studentProfile.findUnique({ where: { workspaceId } })
  if (!existing) {
    return NextResponse.json(
      { error: 'Save your Class 12 details first, then update the result.' },
      { status: 409 }
    )
  }

  if (existing.class12Status !== 'APPEARING' && existing.class12Status !== 'RESULT_AWAITED' && existing.class12Status !== 'PASSED') {
    return NextResponse.json(
      { error: 'Select your Class 12 status in the vault before recording a result.' },
      { status: 409 }
    )
  }

  const allowedKeys = [
    'class12PassingYear',
    'class12RollNumber',
    'class12MarksKind',
    'class12Marks',
    'class12Percentage',
    'class12Subjects',
  ] as const
  const raw: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    const value = (parsed.data as Record<string, unknown>)[key]
    if (value !== undefined) raw[key] = value ?? ''
  }

  const { accepted, invalidFields } = parseProfileDraft(raw)
  if (!accepted.class12PassingYear) {
    invalidFields.push({
      field: 'class12PassingYear',
      message: 'Passing year is required when you record a declared result.',
    })
    return NextResponse.json(
      {
        error: 'Check the highlighted field before saving the result.',
        invalidFields,
      },
      { status: 400 }
    )
  }

  const beforeProfile = profileRowToDTO(existing)!
  const vaultBefore = await loadWorkspaceVault(workspaceId)
  const now = new Date()
  const firstDeclaration = existing.class12Status !== 'PASSED'

  const passingYear = parseInt(accepted.class12PassingYear as string, 10)
  const declaredOn = parsed.data.resultDeclaredOn
    ? new Date(`${parsed.data.resultDeclaredOn}T00:00:00.000Z`)
    : now

  const update: Record<string, unknown> = {
    class12Status: 'PASSED',
    class12PassingYear: passingYear,
    class12ResultUpdatedAt: now,
  }
  if (firstDeclaration) {
    // The student may record the date printed against the declared result.
    // Fall back to the update time only when they did not supply one.
    update.class12ResultDeclaredAt = declaredOn
  }

  for (const field of ['class12RollNumber', 'class12MarksKind', 'class12Marks', 'class12Percentage']) {
    if (accepted[field] !== undefined) {
      update[field] = accepted[field] === null ? null : accepted[field]
    }
  }
  if (accepted.class12Subjects !== undefined) {
    update.class12Subjects = accepted.class12Subjects
  }

  // Re-saving an unchanged result must not inflate vault history or bump the
  // version. Only a real change to the stored result advances either.
  const resultChanged =
    existing.class12Status !== 'PASSED' ||
    existing.class12PassingYear !== passingYear ||
    ('class12RollNumber' in update &&
      (existing.class12RollNumber ?? null) !== (update.class12RollNumber ?? null)) ||
    ('class12MarksKind' in update &&
      (existing.class12MarksKind ?? null) !== (update.class12MarksKind ?? null)) ||
    ('class12Marks' in update && (existing.class12Marks ?? null) !== (update.class12Marks ?? null)) ||
    ('class12Percentage' in update &&
      (existing.class12Percentage ?? null) !== (update.class12Percentage ?? null)) ||
    ('class12Subjects' in update &&
      JSON.stringify(existing.class12Subjects ?? null) !== JSON.stringify(update.class12Subjects ?? null))

  if (!resultChanged) {
    const profile = profileRowToDTO(existing)!
    return NextResponse.json({
      profile,
      evaluation: evaluateProfile(profile),
      invalidFields,
      changedFields: [],
      savedAt: existing.class12ResultUpdatedAt?.toISOString() ?? now.toISOString(),
    })
  }

  update.profileVersion = { increment: 1 }
  update.lastMajorUpdateAt = now

  let changedFields: string[] = []
  try {
    const row = await prisma.$transaction(async tx => {
      const updated = await tx.studentProfile.update({
        where: { id: existing.id },
        data: update,
      })
      const profile = profileRowToDTO(updated)!
      changedFields = changedFieldsSinceSnapshot(
        buildVaultSnapshot(beforeProfile, vaultBefore.documents),
        profile,
        vaultBefore.documents
      )
      if (changedFields.length === 0) changedFields = ['class12Status', 'class12PassingYear']
      await recordProfileVersion(
        tx,
        workspaceId,
        profile,
        firstDeclaration ? 'CLASS12_RESULT_UPDATE' : 'CLASS12_RESULT_CORRECTION',
        changedFields
      )
      await flagAffectedApplications(tx, workspaceId, profile, vaultBefore.documents)
      return updated
    })

    const profile = profileRowToDTO(row)!
    return NextResponse.json({
      profile,
      evaluation: evaluateProfile(profile),
      invalidFields,
      changedFields,
      savedAt: now.toISOString(),
    })
  } catch (error) {
    const rawName = error instanceof Error ? error.name : ''
    const name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(rawName) ? rawName : 'UnknownError'
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined
    console.error('[api] Class 12 result update failed', { name, code })
    return NextResponse.json({ error: 'Could not update the Class 12 result' }, { status: 500 })
  }
}
