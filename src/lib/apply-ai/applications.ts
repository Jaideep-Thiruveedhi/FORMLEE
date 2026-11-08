import { HUB_APPLICATION_STATUSES, HUB_STATUS_DEFINITIONS } from './application-status'
import { checkApplicationPreferenceConsistency, checkProfileSnapshotConsistency } from './consistency'
import { DOCUMENT_TYPES } from './documents'
import { EXAM_BY_ID, SUPPORT_STATUS_DEFINITIONS, findExamSession } from './exams'
import { evaluateProfile, isDocumentApplicable, isDocumentUploaded } from './requirements'
import { validateCertificateMetadata, validateDocumentAgainstSpec } from './document-validation'
import type {
  ApplicationChecklist,
  ApplicationDeadlineSnapshot,
  ApplicationDTO,
  ApplicationEvaluation,
  ApplicationReminder,
  ApplicationRequirementItem,
  ApplicationSubmission,
  ApplicationWithEvaluation,
  ConsistencyIssue,
  DeadlineState,
  DocumentId,
  ExamDefinition,
  ExamId,
  ExamRequirementCategory,
  ExamRequirementDefinition,
  ExamSessionDefinition,
  HubApplicationStatus,
  ReadinessIssue,
  RequirementCategoryProgress,
  StudentProfileData,
  UploadedDocumentDTO,
} from './types'

/**
 * Application Hub domain logic.
 *
 * Everything is derived from the saved profile, uploaded documents, the
 * student's own manual checklist confirmations, and the catalog entry. No
 * progress value is stored: progress is recomputed on every read so it can
 * never drift from the underlying requirements.
 */

export interface ApplicationRowLike {
  id: string
  workspaceId: string
  examId: string
  sessionId: string
  examSession: string
  applicationYear: number
  status: string
  preferences: unknown
  checklist: unknown
  notes: string | null
  deadlineDate: string | null
  deadlineState: string
  deadlineLabel: string | null
  deadlineSourceLabel: string | null
  deadlineSourceUrl: string | null
  deadlineVerifiedAt: Date | null
  deadlineNeedsUpdate: boolean
  studentSubmittedAt: Date | null
  portalReferenceRecordedAt: Date | null
  portalReference: string | null
  profileSnapshot?: unknown
  profileSnapshotAt?: Date | null
  profileVersion?: number | null
  mappingReviewRequired?: boolean
  mappingChangedFields?: unknown
  mappingReviewedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

const CATEGORY_LABELS: Record<ExamRequirementCategory, string> = {
  PROFILE: 'Profile',
  CONTACT: 'Contact details',
  EDUCATION: 'Education',
  PHOTOGRAPH: 'Photograph',
  SIGNATURE: 'Signature',
  IDENTITY: 'Identity documents',
  PREFERENCES: 'Preferences',
  VERIFICATION: 'Manual verification',
}

const DEADLINE_STATES: DeadlineState[] = ['ANNOUNCED', 'TENTATIVE', 'NOT_ANNOUNCED']

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeStatus(value: string): HubApplicationStatus {
  return HUB_APPLICATION_STATUSES.includes(value as HubApplicationStatus)
    ? (value as HubApplicationStatus)
    : 'NOT_STARTED'
}

export function normalizeChecklist(value: unknown): ApplicationChecklist {
  if (!isObject(value)) return {}
  const result: ApplicationChecklist = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry) || typeof entry.done !== 'boolean') continue
    result[key] = {
      done: entry.done,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    }
  }
  return result
}

export function normalizePreferences(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      result[key] = entry.trim()
    }
  }
  return result
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function isoDateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function sessionForRow(
  exam: ExamDefinition,
  row: ApplicationRowLike
): ExamSessionDefinition {
  const found = findExamSession(exam.id, row.sessionId)
  if (found) return found

  // Catalog entries can evolve between releases. Keep an existing application
  // readable with its own snapshot rather than silently relabelling it.
  const deadlineState = DEADLINE_STATES.includes(row.deadlineState as DeadlineState)
    ? (row.deadlineState as DeadlineState)
    : 'NOT_ANNOUNCED'
  return {
    id: row.sessionId,
    label: row.examSession,
    applicationYear: row.applicationYear,
    opensOn: null,
    deadline: {
      state: deadlineState,
      date: row.deadlineDate,
      label: row.deadlineLabel ?? 'Application deadline',
      source: row.deadlineSourceUrl
        ? {
            label: row.deadlineSourceLabel ?? 'Official source',
            url: row.deadlineSourceUrl,
            verifiedOn: isoDate(row.deadlineVerifiedAt) ?? '',
          }
        : null,
      needsUpdate: row.deadlineNeedsUpdate,
      note: 'This session is not in the current catalog. Verify every date on the official portal.',
    },
  }
}

export function deadlineSnapshot(
  row: ApplicationRowLike,
  exam: ExamDefinition
): ApplicationDeadlineSnapshot {
  const session = sessionForRow(exam, row)
  const catalog = session.deadline
  const catalogVerifiedOn = catalog.source?.verifiedOn ?? null
  const rowVerifiedOn = isoDate(row.deadlineVerifiedAt)
  const rowState = DEADLINE_STATES.includes(row.deadlineState as DeadlineState)
    ? (row.deadlineState as DeadlineState)
    : catalog.state

  const catalogUpdated =
    row.deadlineDate !== catalog.date ||
    rowState !== catalog.state ||
    row.deadlineSourceUrl !== (catalog.source?.url ?? null) ||
    (rowVerifiedOn !== null && catalogVerifiedOn !== null && rowVerifiedOn !== catalogVerifiedOn)

  const rowSource = row.deadlineSourceUrl
    ? {
        label: row.deadlineSourceLabel ?? catalog.source?.label ?? 'Official source',
        url: row.deadlineSourceUrl,
        verifiedOn: rowVerifiedOn ?? catalogVerifiedOn ?? '',
      }
    : catalog.source

  // If the catalog changed after this record was snapshotted, show the current
  // catalog values (not the stale snapshot) and flag that a refresh is needed.
  const displayCatalog = catalogUpdated || !row.deadlineSourceUrl

  return {
    state: displayCatalog ? catalog.state : rowState,
    date: displayCatalog ? catalog.date : row.deadlineDate,
    label: displayCatalog ? catalog.label : (row.deadlineLabel ?? catalog.label),
    source: displayCatalog ? catalog.source : rowSource,
    verifiedAt: displayCatalog ? catalogVerifiedOn : rowVerifiedOn,
    needsUpdate: row.deadlineNeedsUpdate || catalog.needsUpdate || catalogUpdated,
    note: catalog.note,
    catalogUpdated,
  }
}

export function submissionForRow(row: ApplicationRowLike): ApplicationSubmission {
  return {
    studentConfirmedAt: isoDateTime(row.studentSubmittedAt),
    portalReferenceRecordedAt: isoDateTime(row.portalReferenceRecordedAt),
    portalReference: row.portalReference,
    portalVerification: row.portalReferenceRecordedAt ? 'STUDENT_RECORDED' : 'NONE',
  }
}

export function toApplicationDTO(
  row: ApplicationRowLike,
  exam: ExamDefinition
): ApplicationDTO {
  const session = sessionForRow(exam, row)
  return {
    id: row.id,
    examId: exam.id,
    examName: exam.name,
    examFullName: exam.fullName,
    examOrganizer: exam.organizer,
    examIcon: exam.icon,
    officialWebsite: exam.officialWebsite,
    supportStatus: exam.supportStatus,
    supportNote: exam.supportNote,
    sessionId: session.id,
    sessionLabel: session.label,
    examSession: row.examSession,
    applicationYear: row.applicationYear,
    status: normalizeStatus(row.status),
    preferences: normalizePreferences(row.preferences),
    checklist: normalizeChecklist(row.checklist),
    notes: row.notes,
    deadline: deadlineSnapshot(row, exam),
    submission: submissionForRow(row),
    profileSnapshotAt: isoDateTime(row.profileSnapshotAt),
    profileVersion: row.profileVersion ?? null,
    mappingReviewRequired: row.mappingReviewRequired === true,
    mappingChangedFields: stringList(row.mappingChangedFields),
    mappingReviewedAt: isoDateTime(row.mappingReviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function requirementHref(
  applicationId: string,
  requirement: ExamRequirementDefinition
): string {
  if (requirement.kind === 'profile-section' && requirement.sectionId) {
    return `/apply/profile#profile-section-${requirement.sectionId}`
  }
  if (requirement.kind === 'document' && requirement.documentType) {
    return `/apply/documents#document-type-${requirement.documentType}`
  }
  return `/apply/applications/${applicationId}#requirement-${requirement.id}`
}

function conditionApplies(
  requirement: ExamRequirementDefinition,
  profile: unknown
): boolean {
  if (requirement.conditional === 'PWD') return isDocumentApplicable('PWD_CERTIFICATE', profile)
  if (requirement.conditional === 'CATEGORY') {
    return isDocumentApplicable('CATEGORY_CERTIFICATE', profile)
  }
  return true
}

/**
 * The generic profile's preferences section has no mandatory text fields, so
 * `evaluateProfile` treats it as complete even for a blank profile. For an
 * application-specific preferences requirement that would fabricate progress,
 * so require at least one actual preference value (profile or application).
 */
function hasPreferenceEvidence(profile: unknown, applicationPreferences: unknown): boolean {
  if (Object.keys(normalizePreferences(applicationPreferences)).length > 0) return true
  if (!isObject(profile)) return false
  for (const key of ['category', 'homeState']) {
    const value = profile[key]
    if (typeof value === 'string' && value.trim().length > 0) return true
  }
  const cities = profile.preferredExamCities
  return Array.isArray(cities) && cities.length > 0
}

export function evaluateApplication(
  row: ApplicationRowLike,
  exam: ExamDefinition,
  profile: unknown,
  documents: UploadedDocumentDTO[],
  options: {
    documentDimensions?: Map<string, { width: number; height: number }>
  } = {}
): ApplicationEvaluation {
  const profileEvaluation = evaluateProfile(profile)
  const checklist = normalizeChecklist(row.checklist)
  const typedProfile = profile as StudentProfileData | null
  const documentDimensions = options.documentDimensions ?? new Map()

  const applicableCoreDocs = DOCUMENT_TYPES.filter(
    doc => doc.id !== 'OTHER' && isDocumentApplicable(doc.id, profile)
  )
  const uploadedCoreDocs = applicableCoreDocs.filter(doc =>
    isDocumentUploaded(doc.id, documents)
  )

  const officialChecklistAvailable =
    exam.requirementsPublished && exam.requirements.length > 0

  const items: ApplicationRequirementItem[] = []
  const missingProfileLabels: string[] = []
  const missingDocumentLabels: string[] = []
  const needsConfirmationLabels: string[] = []
  const awaitingResultsLabels: string[] = []

  for (const requirement of exam.requirements) {
    let state: ApplicationRequirementItem['state'] = 'MISSING'
    let met = false
    const issues: ReadinessIssue[] = []

    if (requirement.kind === 'profile-section' && requirement.sectionId) {
      const section = profileEvaluation.sections.find(
        item => item.sectionId === requirement.sectionId
      )
      met = section?.done ?? false
      if (met && requirement.sectionId === 'preferences') {
        met = hasPreferenceEvidence(profile, row.preferences)
      }

      if (section?.state === 'AWAITING_RESULTS' && met) {
        state = 'AWAITING_RESULTS'
        awaitingResultsLabels.push(section.note ?? requirement.label)
      } else if (section?.state === 'NEEDS_CONFIRMATION') {
        state = 'NEEDS_CONFIRMATION'
        needsConfirmationLabels.push(...section.missingLabels)
      } else if (section?.state === 'NOT_APPLICABLE') {
        state = 'NOT_APPLICABLE'
      } else {
        state = met ? 'COMPLETE' : 'MISSING'
        if (!met) {
          if (section && section.missingLabels.length > 0) {
            missingProfileLabels.push(...section.missingLabels)
          } else {
            missingProfileLabels.push(requirement.label)
          }
        }
      }

      if (section?.state === 'PARTIAL' && section.missingLabels.length === 0) {
        missingProfileLabels.push(requirement.label)
      }
    } else if (requirement.kind === 'document' && requirement.documentType) {
      if (!conditionApplies(requirement, profile)) {
        state = 'NOT_APPLICABLE'
      } else {
        const docsOfType = documents.filter(d => d.documentType === requirement.documentType && d.isCurrent !== false)
        const uploadedDoc = docsOfType[0]
        met = !!uploadedDoc
        if (met && requirement.documentSpec && uploadedDoc) {
          const dimensions = documentDimensions.get(uploadedDoc.id)
          const specIssues = validateDocumentAgainstSpec(uploadedDoc, requirement.documentSpec, dimensions ?? null)
          issues.push(...specIssues)
        }
        if (met) {
          const certIssues = docsOfType.flatMap(doc => validateCertificateMetadata(doc, profile))
          issues.push(...certIssues)
        }
        state = met ? (issues.length > 0 ? 'ATTENTION_REQUIRED' : 'COMPLETE') : 'MISSING'
        if (!met) missingDocumentLabels.push(requirement.label)
      }
    } else if (requirement.kind === 'manual') {
      met = checklist[requirement.id]?.done === true
      state = met ? 'COMPLETE' : 'AWAITING_STUDENT'
    }

    items.push({
      id: requirement.id,
      kind: requirement.kind,
      category: requirement.category,
      label: requirement.label,
      detail: requirement.detail,
      state,
      met,
      href: requirementHref(row.id, requirement),
      source: requirement.source,
      manualInstruction: requirement.manualInstruction ?? null,
      issues,
    })
  }

  const applicableItems = items.filter(item => item.state !== 'NOT_APPLICABLE')
  const completeCount = applicableItems.filter(item => item.met && item.issues.length === 0).length
  const missingCount = applicableItems.filter(item => item.state === 'MISSING').length
  const awaitingStudentCount = applicableItems.filter(
    item => item.state === 'AWAITING_STUDENT'
  ).length
  const needsConfirmationCount = applicableItems.filter(
    item => item.state === 'NEEDS_CONFIRMATION'
  ).length
  const awaitingResultsCount = applicableItems.filter(
    item => item.state === 'AWAITING_RESULTS'
  ).length
  const attentionRequiredCount = applicableItems.filter(
    item => item.state === 'ATTENTION_REQUIRED'
  ).length

  const documentIssues = items
    .flatMap(item => item.issues)
    .filter(issue => issue.documentId)
  const certificateIssues = documentIssues.filter(issue =>
    issue.code.startsWith('CERT_')
  )

  const categoryMap = new Map<ExamRequirementCategory, RequirementCategoryProgress>()
  for (const item of applicableItems) {
    const current = categoryMap.get(item.category) ?? {
      category: item.category,
      label: CATEGORY_LABELS[item.category],
      complete: 0,
      total: 0,
    }
    current.total += 1
    if (item.met && item.issues.length === 0) current.complete += 1
    categoryMap.set(item.category, current)
  }

  const progressPercent =
    officialChecklistAvailable && applicableItems.length > 0
      ? Math.round((completeCount / applicableItems.length) * 100)
      : null

  const missingProfileItem = applicableItems.find(
    item => item.kind === 'profile-section' && !item.met
  )
  const missingDocumentItem = applicableItems.find(
    item => item.kind === 'document' && !item.met
  )
  const attentionItem = applicableItems.find(
    item => item.state === 'ATTENTION_REQUIRED'
  )
  const awaitingItem = applicableItems.find(
    item => item.state === 'AWAITING_STUDENT'
  )
  const confirmationItem = applicableItems.find(
    item => item.state === 'NEEDS_CONFIRMATION'
  )

  let nextAction: ApplicationEvaluation['nextAction'] = null
  if (officialChecklistAvailable) {
    if (confirmationItem) {
      nextAction = {
        label: `Confirm in profile: ${confirmationItem.label}`,
        href: confirmationItem.href,
        kind: 'profile',
      }
    } else if (missingProfileItem) {
      nextAction = {
        label: `Complete profile: ${missingProfileItem.label}`,
        href: missingProfileItem.href,
        kind: 'profile',
      }
    } else if (attentionItem) {
      nextAction = {
        label: `Fix document issue: ${attentionItem.label}`,
        href: attentionItem.href,
        kind: 'documents',
      }
    } else if (missingDocumentItem) {
      nextAction = {
        label: `Upload: ${missingDocumentItem.label}`,
        href: missingDocumentItem.href,
        kind: 'documents',
      }
    } else if (awaitingItem) {
      nextAction = {
        label: `Review checklist: ${awaitingItem.label}`,
        href: awaitingItem.href,
        kind: 'checklist',
      }
    } else if (exam.officialWebsite) {
      nextAction = {
        label: 'Open the official portal',
        href: exam.officialWebsite,
        kind: 'portal',
      }
    }
  } else if (!profileEvaluation.status || profileEvaluation.status !== 'COMPLETE') {
    nextAction = {
      label: 'Complete your reusable profile',
      href: '/apply/profile',
      kind: 'profile',
    }
  } else if (uploadedCoreDocs.length < applicableCoreDocs.length) {
    nextAction = {
      label: 'Upload your reusable documents',
      href: '/apply/documents',
      kind: 'documents',
    }
  } else if (exam.officialWebsite) {
    nextAction = {
      label: 'Check the official source',
      href: exam.officialWebsite,
      kind: 'portal',
    }
  }

  const consistencyIssues: ConsistencyIssue[] = [
    ...checkProfileSnapshotConsistency(typedProfile, row.profileSnapshot),
    ...checkApplicationPreferenceConsistency(typedProfile, normalizePreferences(row.preferences)),
  ]

  const rowProfileVersion = row.profileVersion ?? null
  const snapshotStale = row.profileSnapshot !== null && rowProfileVersion !== null &&
    typedProfile !== null && typedProfile.profileVersion > rowProfileVersion

  let readinessState: ApplicationEvaluation['readinessState'] = 'NOT_APPLICABLE'
  if (!officialChecklistAvailable) {
    readinessState = 'NOT_APPLICABLE'
  } else if (attentionRequiredCount > 0) {
    readinessState = 'DOCUMENT_ATTENTION_REQUIRED'
  } else if (needsConfirmationCount > 0) {
    readinessState = 'NEEDS_CONFIRMATION'
  } else if (missingCount > 0) {
    readinessState = 'MISSING_INFORMATION'
  } else if (awaitingResultsCount > 0 || awaitingStudentCount > 0 || consistencyIssues.length > 0 || snapshotStale) {
    readinessState = 'PARTIALLY_READY'
  } else {
    readinessState = 'READY'
  }

  return {
    officialChecklistAvailable,
    requirementsNote: exam.requirementsNote,
    items,
    completeCount,
    applicableCount: applicableItems.length,
    missingCount,
    awaitingStudentCount,
    needsConfirmationCount,
    awaitingResultsCount,
    attentionRequiredCount,
    progressPercent,
    categoryBreakdown: Array.from(categoryMap.values()),
    missingProfileLabels: Array.from(new Set(missingProfileLabels)),
    missingDocumentLabels: Array.from(new Set(missingDocumentLabels)),
    needsConfirmationLabels: Array.from(new Set(needsConfirmationLabels)),
    awaitingResultsLabels: Array.from(new Set(awaitingResultsLabels)),
    reusableWorkspace: {
      sectionsComplete: profileEvaluation.completedSections,
      sectionsTotal: profileEvaluation.totalSections,
      documentsUploaded: uploadedCoreDocs.length,
      documentsTotal: applicableCoreDocs.length,
    },
    allRequirementsMet:
      officialChecklistAvailable &&
      applicableItems.length > 0 &&
      completeCount === applicableItems.length &&
      attentionRequiredCount === 0 &&
      consistencyIssues.length === 0 &&
      !snapshotStale,
    nextAction,
    readinessState,
    documentIssues,
    certificateIssues,
    consistencyIssues,
    snapshotStale,
  }
}

export function withEvaluation(
  row: ApplicationRowLike,
  profile: unknown,
  documents: UploadedDocumentDTO[],
  documentDimensions?: Map<string, { width: number; height: number }>
): ApplicationWithEvaluation {
  const exam = EXAM_BY_ID[row.examId as ExamId]
  if (!exam) {
    throw new Error(`Unknown examination in application record: ${row.examId}`)
  }
  return {
    ...toApplicationDTO(row, exam),
    evaluation: evaluateApplication(row, exam, profile, documents, {
      documentDimensions,
    }),
  }
}

export function supportDefinition(exam: ExamDefinition) {
  return SUPPORT_STATUS_DEFINITIONS[exam.supportStatus]
}

export function deadlineDaysUntil(date: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86_400_000)
}

const SEVERITY_RANK = { urgent: 0, warning: 1, info: 2 } as const

export function buildReminders(
  applications: ApplicationWithEvaluation[],
  now = new Date()
): ApplicationReminder[] {
  const reminders: ApplicationReminder[] = []

  for (const application of applications) {
    const submitted = HUB_STATUS_DEFINITIONS[application.status].submitted
    const href = `/apply/applications/${application.id}`

    if (!submitted && application.deadline.date) {
      const days = deadlineDaysUntil(application.deadline.date, now)
      if (days !== null) {
        const tentative =
          application.deadline.state === 'TENTATIVE' ? 'Tentative deadline: ' : ''
        if (days < 0) {
          reminders.push({
            id: `${application.id}-deadline-passed`,
            applicationId: application.id,
            examName: application.examName,
            kind: 'deadline',
            title: `${application.examName} deadline has passed`,
            detail: `${tentative}${application.deadline.label} was ${formatDateOnly(application.deadline.date)}. You have not marked this application as submitted. Check the official portal for any officially announced late window.`,
            href,
            severity: 'urgent',
          })
        } else if (days <= 30) {
          reminders.push({
            id: `${application.id}-deadline-soon`,
            applicationId: application.id,
            examName: application.examName,
            kind: 'deadline',
            title: `${tentative}${application.examName} deadline in ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}`,
            detail: `${application.deadline.label}: ${formatDateOnly(application.deadline.date)}. Confirm the exact time and any late-window rules on the official portal.`,
            href,
            severity: days <= 7 ? 'urgent' : 'warning',
          })
        }
      }
    }

    if (!submitted && application.evaluation.missingProfileLabels.length > 0) {
      reminders.push({
        id: `${application.id}-profile`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'profile',
        title: `${application.examName}: missing profile information`,
        detail: application.evaluation.missingProfileLabels.slice(0, 4).join(', ') +
          (application.evaluation.missingProfileLabels.length > 4 ? '…' : ''),
        href,
        severity: 'warning',
      })
    }

    if (!submitted && application.evaluation.missingDocumentLabels.length > 0) {
      reminders.push({
        id: `${application.id}-document`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'document',
        title: `${application.examName}: missing document${application.evaluation.missingDocumentLabels.length === 1 ? '' : 's'}`,
        detail: application.evaluation.missingDocumentLabels.join(', '),
        href,
        severity: 'warning',
      })
    }

    if (!submitted && application.evaluation.attentionRequiredCount > 0) {
      reminders.push({
        id: `${application.id}-attention`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'document',
        title: `${application.examName}: document/certification issue${application.evaluation.attentionRequiredCount === 1 ? '' : 's'}`,
        detail: application.evaluation.documentIssues
          .concat(application.evaluation.certificateIssues)
          .slice(0, 3)
          .map(issue => issue.message)
          .join(' · '),
        href,
        severity: 'warning',
      })
    }

    if (!submitted && application.evaluation.consistencyIssues.length > 0) {
      reminders.push({
        id: `${application.id}-consistency`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'review',
        title: `${application.examName}: information differs from vault`,
        detail: application.evaluation.consistencyIssues.map(issue => issue.field).join(', '),
        href,
        severity: 'warning',
      })
    }

    if (application.evaluation.snapshotStale) {
      reminders.push({
        id: `${application.id}-snapshot`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'review',
        title: `${application.examName}: vault snapshot is newer`,
        detail: 'Review the refreshed mapping before filling anything on the official portal.',
        href,
        severity: 'warning',
      })
    }

    if (application.mappingReviewRequired) {
      reminders.push({
        id: `${application.id}-profile-review`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'review',
        title: `${application.examName}: your profile changed`,
        detail:
          'The vault values used for this application have changed. Open it and review the refreshed mapping before filling anything on the official portal.',
        href,
        severity: 'warning',
      })
    }

    if (application.status === 'FILLED_AWAITING_STUDENT_REVIEW') {
      reminders.push({
        id: `${application.id}-review`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'review',
        title: `${application.examName} is awaiting your review`,
        detail: 'You marked the form as filled, but it is not submitted. Review the official portal and confirm submission yourself when ready.',
        href,
        severity: 'warning',
      })
    }

    if (application.status === 'WAITING_FOR_MANUAL_VERIFICATION') {
      reminders.push({
        id: `${application.id}-verification`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'verification',
        title: `${application.examName} is waiting for manual verification`,
        detail: 'A portal, payment or document step is still pending. Formlee cannot complete or verify it for you.',
        href,
        severity: 'info',
      })
    }

    const staleDays = Math.floor(
      (now.getTime() - new Date(application.updatedAt).getTime()) / 86_400_000
    )
    if (!submitted && staleDays >= 21) {
      reminders.push({
        id: `${application.id}-stale`,
        applicationId: application.id,
        examName: application.examName,
        kind: 'stale',
        title: `${application.examName} has not been updated recently`,
        detail: `Last update was ${staleDays} days ago. Check the official source and update your status if anything changed.`,
        href,
        severity: 'info',
      })
    }
  }

  return reminders
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 12)
}

export function formatDateOnly(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function documentTypeLabel(documentType: DocumentId): string {
  return DOCUMENT_TYPES.find(doc => doc.id === documentType)?.label ?? documentType
}
