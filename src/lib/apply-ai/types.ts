export type ExamId = 'JEE_MAIN' | 'BITSAT' | 'VITEEE' | 'MET' | 'CUET_UG'

export type ApplicationStatus = 'NOT_STARTED' | 'PREPARING' | 'READY_FOR_REVIEW'

export type ProfileStatus = 'INCOMPLETE' | 'IN_PROGRESS' | 'COMPLETE'

export type ProfileSectionId =
  | 'personal'
  | 'family'
  | 'address'
  | 'class10'
  | 'class12'
  | 'category'
  | 'preferences'

export type ProfileSectionState =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'NEEDS_CONFIRMATION'
  | 'NOT_APPLICABLE'
  | 'AWAITING_RESULTS'

export type Class12Status = 'APPEARING' | 'RESULT_AWAITED' | 'PASSED'

export type MarksKind = 'PERCENTAGE' | 'GRADE' | 'CGPA'

export interface SubjectEntry {
  name: string
  kind: MarksKind
  value: string
}

export interface StudentProfileData {
  id: string
  fullName: string | null
  gender: string | null
  dateOfBirth: string | null
  email: string | null
  mobileNumber: string | null
  nationality: string | null
  nationalityOther: string | null

  fatherName: string | null
  motherName: string | null
  guardianName: string | null
  guardianRelation: string | null
  parentMobile: string | null
  parentEmail: string | null
  parentOccupation: string | null

  permanentAddressLine: string | null
  permanentCity: string | null
  permanentDistrict: string | null
  permanentState: string | null
  permanentPinCode: string | null
  permanentCountry: string | null

  currentSameAsPermanent: boolean
  currentAddressLine: string | null
  currentCity: string | null
  currentDistrict: string | null
  currentState: string | null
  currentPinCode: string | null
  currentCountry: string | null

  /** Legacy single-address fields retained for older records/clients. */
  addressLine: string | null
  city: string | null
  state: string | null
  pinCode: string | null

  class10Board: string | null
  class10SchoolName: string | null
  class10PassingYear: number | null
  class10RollNumber: string | null
  class10MarksKind: string | null
  class10Marks: string | null
  class10Percentage: string | null
  class10Subjects: SubjectEntry[] | null

  class12Status: Class12Status | null
  class12Board: string | null
  class12SchoolName: string | null
  class12ExamYear: number | null
  class12PassingYear: number | null
  class12RollNumber: string | null
  class12MarksKind: string | null
  class12Marks: string | null
  class12Percentage: string | null
  class12Subjects: SubjectEntry[] | null
  class12ResultDeclaredAt: string | null
  class12ResultUpdatedAt: string | null

  category: string | null
  categoryOtherDetail: string | null
  categoryConfirmed: boolean
  categoryConfirmedAt: string | null
  pwdStatus: boolean
  pwdStatusConfirmed: boolean
  pwdCertificateDocumentId: string | null

  categoryCertificateType: string | null
  categoryCertificateDocumentId: string | null
  categoryCertificateNumber: string | null
  categoryCertificateAuthority: string | null
  categoryCertificateJurisdiction: string | null
  categoryCertificateIssueDate: string | null
  categoryCertificateValidUntil: string | null
  categoryCertificateFinancialYear: string | null
  categoryCertificateVerificationStatus: string | null
  categoryCertificateLastConfirmedAt: string | null

  homeState: string | null
  preferredExamCities: string[] | null
  profileVersion: number
  lastMajorUpdateAt: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentId =
  | 'PHOTO'
  | 'SIGNATURE'
  | 'CLASS10_MARKSHEET'
  | 'CLASS12_MARKSHEET'
  | 'CLASS12_PASSING_CERTIFICATE'
  | 'CATEGORY_CERTIFICATE'
  | 'PWD_CERTIFICATE'
  | 'IDENTITY_DOCUMENT'
  | 'ADDRESS_PROOF'
  | 'OTHER'

export interface DocumentCertificateMetadata {
  certificateNumber: string | null
  issuingAuthority: string | null
  issuingState: string | null
  issueDate: string | null
  validUntil: string | null
  financialYear: string | null
  verificationStatus: string
  lastConfirmedAt: string | null
}

export interface UploadedDocumentDTO {
  id: string
  documentType: DocumentId
  displayLabel: string | null
  originalName: string
  mimeType: string
  sizeBytes: number
  versions: number
  createdAt: string
  replacedAt: string | null
  isCurrent: boolean
  supersedesId: string | null
  certificate: DocumentCertificateMetadata
  /** True when an older version still exists in the private vault. */
  hasPreviousVersions: boolean
  /** The random on-disk filename is intentionally never exposed to clients. */
}

/** Form rendering definition for one profile field. */
export interface ProfileFieldDef {
  id: string
  label: string
  type:
    | 'text'
    | 'textarea'
    | 'email'
    | 'tel'
    | 'date'
    | 'number'
    | 'select'
    | 'boolean'
    | 'address'
    | 'subjects'
    | 'cities'
  required: boolean
  placeholder?: string
  help?: string
  options?: { value: string; label: string }[]
  subjectListKey?: 'class10Subjects' | 'class12Subjects'
  subjectRequired?: boolean
  /** Show this field only when another field currently equals one of these values. */
  visibleWhen?: { field: string; equals: string[] }
  /** Render across both columns. */
  wide?: boolean
}

export interface ProfileSectionDef {
  id: ProfileSectionId
  title: string
  description: string
  icon: string
  fields: ProfileFieldDef[]
}

export interface DocumentTypeDef {
  id: DocumentId
  label: string
  description: string
  icon: string
  /** true when the document only applies for certain profile answers (certificates). */
  conditional: boolean
  /** Guidance text — always points students to the official notification. */
  guidance: string
}

/* ---------------- Examination catalog (Application Hub) ---------------- */

/**
 * Support status describes what Formly can do beyond listing the exam. It is
 * deliberately separate from deadline state: an exam can have announced dates
 * while its form-filling support is still "Track only".
 */
export type ExamSupportStatus =
  | 'SUPPORTED'
  | 'BETA'
  | 'DEMO_ONLY'
  | 'COMING_SOON'
  | 'TRACK_ONLY'
  | 'APPLICATION_CLOSED'
  | 'DATES_NOT_ANNOUNCED'

export type DeadlineState = 'ANNOUNCED' | 'TENTATIVE' | 'NOT_ANNOUNCED'

export interface ExamSource {
  label: string
  url: string
  /** ISO date (YYYY-MM-DD) on which the source was last checked. */
  verifiedOn: string
}

export interface ExamDeadline {
  state: DeadlineState
  /** Date-only ISO value (YYYY-MM-DD); never a fabricated placeholder. */
  date: string | null
  label: string
  source: ExamSource | null
  /** True when the official body has not published a complete, current date. */
  needsUpdate: boolean
  note: string
}

export interface ExamSessionDefinition {
  /** Stable catalog id, stored on application records. */
  id: string
  label: string
  applicationYear: number
  /** ISO date on which the application window opened, when officially stated. */
  opensOn: string | null
  deadline: ExamDeadline
}

export type ExamRequirementKind = 'profile-section' | 'document' | 'manual'

export type ExamRequirementCategory =
  | 'PROFILE'
  | 'CONTACT'
  | 'EDUCATION'
  | 'PHOTOGRAPH'
  | 'SIGNATURE'
  | 'IDENTITY'
  | 'PREFERENCES'
  | 'VERIFICATION'

export interface DocumentSpec {
  /** Allowed MIME types, e.g. ['image/jpeg']. Null means not verified by Formly. */
  mimeTypes?: string[]
  /** Size range in bytes. */
  minBytes?: number
  maxBytes?: number
  /** Required image dimensions in pixels. Null means not verified by Formly. */
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  /** Human-readable official requirement text. */
  spec: string
}

export interface ExamRequirementDefinition {
  id: string
  kind: ExamRequirementKind
  category: ExamRequirementCategory
  label: string
  detail: string
  /** For kind === 'profile-section'. */
  sectionId?: ProfileSectionId
  /** For kind === 'document'. */
  documentType?: DocumentId
  /** Verified file/size/dimension requirements, where Formly has a source. */
  documentSpec?: DocumentSpec
  /** Conditional document rows are omitted when they do not apply to the student. */
  conditional?: 'PWD' | 'CATEGORY'
  /** Official instruction backing this item. */
  source: ExamSource
  /** For kind === 'manual': what the student is confirming, never an eligibility claim. */
  manualInstruction?: string
}

export interface ExamPreferenceField {
  id: string
  label: string
  placeholder: string
  help?: string
  maxLength: number
}

export interface ExamDefinition {
  id: ExamId
  name: string
  fullName: string
  organizer: string
  description: string
  icon: string
  /** Verified official application/information website, or null when not verified. */
  officialWebsite: string | null
  supportStatus: ExamSupportStatus
  supportNote: string
  /** Browser agent adapter id when the examination has an adapter; omit when unsupported. */
  agentAdapterId?: string
  applicationSessions: ExamSessionDefinition[]
  requirementsPublished: boolean
  requirementsNote: string
  requirements: ExamRequirementDefinition[]
  preferenceFields: ExamPreferenceField[]
  /** ISO date on which this catalog entry was last checked. */
  catalogVerifiedOn: string
  /** Profile sections this exam's preparation reuses (legacy readiness view). */
  requiredSections: ProfileSectionId[]
  /** Base documents every applicant must keep ready (general aid, verify officially). */
  requiredDocIds: DocumentId[]
}

export interface ApplicationRecord {
  startedAt: string | null
  updatedAt: string | null
}

/* ---------------- Application Hub records ---------------- */

export type HubApplicationStatus =
  | 'NOT_STARTED'
  | 'PREPARING'
  | 'MISSING_INFORMATION'
  | 'READY_TO_FILL'
  | 'FILLING_IN_PROGRESS'
  | 'FILLED_AWAITING_STUDENT_REVIEW'
  | 'WAITING_FOR_MANUAL_VERIFICATION'
  | 'SUBMITTED_STUDENT_CONFIRMED'
  | 'PORTAL_CONFIRMATION_RECORDED'

export interface ApplicationChecklistEntry {
  done: boolean
  updatedAt: string
}

export type ApplicationChecklist = Record<string, ApplicationChecklistEntry>

export type PortalVerification = 'NONE' | 'STUDENT_RECORDED'

export interface ApplicationSubmission {
  studentConfirmedAt: string | null
  portalReferenceRecordedAt: string | null
  portalReference: string | null
  /** Formly never independently verifies a submission with an examination body. */
  portalVerification: PortalVerification
}

export interface ApplicationDeadlineSnapshot {
  state: DeadlineState
  date: string | null
  label: string
  source: ExamSource | null
  verifiedAt: string | null
  needsUpdate: boolean
  note: string
  /** Deadline source changed in the catalog after this record was snapshotted. */
  catalogUpdated: boolean
}

export interface ApplicationDTO {
  id: string
  examId: ExamId
  examName: string
  examFullName: string
  examOrganizer: string
  examIcon: string
  officialWebsite: string | null
  supportStatus: ExamSupportStatus
  supportNote: string
  sessionId: string
  sessionLabel: string
  examSession: string
  applicationYear: number
  status: HubApplicationStatus
  preferences: Record<string, string>
  checklist: ApplicationChecklist
  notes: string | null
  deadline: ApplicationDeadlineSnapshot
  submission: ApplicationSubmission
  /** Snapshot metadata for the canonical vault mapping used by this application. */
  profileSnapshotAt: string | null
  profileVersion: number | null
  mappingReviewRequired: boolean
  mappingChangedFields: string[]
  mappingReviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RequirementItemState =
  | 'COMPLETE'
  | 'MISSING'
  | 'AWAITING_STUDENT'
  | 'NEEDS_CONFIRMATION'
  | 'AWAITING_RESULTS'
  | 'NOT_APPLICABLE'
  | 'ATTENTION_REQUIRED'

export interface ReadinessIssue {
  severity: 'info' | 'warning' | 'urgent'
  code: string
  message: string
  field?: string
  documentId?: DocumentId
}

export interface ApplicationRequirementItem {
  id: string
  kind: ExamRequirementKind
  category: ExamRequirementCategory
  label: string
  detail: string
  state: RequirementItemState
  met: boolean
  href: string
  source: ExamSource
  manualInstruction: string | null
  /** Actionable warnings for this requirement (e.g. wrong file size, expired certificate). */
  issues: ReadinessIssue[]
}

export interface ConsistencyIssue {
  field: string
  vaultValue: string | null
  applicationValue: string | null
  message: string
}

export interface RequirementCategoryProgress {
  category: ExamRequirementCategory
  label: string
  complete: number
  total: number
}

export interface ReusableWorkspaceProgress {
  sectionsComplete: number
  sectionsTotal: number
  documentsUploaded: number
  documentsTotal: number
}

export interface ApplicationEvaluation {
  /** False when the official 2027 checklist has not been published; Formly does not invent one. */
  officialChecklistAvailable: boolean
  requirementsNote: string
  items: ApplicationRequirementItem[]
  completeCount: number
  applicableCount: number
  missingCount: number
  awaitingStudentCount: number
  needsConfirmationCount: number
  awaitingResultsCount: number
  attentionRequiredCount: number
  /** Null when no official checklist exists or no item applies. Never invented. */
  progressPercent: number | null
  categoryBreakdown: RequirementCategoryProgress[]
  missingProfileLabels: string[]
  missingDocumentLabels: string[]
  needsConfirmationLabels: string[]
  awaitingResultsLabels: string[]
  reusableWorkspace: ReusableWorkspaceProgress
  allRequirementsMet: boolean
  nextAction: { label: string; href: string; kind: 'profile' | 'documents' | 'checklist' | 'portal' } | null
  /** Overall readiness state for dashboard display. */
  readinessState:
    | 'READY'
    | 'PARTIALLY_READY'
    | 'MISSING_INFORMATION'
    | 'NEEDS_CONFIRMATION'
    | 'DOCUMENT_ATTENTION_REQUIRED'
    | 'NOT_APPLICABLE'
  /** Document/file validation issues. */
  documentIssues: ReadinessIssue[]
  /** Certificate metadata validation issues. */
  certificateIssues: ReadinessIssue[]
  /** Differences between the vault snapshot and the application record/preferences. */
  consistencyIssues: ConsistencyIssue[]
  /** True when the application record has a stale vault snapshot. */
  snapshotStale: boolean
}

export interface ApplicationWithEvaluation extends ApplicationDTO {
  evaluation: ApplicationEvaluation
}

export interface ApplicationReminder {
  id: string
  applicationId: string | null
  examName: string | null
  kind: 'deadline' | 'profile' | 'document' | 'review' | 'verification' | 'stale'
  title: string
  detail: string
  href: string
  severity: 'info' | 'warning' | 'urgent'
}

/** One configured requirement item for an exam's readiness computation. */
export interface RequirementItem {
  id: string
  kind: 'profile-section' | 'document'
  label: string
  detail: string
  met: boolean
  /** Where the student goes to complete this requirement. */
  href: string
}

export interface ExamRequirement {
  examId: ExamId
  items: RequirementItem[]
  metCount: number
  totalCount: number
  /** True only when every configured requirement item is met. */
  ready: boolean
}
