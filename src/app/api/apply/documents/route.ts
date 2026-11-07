import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  extensionForMime,
  validateDocumentUploadBytes,
} from '@/lib/apply-ai/storage'
import { getStorageProvider } from '@/lib/apply-ai/storage-provider'
import { documentRowToDTO, flagApplicationsAfterVaultChange } from '@/lib/apply-ai/server-data'
import { logInternalApiError } from '@/lib/api-errors'

const DOCUMENT_TYPE_VALUES = [
  'PHOTO',
  'SIGNATURE',
  'CLASS10_MARKSHEET',
  'CLASS12_MARKSHEET',
  'CLASS12_PASSING_CERTIFICATE',
  'CATEGORY_CERTIFICATE',
  'PWD_CERTIFICATE',
  'IDENTITY_DOCUMENT',
  'ADDRESS_PROOF',
  'OTHER',
] as const

export async function GET() {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const rows = await prisma.uploadedDocument.findMany({
    where: { workspaceId, deletedAt: null, isCurrent: true },
    orderBy: [{ documentType: 'asc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({
    documents: rows.map(row => documentRowToDTO(row, row.supersedesId !== null)),
  })
}

const emptyToUndefined = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const uploadSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPE_VALUES),
  // Only OTHER rows may carry a student-written label.
  displayLabel: z.string().min(1).max(80).optional(),
  certificateNumber: z.string().min(1).max(120).optional(),
  issuingAuthority: z.string().min(2).max(160).optional(),
  issuingState: z.string().min(2).max(120).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  financialYear: z.string().min(1).max(40).optional(),
})

export async function POST(request: NextRequest) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const storage = getStorageProvider()

  // Reject ordinary oversized requests before FormData parsing allocates the
  // upload body. The file-level limit below remains authoritative.
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'Upload request exceeds the 5 MB file limit.' }, { status: 413 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload form data' }, { status: 400 })
  }

  const meta = uploadSchema.safeParse({
    documentType: form.get('documentType'),
    displayLabel: emptyToUndefined(form.get('displayLabel')),
    certificateNumber: emptyToUndefined(form.get('certificateNumber')),
    issuingAuthority: emptyToUndefined(form.get('issuingAuthority')),
    issuingState: emptyToUndefined(form.get('issuingState')),
    issueDate: emptyToUndefined(form.get('issueDate')),
    validUntil: emptyToUndefined(form.get('validUntil')),
    financialYear: emptyToUndefined(form.get('financialYear')),
  })
  if (!meta.success) {
    return NextResponse.json(
      { error: "Unsupported document entry. Check the document type and, for 'Other document', the label." },
      { status: 400 }
    )
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Attach a file to upload' }, { status: 400 })
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.` },
      { status: 400 }
    )
  }

  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_MIME_TYPES.includes(mimeType) || !extensionForMime(mimeType)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Accepted formats: JPEG image, PNG image, or PDF.' },
      { status: 400 }
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  // Trust bytes, not the client-declared Content-Type, and require the two to
  // match so metadata and stored object content cannot disagree.
  const sniffedMime = validateDocumentUploadBytes(mimeType, bytes)
  if (!sniffedMime) {
    return NextResponse.json(
      { error: 'File content is not a valid JPEG, PNG or PDF document.' },
      { status: 400 }
    )
  }

  // Validate the OTHER-document label BEFORE writing anything to disk so a
  // rejected upload can never leave an orphan file in the storage root.
  if (meta.data.documentType === 'OTHER' && !meta.data.displayLabel) {
    return NextResponse.json(
      { error: 'Other documents need a short label (1–80 characters).' },
      { status: 400 }
    )
  }

  const originalName = file.name.split(/[\\/]/).pop()?.slice(0, 200) || 'document'
  let storedName: string
  try {
    storedName = await storage.saveObject(workspaceId, sniffedMime, bytes)
  } catch (error) {
    return NextResponse.json(logInternalApiError('document storage upload', error), { status: 503 })
  }

  let row
  try {
    row = await createDocumentRecord({
      workspaceId,
      documentType: meta.data.documentType,
      displayLabel: meta.data.displayLabel,
      originalName,
      storedName,
      mimeType: sniffedMime,
      sizeBytes: bytes.length,
      certificateData: {
        certificateNumber: meta.data.certificateNumber ?? null,
        issuingAuthority: meta.data.issuingAuthority ?? null,
        issuingState: meta.data.issuingState ?? null,
        issueDate: meta.data.issueDate ?? null,
        validUntil: meta.data.validUntil ?? null,
        financialYear: meta.data.financialYear ?? null,
      },
    })
  } catch (error) {
    // Database and object storage cannot share a transaction. Compensate if
    // metadata persistence fails; if cleanup also fails, the opaque object is
    // an orphan for the documented operator reconciliation procedure.
    await storage.deleteObject(workspaceId, storedName).catch(cleanupError => {
      logInternalApiError('document orphan cleanup', cleanupError)
    })
    return NextResponse.json(logInternalApiError('document metadata persistence', error), { status: 500 })
  }

  return NextResponse.json(
    { document: documentRowToDTO(row, row.supersedesId !== null) },
    { status: 201 }
  )
}

interface CreateDocumentRecordInput {
  workspaceId: string
  documentType: (typeof DOCUMENT_TYPE_VALUES)[number]
  displayLabel?: string
  originalName: string
  storedName: string
  mimeType: string
  sizeBytes: number
  certificateData: {
    certificateNumber: string | null
    issuingAuthority: string | null
    issuingState: string | null
    issueDate: string | null
    validUntil: string | null
    financialYear: string | null
  }
}

async function createDocumentRecord(input: CreateDocumentRecordInput) {
  const { workspaceId, documentType, displayLabel, originalName, storedName, mimeType, sizeBytes, certificateData } = input

  if (documentType === 'OTHER') {
    return prisma.$transaction(async tx => {
      const created = await tx.uploadedDocument.create({
        data: {
          workspaceId,
          documentType: 'OTHER',
          displayLabel,
          originalName,
          storedName,
          mimeType,
          sizeBytes,
          ...certificateData,
        },
      })
      await flagApplicationsAfterVaultChange(tx, workspaceId)
      return created
    })
  }

  // Core document types keep one ACTIVE row. Replacing it creates a new
  // version row and marks the old row superseded — the previous private file
  // is deliberately retained, never deleted, so certificate history survives.
  const existing = await prisma.uploadedDocument.findFirst({
    where: { workspaceId, documentType, deletedAt: null, isCurrent: true },
    select: { id: true, versions: true },
  })

  if (existing) {
    return prisma.$transaction(async tx => {
      await tx.uploadedDocument.update({
        where: { id: existing.id },
        data: { isCurrent: false, supersededAt: new Date(), replacedAt: new Date() },
      })
      const created = await tx.uploadedDocument.create({
        data: {
          workspaceId,
          documentType,
          displayLabel: displayLabel ?? null,
          originalName,
          storedName,
          mimeType,
          sizeBytes,
          versions: existing.versions + 1,
          supersedesId: existing.id,
          ...certificateData,
        },
      })

      // A vault certificate link that pointed at the replaced file must keep
      // working: move the reference to the new current version. The old file
      // and the old link remain recoverable through document version history.
      const linkField =
        created.documentType === 'CATEGORY_CERTIFICATE'
          ? 'categoryCertificateDocumentId'
          : created.documentType === 'PWD_CERTIFICATE'
            ? 'pwdCertificateDocumentId'
            : null
      if (linkField) {
        await tx.studentProfile.updateMany({
          where: { workspaceId, [linkField]: existing.id },
          data: { [linkField]: created.id },
        })
      }

      await flagApplicationsAfterVaultChange(tx, workspaceId)
      return created
    })
  }

  return prisma.$transaction(async tx => {
    const created = await tx.uploadedDocument.create({
      data: {
        workspaceId,
        documentType,
        displayLabel: displayLabel ?? null,
        originalName,
        storedName,
        mimeType,
        sizeBytes,
        ...certificateData,
      },
    })
    await flagApplicationsAfterVaultChange(tx, workspaceId)
    return created
  })
}
