import type { Prisma } from '@prisma/client'
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
import type { SubjectEntry } from '@/lib/apply-ai/types'

export async function GET() {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const [vault, versions] = await Promise.all([
    loadWorkspaceVault(workspaceId),
    prisma.studentProfileVersion.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, version: true, reason: true, changedFields: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    profile: vault.profile,
    evaluation: evaluateProfile(vault.profile),
    history: versions.map(version => ({
      id: version.id,
      version: version.version,
      reason: version.reason,
      changedFields: Array.isArray(version.changedFields) ? version.changedFields : [],
      createdAt: version.createdAt.toISOString(),
    })),
  })
}

/** Accepts any JSON object; every field is validated individually (draft mode). */
const objectSchema = z.record(z.string(), z.unknown())

export async function PUT(request: NextRequest) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  let raw: Record<string, unknown>
  try {
    const body: unknown = await request.json()
    const parsed = objectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    raw = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Draft-mode parsing: valid fields are accepted, invalid fields are reported.
  const { accepted, invalidFields } = parseProfileDraft(raw)

  // Document references are only accepted when the current student owns a
  // matching, current file in THIS workspace. This prevents cross-workspace
  // document linking through a guessed id.
  const linkedDocumentChecks = [
    ['categoryCertificateDocumentId', ['CATEGORY_CERTIFICATE']],
    ['pwdCertificateDocumentId', ['PWD_CERTIFICATE']],
  ] as const
  for (const [field, allowedTypes] of linkedDocumentChecks) {
    const documentId = accepted[field]
    if (typeof documentId !== 'string' || documentId.length === 0) continue
    const owned = await prisma.uploadedDocument.findFirst({
      where: {
        id: documentId,
        workspaceId,
        deletedAt: null,
        isCurrent: true,
        documentType: { in: [...allowedTypes] },
      },
      select: { id: true },
    })
    if (!owned) {
      invalidFields.push({
        field,
        message: 'That certificate document is not available in this workspace. Upload it again and relink it.',
      })
      accepted[field] = null
    }
  }

  const existing = await prisma.studentProfile.findUnique({ where: { workspaceId } })
  const before = profileRowToDTO(existing)
  const vaultBefore = await loadWorkspaceVault(workspaceId)
  const data = applyAcceptedFields(accepted, existing, invalidFields)
  const now = new Date()

  // Category safety: a category confirmation only counts when a category is
  // actually selected. Changing category resets the confirmation unless the
  // same request explicitly confirms the new value.
  const nextCategory =
    accepted.category !== undefined
      ? (accepted.category as string | null)
      : (existing?.category ?? null)
  if (nextCategory === null || nextCategory === '') {
    data.categoryConfirmed = false
    data.categoryConfirmedAt = null
  } else if (accepted.categoryConfirmed === true) {
    data.categoryConfirmed = true
    data.categoryConfirmedAt = now
  } else if (
    accepted.category !== undefined &&
    accepted.category !== (existing?.category ?? null)
  ) {
    data.categoryConfirmed = false
    data.categoryConfirmedAt = null
  }

  // PwD is deliberately separate from the reservation category. Unchecking it
  // clears the PwD confirmation and certificate link; confirming an already
  // checked PwD answer must still record the confirmation.
  const nextPwdStatus =
    accepted.pwdStatus !== undefined
      ? accepted.pwdStatus === true
      : (existing?.pwdStatus ?? false)
  if (!nextPwdStatus) {
    data.pwdStatusConfirmed = false
    data.pwdCertificateDocumentId = null
  } else if (accepted.pwdStatusConfirmed === true) {
    data.pwdStatusConfirmed = true
  }

  if (accepted.categoryCertificateVerificationStatus === 'STUDENT_CONFIRMED') {
    data.categoryCertificateLastConfirmedAt = now
  } else if (accepted.categoryCertificateVerificationStatus === 'SELF_REPORTED') {
    data.categoryCertificateLastConfirmedAt = null
  }

  // Pending results have no passing year, marks, percentage or declaration
  // date. If the student corrects their status back to appearing/awaited, the
  // previous version stays in history but the live vault stays truthful.
  const nextClass12Status =
    accepted.class12Status !== undefined
      ? (accepted.class12Status as string | null)
      : (existing?.class12Status ?? null)
  if (nextClass12Status !== null && nextClass12Status !== 'PASSED') {
    data.class12PassingYear = null
    data.class12MarksKind = null
    data.class12Marks = null
    data.class12Percentage = null
    data.class12ResultDeclaredAt = null
    data.class12ResultUpdatedAt = null
  }

  let updatedRow
  let changedFields: string[] = []
  let versions: unknown[] = []

  try {
    const result = await prisma.$transaction(async tx => {
      let row = existing
        ? await tx.studentProfile.update({ where: { workspaceId }, data })
        : await tx.studentProfile.create({
            data: { ...data, workspaceId } as Prisma.StudentProfileUncheckedCreateInput,
          })

      let profile = profileRowToDTO(row)!
      changedFields = before
        ? changedFieldsSinceSnapshot(
            buildVaultSnapshot(before, vaultBefore.documents),
            profile,
            vaultBefore.documents
          )
        : ['profile-created']

      if (changedFields.length > 0) {
        if (before) {
          // A real content change advances the vault version. The application
          // flagging below uses content comparison, so a version bump alone
          // never forces a needless review.
          row = await tx.studentProfile.update({
            where: { workspaceId },
            data: { profileVersion: { increment: 1 }, lastMajorUpdateAt: now },
          })
          profile = profileRowToDTO(row)!
        }
        await recordProfileVersion(tx, workspaceId, profile, 'PROFILE_UPDATE', changedFields)
        if (before) {
          await flagAffectedApplications(tx, workspaceId, profile, vaultBefore.documents)
        }
      }

      const history = await tx.studentProfileVersion.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, version: true, reason: true, changedFields: true, createdAt: true },
      })
      versions = history.map(version => ({
        id: version.id,
        version: version.version,
        reason: version.reason,
        changedFields: Array.isArray(version.changedFields) ? version.changedFields : [],
        createdAt: version.createdAt.toISOString(),
      }))

      return row
    })
    updatedRow = result
  } catch (error) {
    const rawName = error instanceof Error ? error.name : ''
    const name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(rawName) ? rawName : 'UnknownError'
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined
    console.error('[api] profile save failed', { name, code })
    return NextResponse.json({ error: 'Could not save your profile' }, { status: 500 })
  }

  const profile = profileRowToDTO(updatedRow)!
  return NextResponse.json({
    profile,
    evaluation: evaluateProfile(profile),
    invalidFields,
    changedFields,
    history: versions,
    savedAt: new Date().toISOString(),
  })
}

/**
 * Maps validated draft fields onto typed Prisma update input. Null values clear
 * the field only because the draft explicitly contained an empty value.
 */
function applyAcceptedFields(
  accepted: Record<string, unknown>,
  existing: Awaited<ReturnType<typeof prisma.studentProfile.findUnique>>,
  invalidFields: { field: string; message: string }[]
): Prisma.StudentProfileUncheckedUpdateInput {
  const update: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(accepted)) {
    switch (field) {
      case 'class10PassingYear':
      case 'class12PassingYear':
      case 'class12ExamYear':
        // zod validated a 4-digit year STRING; the Prisma column is Int.
        update[field] = value === null ? null : parseInt(value as string, 10)
        break
      case 'currentSameAsPermanent':
      case 'categoryConfirmed':
      case 'pwdStatus':
      case 'pwdStatusConfirmed':
        update[field] = Boolean(value)
        break
      case 'categoryCertificateVerificationStatus':
        update[field] = value
        break
      case 'class10Subjects':
      case 'class12Subjects':
        update[field] = value as Prisma.InputJsonValue
        break
      case 'preferredExamCities':
        update[field] = value as Prisma.InputJsonValue
        break
      default:
        update[field] = value
    }
  }

  // Keep the legacy single address in sync with the permanent address. Older
  // code paths and the single-address agent mapping still read it, while the
  // vault UI writes the richer permanent/current structure.
  if (accepted.permanentAddressLine !== undefined && accepted.addressLine === undefined) {
    update.addressLine = accepted.permanentAddressLine
  }
  if (accepted.permanentCity !== undefined && accepted.city === undefined) {
    update.city = accepted.permanentCity
  }
  if (accepted.permanentState !== undefined && accepted.state === undefined) {
    update.state = accepted.permanentState
  }
  if (accepted.permanentPinCode !== undefined && accepted.pinCode === undefined) {
    update.pinCode = accepted.permanentPinCode
  }
  if (accepted.currentSameAsPermanent === true) {
    // Keep current* values for history, but mirror them so older readers see
    // the address the student explicitly said is current.
    update.currentAddressLine = accepted.permanentAddressLine ?? existing?.permanentAddressLine ?? existing?.addressLine ?? null
    update.currentCity = accepted.permanentCity ?? existing?.permanentCity ?? existing?.city ?? null
    update.currentDistrict = accepted.permanentDistrict ?? existing?.permanentDistrict ?? null
    update.currentState = accepted.permanentState ?? existing?.permanentState ?? existing?.state ?? null
    update.currentPinCode = accepted.permanentPinCode ?? existing?.permanentPinCode ?? existing?.pinCode ?? null
    update.currentCountry = accepted.permanentCountry ?? existing?.permanentCountry ?? null
  }

  if (accepted.categoryConfirmed === true && !existing?.category && !accepted.category) {
    invalidFields.push({
      field: 'categoryConfirmed',
      message: 'Select a reservation category before confirming it.',
    })
    update.categoryConfirmed = false
    update.categoryConfirmedAt = null
  }

  // Type-only guard: class12Subjects was already validated as SubjectEntry[].
  void (null as unknown as SubjectEntry)

  return update as Prisma.StudentProfileUncheckedUpdateInput
}
