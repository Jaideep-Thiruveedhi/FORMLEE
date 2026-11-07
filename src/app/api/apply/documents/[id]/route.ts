import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { getStorageProvider } from '@/lib/apply-ai/storage-provider'
import { logInternalApiError } from '@/lib/api-errors'
import {
  buildVaultSnapshot,
  changedFieldsSinceSnapshot,
  documentRowToDTO,
  flagAffectedApplications,
  parseVaultSnapshot,
  profileRowToDTO,
  recordProfileVersion,
} from '@/lib/apply-ai/server-data'

/** Deletes a document (row + private file). Authorization: workspace owner only. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await prisma.uploadedDocument.findUnique({ where: { id } })

  // 404 both for unknown ids and other workspaces' documents (no existence leak).
  if (!row || row.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const storage = getStorageProvider()
  if (row.deletedAt) {
    // A previous request may have soft-deleted the row but failed while
    // deleting the object. Retrying DELETE safely retries the same object key.
    try {
      await storage.deleteObject(workspaceId, row.storedName)
      return NextResponse.json({ deleted: true })
    } catch (error) {
      return NextResponse.json(logInternalApiError('document deletion retry', error), { status: 503 })
    }
  }

  const [profile, applications] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { workspaceId },
      select: { categoryCertificateDocumentId: true, pwdCertificateDocumentId: true },
    }),
    prisma.examApplication.findMany({
      where: { workspaceId, profileSnapshot: { not: Prisma.DbNull } },
      select: { id: true, profileSnapshot: true },
    }),
  ])

  if (
    profile?.categoryCertificateDocumentId === row.id ||
    profile?.pwdCertificateDocumentId === row.id
  ) {
    return NextResponse.json(
      {
        error:
          'This document is linked to your Category & Certificates vault entry. Unlink it there first, or keep it for your records.',
        code: 'DOCUMENT_LINKED_TO_PROFILE',
      },
      { status: 409 }
    )
  }

  const referencedByApplication = applications.some(application => {
    const snapshot = parseVaultSnapshot(application.profileSnapshot)
    return snapshot?.documents.some(document => document.id === row.id) ?? false
  })
  if (referencedByApplication) {
    return NextResponse.json(
      {
        error:
          'This document is referenced by a prepared application snapshot. It cannot be removed while that history is retained.',
        code: 'DOCUMENT_REFERENCED_BY_APPLICATION',
      },
      { status: 409 }
    )
  }

  await prisma.uploadedDocument.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), isCurrent: false },
  })

  // Delete the backing object for both local and R2 providers. Superseded
  // versions are intentionally retained — only the current/deleted row's object
  // is removed.
  try {
    await storage.deleteObject(workspaceId, row.storedName)
  } catch (error) {
    // Keep the tombstone and report failure; a retry of this same endpoint
    // attempts idempotent deletion again without restoring document access.
    return NextResponse.json(logInternalApiError('document deletion', error), { status: 503 })
  }

  return NextResponse.json({ deleted: true })
}

const metadataSchema = z.object({
  displayLabel: z.string().min(1).max(80).optional(),
  certificateNumber: z.string().min(1).max(120).nullable().optional(),
  issuingAuthority: z.string().min(2).max(160).nullable().optional(),
  issuingState: z.string().min(2).max(120).nullable().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  financialYear: z.string().min(1).max(40).nullable().optional(),
  verificationStatus: z.enum(['SELF_REPORTED', 'STUDENT_CONFIRMED']).optional(),
})

/** Updates the label (OTHER only) or certificate metadata for the owner. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await prisma.uploadedDocument.findUnique({ where: { id } })
  if (!row || row.workspaceId !== workspaceId || row.deletedAt) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  if (!row.isCurrent) {
    return NextResponse.json(
      { error: 'A superseded document version is read-only history.' },
      { status: 409 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = metadataSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the document metadata values.' }, { status: 400 })
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No supported changes were supplied' }, { status: 400 })
  }

  if (parsed.data.displayLabel !== undefined && row.documentType !== 'OTHER') {
    return NextResponse.json(
      { error: 'Only other documents can be renamed. Certificate details use the metadata fields.' },
      { status: 400 }
    )
  }

  const now = new Date()
  const update: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.verificationStatus === 'STUDENT_CONFIRMED') {
    update.lastConfirmedAt = now
  } else if (parsed.data.verificationStatus === 'SELF_REPORTED') {
    update.lastConfirmedAt = null
  }

  const updated = await prisma.$transaction(async tx => {
    const document = await tx.uploadedDocument.update({ where: { id: row.id }, data: update })

    // Mirror certificate metadata into the linked vault section so the Hub and
    // agent see one authoritative set of fields.
    const profileRow = await tx.studentProfile.findUnique({ where: { workspaceId } })
    if (profileRow?.categoryCertificateDocumentId === row.id) {
      const before = profileRowToDTO(profileRow)!
      const previous = await tx.uploadedDocument.findMany({
        where: { workspaceId, deletedAt: null, isCurrent: true },
        orderBy: [{ documentType: 'asc' }, { createdAt: 'asc' }],
      })
      const nextProfile = await tx.studentProfile.update({
        where: { id: profileRow.id },
        data: {
          categoryCertificateNumber: document.certificateNumber ?? null,
          categoryCertificateAuthority: document.issuingAuthority ?? null,
          categoryCertificateJurisdiction: document.issuingState ?? null,
          categoryCertificateIssueDate: document.issueDate ?? null,
          categoryCertificateValidUntil: document.validUntil ?? null,
          categoryCertificateFinancialYear: document.financialYear ?? null,
          categoryCertificateVerificationStatus: document.verificationStatus,
          categoryCertificateLastConfirmedAt: document.lastConfirmedAt,
        },
      })
      const after = profileRowToDTO(nextProfile)!
      const documents = previous.map(item =>
        documentRowToDTO(item, item.supersedesId !== null)
      )
      const changedFields = changedFieldsSinceSnapshot(
        buildVaultSnapshot(before, documents),
        after,
        documents
      )
      if (changedFields.length > 0) {
        const versioned = await tx.studentProfile.update({
          where: { id: profileRow.id },
          data: { profileVersion: { increment: 1 }, lastMajorUpdateAt: now },
        })
        const versionedProfile = profileRowToDTO(versioned)!
        await recordProfileVersion(
          tx,
          workspaceId,
          versionedProfile,
          'CERTIFICATE_METADATA_UPDATE',
          changedFields
        )
        await flagAffectedApplications(tx, workspaceId, versionedProfile, documents)
      }
    }
    return document
  })

  return NextResponse.json({
    document: documentRowToDTO(updated, updated.supersedesId !== null),
  })
}
