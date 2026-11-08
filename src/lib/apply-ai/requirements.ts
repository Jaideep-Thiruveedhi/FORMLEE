import { DOCUMENT_TYPE_BY_ID } from './documents'
import { EXAM_BY_ID } from './exams'
import { CATEGORY_LABELS, CLASS12_STATUS_LABELS, PROFILE_SECTIONS } from './profile'
import type {
  DocumentId,
  ExamId,
  ExamRequirement,
  ProfileSectionId,
  ProfileSectionState,
  ProfileStatus,
  RequirementItem,
  SubjectEntry,
  UploadedDocumentDTO,
} from './types'

/**
 * Requirement evaluation for Formlee.
 *
 * Readiness is computed ONLY from concrete, configured requirements — the
 * reused profile sections and the applicable document checklist. Pending Class
 * 12 results are a legitimate state, not a missing value: the Class 12 section
 * is complete (awaiting results) once the available examination details exist.
 */

/**
 * Profile-like value: the server DTO, a local form draft, a partial payload or
 * null — any object shape is accepted; helpers narrow internally.
 */
export type ProfileLike = unknown

function asRecord(payload: ProfileLike): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return payload as Record<string, unknown>
}

export function getProfileText(payload: ProfileLike, fieldId: string): string {
  const record = asRecord(payload)
  if (!record) return ''
  const value = record[fieldId]
  if (value === null || value === undefined || value === false) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

export function getProfileBool(payload: ProfileLike, fieldId: string): boolean {
  return asRecord(payload)?.[fieldId] === true
}

export function getProfileSubjects(payload: ProfileLike, listKey: string): SubjectEntry[] | null {
  const value = asRecord(payload)?.[listKey]
  return Array.isArray(value) && value.length > 0 ? (value as SubjectEntry[]) : null
}

function isFieldFilled(payload: ProfileLike, fieldId: string): boolean {
  return getProfileText(payload, fieldId).length > 0
}

function hasAny(payload: ProfileLike, fieldIds: string[]): boolean {
  return fieldIds.some(fieldId => isFieldFilled(payload, fieldId))
}

/* ---------------- Profile evaluation ---------------- */

export interface SectionStatus {
  sectionId: ProfileSectionId
  /** True for COMPLETE, AWAITING_RESULTS and NOT_APPLICABLE. */
  done: boolean
  state: ProfileSectionState
  /** Human labels of genuinely missing or unconfirmed values. */
  missingLabels: string[]
  /** Short contextual explanation for conditional states. */
  note: string | null
}

export interface ProfileEvaluation {
  sections: SectionStatus[]
  status: ProfileStatus
  missingLabels: string[]
  needsConfirmationLabels: string[]
  awaitingResultsLabels: string[]
  completedSections: number
  totalSections: number
  hasAwaitingResults: boolean
  hasNeedsConfirmation: boolean
}

function fieldLabel(sectionId: ProfileSectionId, fieldId: string): string {
  const section = PROFILE_SECTIONS.find(item => item.id === sectionId)
  return section?.fields.find(field => field.id === fieldId)?.label ?? fieldId
}

function standardSection(
  sectionId: ProfileSectionId,
  payload: ProfileLike,
  requiredFields: string[],
  options: { note?: string } = {}
): SectionStatus {
  const missing = requiredFields.filter(fieldId => !isFieldFilled(payload, fieldId))
  return {
    sectionId,
    done: missing.length === 0,
    state: missing.length === 0 ? 'COMPLETE' : 'PARTIAL',
    missingLabels: missing.map(fieldId => fieldLabel(sectionId, fieldId)),
    note: options.note ?? null,
  }
}

function effectivePermanent(payload: ProfileLike): {
  line: string
  city: string
  district: string
  state: string
  pinCode: string
} {
  return {
    line: getProfileText(payload, 'permanentAddressLine') || getProfileText(payload, 'addressLine'),
    city: getProfileText(payload, 'permanentCity') || getProfileText(payload, 'city'),
    district: getProfileText(payload, 'permanentDistrict'),
    state: getProfileText(payload, 'permanentState') || getProfileText(payload, 'state'),
    pinCode: getProfileText(payload, 'permanentPinCode') || getProfileText(payload, 'pinCode'),
  }
}

function evaluatePersonal(payload: ProfileLike): SectionStatus {
  return standardSection('personal', payload, [
    'fullName',
    'dateOfBirth',
    'email',
    'mobileNumber',
    'nationality',
  ])
}

function evaluateFamily(payload: ProfileLike): SectionStatus {
  const hasParentOrGuardian = hasAny(payload, ['fatherName', 'motherName', 'guardianName'])
  return {
    sectionId: 'family',
    done: hasParentOrGuardian,
    state: hasParentOrGuardian ? 'COMPLETE' : 'PARTIAL',
    missingLabels: hasParentOrGuardian
      ? []
      : ["Father's name, mother's name or guardian name"],
    note: hasParentOrGuardian
      ? null
      : 'Add at least one parent or guardian name. Other family fields are optional unless an examination asks for them.',
  }
}

function evaluateAddress(payload: ProfileLike): SectionStatus {
  const permanent = effectivePermanent(payload)
  const missing: string[] = []
  if (!permanent.line) missing.push('Permanent address')
  if (!permanent.city) missing.push('Permanent city / town')
  if (!permanent.state) missing.push('Permanent state')
  if (!permanent.pinCode) missing.push('Permanent PIN code')

  const sameAsPermanent = getProfileBool(payload, 'currentSameAsPermanent')
  if (!sameAsPermanent) {
    if (!isFieldFilled(payload, 'currentAddressLine')) missing.push('Current address')
    if (!isFieldFilled(payload, 'currentCity')) missing.push('Current city / town')
    if (!isFieldFilled(payload, 'currentState')) missing.push('Current state')
    if (!isFieldFilled(payload, 'currentPinCode')) missing.push('Current PIN code')
  }

  return {
    sectionId: 'address',
    done: missing.length === 0,
    state: missing.length === 0 ? 'COMPLETE' : 'PARTIAL',
    missingLabels: missing,
    note: sameAsPermanent
      ? 'Current address marked as the same as the permanent address.'
      : null,
  }
}

function evaluateClass10(payload: ProfileLike): SectionStatus {
  return standardSection('class10', payload, [
    'class10Board',
    'class10SchoolName',
    'class10PassingYear',
  ])
}

function evaluateClass12(payload: ProfileLike): SectionStatus {
  const status = getProfileText(payload, 'class12Status')
  if (!status) {
    return {
      sectionId: 'class12',
      done: false,
      state: 'NEEDS_CONFIRMATION',
      missingLabels: ['Class 12 status'],
      note: 'Select whether you are currently appearing, awaiting a result, or have already passed Class 12.',
    }
  }

  const statusLabel = CLASS12_STATUS_LABELS[status] ?? status
  const baseRequired = ['class12Board', 'class12SchoolName']
  const missing = baseRequired.filter(fieldId => !isFieldFilled(payload, fieldId))

  if (status === 'APPEARING' || status === 'RESULT_AWAITED') {
    if (!isFieldFilled(payload, 'class12ExamYear')) missing.push('class12ExamYear')
    return {
      sectionId: 'class12',
      done: missing.length === 0,
      state: missing.length === 0 ? 'AWAITING_RESULTS' : 'PARTIAL',
      missingLabels: missing.map(fieldId => fieldLabel('class12', fieldId)),
      note:
        missing.length === 0
          ? `${statusLabel}. Marks, percentage, passing year and final documents are intentionally left empty until they exist.`
          : `${statusLabel}. Only the examination details currently available are required; marks are not.`,
    }
  }

  if (status === 'PASSED') {
    if (!isFieldFilled(payload, 'class12PassingYear')) missing.push('class12PassingYear')
    return {
      sectionId: 'class12',
      done: missing.length === 0,
      state: missing.length === 0 ? 'COMPLETE' : 'PARTIAL',
      missingLabels: missing.map(fieldId => fieldLabel('class12', fieldId)),
      note: missing.length === 0 ? 'Passed Class 12. Marks and documents can be added when available.' : null,
    }
  }

  return {
    sectionId: 'class12',
    done: false,
    state: 'NEEDS_CONFIRMATION',
    missingLabels: ['Class 12 status'],
    note: 'Select a valid Class 12 status.',
  }
}

function evaluateCategory(payload: ProfileLike): SectionStatus {
  const category = getProfileText(payload, 'category')
  if (!category) {
    return {
      sectionId: 'category',
      done: false,
      state: 'NEEDS_CONFIRMATION',
      missingLabels: ['Reservation category'],
      note: 'Select your category yourself. Formlee never infers it from your name, surname or location.',
    }
  }

  const missing: string[] = []
  if (category === 'OTHER' && !isFieldFilled(payload, 'categoryOtherDetail')) {
    missing.push('Other category (specify)')
  }
  if (!getProfileBool(payload, 'categoryConfirmed')) {
    missing.push('Category confirmation')
  }
  if (getProfileBool(payload, 'pwdStatus') && !getProfileBool(payload, 'pwdStatusConfirmed')) {
    missing.push('PwBD / PwD confirmation')
  }

  if (missing.length > 0) {
    return {
      sectionId: 'category',
      done: false,
      state: 'NEEDS_CONFIRMATION',
      missingLabels: missing,
      note: 'Confirm your category (and PwD answer, if applicable) before Formlee reuses it.',
    }
  }

  const categoryLabel = CATEGORY_LABELS[category] ?? category
  return {
    sectionId: 'category',
    done: true,
    state: 'COMPLETE',
    missingLabels: [],
    note:
      category === 'GENERAL'
        ? `${categoryLabel} confirmed. No category certificate applies.`
        : `${categoryLabel} confirmed by you. A certificate is only needed where an examination requires it; Formlee does not decide validity.`,
  }
}

function evaluatePreferences(payload: ProfileLike): SectionStatus {
  // Preferences are genuinely optional; application-specific choices live on
  // ExamApplication and are never written into the master profile.
  return {
    sectionId: 'preferences',
    done: true,
    state: 'COMPLETE',
    missingLabels: [],
    note: hasAny(payload, ['homeState', 'preferredExamCities'])
      ? null
      : 'Optional planning preferences. Examination-specific choices stay on each application.',
  }
}

export function evaluateProfile(payload: ProfileLike): ProfileEvaluation {
  const sections: SectionStatus[] = [
    evaluatePersonal(payload),
    evaluateFamily(payload),
    evaluateAddress(payload),
    evaluateClass10(payload),
    evaluateClass12(payload),
    evaluateCategory(payload),
    evaluatePreferences(payload),
  ]

  const completedSections = sections.filter(section => section.done).length
  const anyValue =
    (asRecord(payload) !== null) &&
    Object.entries(asRecord(payload) as Record<string, unknown>).some(([key, value]) => {
      if (['id', 'workspaceId', 'createdAt', 'updatedAt', 'profileVersion'].includes(key)) return false
      if (key.endsWith('Subjects')) return getProfileSubjects(payload, key) !== null
      if (typeof value === 'boolean') return value
      return typeof value === 'string' && value.trim().length > 0
    })

  const status: ProfileStatus =
    completedSections === sections.length ? 'COMPLETE' : anyValue ? 'IN_PROGRESS' : 'INCOMPLETE'

  const missingLabels = sections.flatMap(section =>
    section.state === 'PARTIAL' ? section.missingLabels : []
  )
  const needsConfirmationLabels = sections.flatMap(section =>
    section.state === 'NEEDS_CONFIRMATION' ? section.missingLabels : []
  )
  const awaitingResultsLabels = sections.flatMap(section =>
    section.state === 'AWAITING_RESULTS' ? [section.sectionId] : []
  )

  return {
    sections,
    status,
    missingLabels,
    needsConfirmationLabels,
    awaitingResultsLabels,
    completedSections,
    totalSections: sections.length,
    hasAwaitingResults: sections.some(section => section.state === 'AWAITING_RESULTS'),
    hasNeedsConfirmation: sections.some(section => section.state === 'NEEDS_CONFIRMATION'),
  }
}

/* ---------------- Document applicability ---------------- */

/**
 * Whether a checklist row applies to this student right now. Conditional rows
 * appear only when the student's own confirmed answers make them potentially
 * relevant — Formlee never decides which certificates an exam requires.
 */
export function isDocumentApplicable(docId: DocumentId, payload: ProfileLike): boolean {
  if (docId === 'CATEGORY_CERTIFICATE') {
    const category = getProfileText(payload, 'category')
    return (
      category.length > 0 &&
      category !== 'GENERAL' &&
      getProfileBool(payload, 'categoryConfirmed')
    )
  }
  if (docId === 'PWD_CERTIFICATE') {
    return getProfileBool(payload, 'pwdStatus') && getProfileBool(payload, 'pwdStatusConfirmed')
  }
  if (docId === 'CLASS12_PASSING_CERTIFICATE') {
    return getProfileText(payload, 'class12Status') === 'PASSED'
  }
  if (docId === 'CLASS12_MARKSHEET') {
    // A final marksheet only exists after Class 12 is passed. Neither
    // "currently appearing" nor "result awaited" makes it missing.
    const status = getProfileText(payload, 'class12Status')
    return status === '' || status === 'PASSED'
  }
  return true
}

export function requiredDocumentIdsForExam(examId: ExamId, payload: ProfileLike): DocumentId[] {
  const exam = EXAM_BY_ID[examId]
  return exam.requiredDocIds.filter(docId => isDocumentApplicable(docId, payload))
}

/** Active (non-deleted, current) documents of a given checklist type. */
export function documentsOfType(docType: DocumentId, documents: UploadedDocumentDTO[]): UploadedDocumentDTO[] {
  return documents.filter(
    doc => doc.documentType === docType && doc.isCurrent !== false
  )
}

export function isDocumentUploaded(docType: DocumentId, documents: UploadedDocumentDTO[]): boolean {
  return documentsOfType(docType, documents).length > 0
}

/* ---------------- Exam requirement evaluation ---------------- */

function sectionDetail(status: SectionStatus | undefined): string {
  if (!status) return 'Not available'
  if (status.state === 'COMPLETE') return 'Available in your vault'
  if (status.state === 'AWAITING_RESULTS') return 'Available — results awaited, no marks required yet'
  if (status.state === 'NEEDS_CONFIRMATION') return 'Needs your confirmation: ' + status.missingLabels.join(', ')
  if (status.state === 'NOT_APPLICABLE') return 'Not applicable'
  return 'Missing: ' + status.missingLabels.join(', ')
}

export function evaluateExamRequirements(
  examId: ExamId,
  payload: ProfileLike,
  documents: UploadedDocumentDTO[]
): ExamRequirement {
  const exam = EXAM_BY_ID[examId]
  const profileEvaluation = evaluateProfile(payload)

  const items: RequirementItem[] = []

  for (const sectionId of exam.requiredSections) {
    const status = profileEvaluation.sections.find(s => s.sectionId === sectionId)
    const sectionDef = PROFILE_SECTIONS.find(s => s.id === sectionId)!
    items.push({
      id: 'section-' + sectionId,
      kind: 'profile-section',
      label: 'Profile: ' + sectionDef.title,
      detail: sectionDetail(status),
      met: status?.done ?? false,
      href: '/apply/profile#profile-section-' + sectionId,
    })
  }

  for (const docId of requiredDocumentIdsForExam(examId, payload)) {
    const docDef = DOCUMENT_TYPE_BY_ID[docId]
    items.push({
      id: 'document-' + docId,
      kind: 'document',
      label: 'Document: ' + docDef.label + (docDef.conditional ? ' (if it applies to you)' : ''),
      detail: 'Upload once on the Documents page; every exam reuses it.',
      met: isDocumentUploaded(docId, documents),
      href: '/apply/documents#document-type-' + docId,
    })
  }

  return {
    examId,
    items,
    metCount: items.filter(item => item.met).length,
    totalCount: items.length,
    ready: items.length > 0 && items.every(item => item.met),
  }
}

/** Readiness state for one exam, combining server requirements + local tracker. */
export function getApplicationStatus(requirement: ExamRequirement, started: boolean): {
  status: 'NOT_STARTED' | 'PREPARING' | 'READY_FOR_REVIEW'
} {
  if (!started) return { status: 'NOT_STARTED' }
  return { status: requirement.ready ? 'READY_FOR_REVIEW' : 'PREPARING' }
}
