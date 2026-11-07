import { Prisma } from '@prisma/client'
import type { StudentProfile, UploadedDocument } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PROFILE_SECTIONS } from './profile'
import { imageDimensionsFromBytes } from './storage'
import { getStorageProvider } from './storage-provider'
import type {
  DocumentId,
  StudentProfileData,
  SubjectEntry,
  UploadedDocumentDTO,
} from './types'

/**
 * Server-side mapping helpers shared by the profile, document and application
 * routes. Keeping the DTO conversion in one place prevents a new vault field
 * from being silently dropped by one endpoint and exposed by another.
 */

export function profileRowToDTO(row: StudentProfile | null): StudentProfileData | null {
  if (!row) return null
  return {
    id: row.id,
    fullName: row.fullName ?? null,
    gender: row.gender ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
    email: row.email ?? null,
    mobileNumber: row.mobileNumber ?? null,
    nationality: row.nationality ?? null,
    nationalityOther: row.nationalityOther ?? null,

    fatherName: row.fatherName ?? null,
    motherName: row.motherName ?? null,
    guardianName: row.guardianName ?? null,
    guardianRelation: row.guardianRelation ?? null,
    parentMobile: row.parentMobile ?? null,
    parentEmail: row.parentEmail ?? null,
    parentOccupation: row.parentOccupation ?? null,

    permanentAddressLine: row.permanentAddressLine ?? null,
    permanentCity: row.permanentCity ?? null,
    permanentDistrict: row.permanentDistrict ?? null,
    permanentState: row.permanentState ?? null,
    permanentPinCode: row.permanentPinCode ?? null,
    permanentCountry: row.permanentCountry ?? null,

    currentSameAsPermanent: row.currentSameAsPermanent,
    currentAddressLine: row.currentAddressLine ?? null,
    currentCity: row.currentCity ?? null,
    currentDistrict: row.currentDistrict ?? null,
    currentState: row.currentState ?? null,
    currentPinCode: row.currentPinCode ?? null,
    currentCountry: row.currentCountry ?? null,

    addressLine: row.addressLine ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    pinCode: row.pinCode ?? null,

    class10Board: row.class10Board ?? null,
    class10SchoolName: row.class10SchoolName ?? null,
    class10PassingYear: row.class10PassingYear ?? null,
    class10RollNumber: row.class10RollNumber ?? null,
    class10MarksKind: row.class10MarksKind ?? null,
    class10Marks: row.class10Marks ?? null,
    class10Percentage: row.class10Percentage ?? null,
    class10Subjects: (row.class10Subjects as SubjectEntry[] | null) ?? null,

    class12Status: (row.class12Status as StudentProfileData['class12Status']) ?? null,
    class12Board: row.class12Board ?? null,
    class12SchoolName: row.class12SchoolName ?? null,
    class12ExamYear: row.class12ExamYear ?? null,
    class12PassingYear: row.class12PassingYear ?? null,
    class12RollNumber: row.class12RollNumber ?? null,
    class12MarksKind: row.class12MarksKind ?? null,
    class12Marks: row.class12Marks ?? null,
    class12Percentage: row.class12Percentage ?? null,
    class12Subjects: (row.class12Subjects as SubjectEntry[] | null) ?? null,
    class12ResultDeclaredAt: row.class12ResultDeclaredAt?.toISOString() ?? null,
    class12ResultUpdatedAt: row.class12ResultUpdatedAt?.toISOString() ?? null,

    category: row.category ?? null,
    categoryOtherDetail: row.categoryOtherDetail ?? null,
    categoryConfirmed: row.categoryConfirmed,
    categoryConfirmedAt: row.categoryConfirmedAt?.toISOString() ?? null,
    pwdStatus: row.pwdStatus,
    pwdStatusConfirmed: row.pwdStatusConfirmed,
    pwdCertificateDocumentId: row.pwdCertificateDocumentId ?? null,

    categoryCertificateType: row.categoryCertificateType ?? null,
    categoryCertificateDocumentId: row.categoryCertificateDocumentId ?? null,
    categoryCertificateNumber: row.categoryCertificateNumber ?? null,
    categoryCertificateAuthority: row.categoryCertificateAuthority ?? null,
    categoryCertificateJurisdiction: row.categoryCertificateJurisdiction ?? null,
    categoryCertificateIssueDate: row.categoryCertificateIssueDate ?? null,
    categoryCertificateValidUntil: row.categoryCertificateValidUntil ?? null,
    categoryCertificateFinancialYear: row.categoryCertificateFinancialYear ?? null,
    categoryCertificateVerificationStatus: row.categoryCertificateVerificationStatus ?? null,
    categoryCertificateLastConfirmedAt: row.categoryCertificateLastConfirmedAt?.toISOString() ?? null,

    homeState: row.homeState ?? null,
    preferredExamCities: (row.preferredExamCities as string[] | null) ?? null,
    profileVersion: row.profileVersion,
    lastMajorUpdateAt: row.lastMajorUpdateAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function documentRowToDTO(
  row: UploadedDocument,
  hasPreviousVersions = false
): UploadedDocumentDTO {
  return {
    id: row.id,
    documentType: row.documentType as DocumentId,
    displayLabel: row.displayLabel ?? null,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    versions: row.versions,
    createdAt: row.createdAt.toISOString(),
    replacedAt: row.replacedAt?.toISOString() ?? null,
    isCurrent: row.isCurrent,
    supersedesId: row.supersedesId ?? null,
    certificate: {
      certificateNumber: row.certificateNumber ?? null,
      issuingAuthority: row.issuingAuthority ?? null,
      issuingState: row.issuingState ?? null,
      issueDate: row.issueDate ?? null,
      validUntil: row.validUntil ?? null,
      financialYear: row.financialYear ?? null,
      verificationStatus: row.verificationStatus,
      lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    },
    hasPreviousVersions,
  }
}

export async function loadWorkspaceVault(workspaceId: string): Promise<{
  profileRow: StudentProfile | null
  profile: StudentProfileData | null
  documents: UploadedDocumentDTO[]
}> {
  const [profileRow, documentRows] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { workspaceId } }),
    prisma.uploadedDocument.findMany({
      where: { workspaceId, deletedAt: null, isCurrent: true },
      orderBy: [{ documentType: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  return {
    profileRow,
    profile: profileRowToDTO(profileRow),
    documents: documentRows.map(row => documentRowToDTO(row, row.supersedesId !== null)),
  }
}

/**
 * Builds a map of document id → image dimensions for current image documents.
 * Only PNG/JPEG dimensions are parsed; PDFs and missing files are skipped.
 */
export async function buildDocumentDimensionsMap(
  workspaceId: string,
  documentRows: UploadedDocument[]
): Promise<Map<string, { width: number; height: number }>> {
  const map = new Map<string, { width: number; height: number }>()
  const imageRows = documentRows.filter(
    row => row.isCurrent && (row.mimeType === 'image/png' || row.mimeType === 'image/jpeg')
  )
  const results = await Promise.all(
    imageRows.map(async row => {
      const bytes = await getStorageProvider().readObject(workspaceId, row.storedName).catch(() => null)
      const dimensions = bytes ? imageDimensionsFromBytes(bytes) : null
      return { id: row.id, dimensions }
    })
  )
  for (const result of results) {
    if (result.dimensions) map.set(result.id, result.dimensions)
  }
  return map
}

export async function loadWorkspaceVaultWithDimensions(workspaceId: string): Promise<{
  profileRow: StudentProfile | null
  profile: StudentProfileData | null
  documents: UploadedDocumentDTO[]
  documentDimensions: Map<string, { width: number; height: number }>
}> {
  const [profileRow, documentRows] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { workspaceId } }),
    prisma.uploadedDocument.findMany({
      where: { workspaceId, deletedAt: null, isCurrent: true },
      orderBy: [{ documentType: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  const documents = documentRows.map(row => documentRowToDTO(row, row.supersedesId !== null))
  const documentDimensions = await buildDocumentDimensionsMap(workspaceId, documentRows)

  return {
    profileRow,
    profile: profileRowToDTO(profileRow),
    documents,
    documentDimensions,
  }
}

/* ---------------- Snapshot / change detection ---------------- */

export const SNAPSHOT_FIELD_IDS = [
  'fullName', 'gender', 'dateOfBirth', 'email', 'mobileNumber', 'nationality', 'nationalityOther',
  'fatherName', 'motherName', 'guardianName', 'guardianRelation', 'parentMobile', 'parentEmail', 'parentOccupation',
  'permanentAddressLine', 'permanentCity', 'permanentDistrict', 'permanentState', 'permanentPinCode', 'permanentCountry',
  'currentSameAsPermanent', 'currentAddressLine', 'currentCity', 'currentDistrict', 'currentState', 'currentPinCode', 'currentCountry',
  'addressLine', 'city', 'state', 'pinCode',
  'class10Board', 'class10SchoolName', 'class10PassingYear', 'class10RollNumber', 'class10MarksKind', 'class10Marks', 'class10Percentage', 'class10Subjects',
  'class12Status', 'class12Board', 'class12SchoolName', 'class12ExamYear', 'class12PassingYear', 'class12RollNumber', 'class12MarksKind', 'class12Marks', 'class12Percentage', 'class12Subjects', 'class12ResultDeclaredAt',
  'category', 'categoryOtherDetail', 'categoryConfirmed', 'pwdStatus', 'pwdStatusConfirmed',
  'pwdCertificateDocumentId', 'categoryCertificateType', 'categoryCertificateDocumentId', 'categoryCertificateNumber',
  'categoryCertificateAuthority', 'categoryCertificateJurisdiction', 'categoryCertificateIssueDate',
  'categoryCertificateValidUntil', 'categoryCertificateFinancialYear', 'categoryCertificateVerificationStatus',
  'homeState', 'preferredExamCities',
] as const

export interface VaultSnapshot {
  capturedAt: string
  profileVersion: number
  values: Record<string, unknown>
  documents: { id: string; documentType: DocumentId }[]
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return JSON.stringify(
      Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]))
    )
  }
  return JSON.stringify(value ?? null)
}

export function buildVaultSnapshot(
  profile: StudentProfileData,
  documents: UploadedDocumentDTO[]
): VaultSnapshot {
  const values: Record<string, unknown> = {}
  for (const field of SNAPSHOT_FIELD_IDS) {
    values[field] = (profile as unknown as Record<string, unknown>)[field] ?? null
  }
  return {
    capturedAt: new Date().toISOString(),
    profileVersion: profile.profileVersion,
    values,
    documents: documents
      .filter(doc => doc.isCurrent !== false)
      .map(doc => ({ id: doc.id, documentType: doc.documentType })),
  }
}

export function parseVaultSnapshot(value: unknown): VaultSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!record.values || typeof record.values !== 'object') return null
  return {
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '',
    profileVersion: typeof record.profileVersion === 'number' ? record.profileVersion : 0,
    values: record.values as Record<string, unknown>,
    documents: Array.isArray(record.documents)
      ? record.documents
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .map(item => ({
            id: typeof item.id === 'string' ? item.id : '',
            documentType: typeof item.documentType === 'string' ? (item.documentType as DocumentId) : 'OTHER',
          }))
      : [],
  }
}

export function changedFieldsSinceSnapshot(
  snapshot: VaultSnapshot,
  profile: StudentProfileData,
  documents: UploadedDocumentDTO[]
): string[] {
  const changed: string[] = []
  for (const field of SNAPSHOT_FIELD_IDS) {
    const before = snapshot.values[field] ?? null
    const after = (profile as unknown as Record<string, unknown>)[field] ?? null
    if (stableJson(before) !== stableJson(after)) changed.push(field)
  }

  const beforeDocs = snapshot.documents
    .map(doc => `${doc.documentType}:${doc.id}`)
    .sort()
  const afterDocs = documents
    .filter(doc => doc.isCurrent !== false)
    .map(doc => `${doc.documentType}:${doc.id}`)
    .sort()
  if (stableJson(beforeDocs) !== stableJson(afterDocs)) changed.push('documents')
  return changed
}

export function profileFieldLabel(fieldId: string): string {
  for (const section of PROFILE_SECTIONS) {
    for (const field of section.fields) {
      if (field.id === fieldId) return field.label
    }
  }
  if (fieldId === 'documents') return 'Document references'
  return fieldId.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

export async function recordProfileVersion(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  profile: StudentProfileData,
  reason: string,
  changedFields: string[]
): Promise<void> {
  await tx.studentProfileVersion.create({
    data: {
      workspaceId,
      profileId: profile.id,
      version: profile.profileVersion,
      reason,
      changedFields: changedFields as Prisma.InputJsonValue,
      snapshot: profile as unknown as Prisma.InputJsonValue,
    },
  })
}

/**
 * Flags every application whose snapshot no longer matches the live vault.
 * Existing approved mappings are never rewritten here: the student must
 * explicitly approve the refreshed mapping on the application page.
 */
export async function flagAffectedApplications(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  profile: StudentProfileData,
  documents: UploadedDocumentDTO[]
): Promise<number> {
  const applications = await tx.examApplication.findMany({
    where: { workspaceId, profileSnapshot: { not: Prisma.DbNull } },
    select: { id: true, profileSnapshot: true, mappingChangedFields: true },
  })

  let flagged = 0
  for (const application of applications) {
    const snapshot = parseVaultSnapshot(application.profileSnapshot)
    if (!snapshot) continue
    const changed = changedFieldsSinceSnapshot(snapshot, profile, documents)
    if (changed.length === 0) continue

    const existing = Array.isArray(application.mappingChangedFields)
      ? application.mappingChangedFields.filter((value): value is string => typeof value === 'string')
      : []
    const union = Array.from(new Set([...existing, ...changed]))
    await tx.examApplication.update({
      where: { id: application.id },
      data: {
        mappingReviewRequired: true,
        mappingChangedFields: union as Prisma.InputJsonValue,
      },
    })
    flagged += 1
  }
  return flagged
}

/**
 * Re-reads the live vault inside a transaction and flags every prepared
 * application whose snapshot is now stale. Used by write paths that change
 * documents or certificate metadata instead of the main profile form.
 */
export async function flagApplicationsAfterVaultChange(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<number> {
  const [profileRow, documentRows] = await Promise.all([
    tx.studentProfile.findUnique({ where: { workspaceId } }),
    tx.uploadedDocument.findMany({
      where: { workspaceId, deletedAt: null, isCurrent: true },
      orderBy: [{ documentType: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  if (!profileRow) return 0
  return flagAffectedApplications(
    tx,
    workspaceId,
    profileRowToDTO(profileRow)!,
    documentRows.map(row => documentRowToDTO(row, row.supersedesId !== null))
  )
}

export async function refreshApplicationSnapshot(
  tx: Prisma.TransactionClient,
  applicationId: string,
  profile: StudentProfileData,
  documents: UploadedDocumentDTO[]
): Promise<void> {
  const snapshot = buildVaultSnapshot(profile, documents)
  await tx.examApplication.update({
    where: { id: applicationId },
    data: {
      profileSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      profileSnapshotAt: new Date(),
      profileVersion: profile.profileVersion,
      mappingReviewRequired: false,
      mappingChangedFields: Prisma.JsonNull,
      mappingReviewedAt: new Date(),
    },
  })
}
