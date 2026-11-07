/**
 * JEE Main 2027 (Session 1) portal adapter.
 *
 * This module is deliberately self-contained (no runtime imports from the rest
 * of the application) so the deterministic rules can be unit-tested directly
 * and reused by the existing generic mapper without creating a second agent.
 *
 * Sources (verified 31 October 2026):
 *  - https://jeemain.nta.nic.in/
 *  - https://jeemain.nta.nic.in/online-application-form-for-jee-main-2027-session-1/
 *  - Information Bulletin 2027, Appendix VI "Replica of Application Form"
 *  - Public notice dated 24.10.2026
 *
 * The adapter is DOCUMENTATION-BACKED, NOT LIVE-PORTAL-VERIFIED. The actual
 * application pages sit behind NTA registration/login, which this project does
 * not automate. Every rule below is therefore limited to labels that were
 * verified in the official bulletin. Anything else is deliberately manual.
 */

import type {
  AgentAdapter,
  AgentAdapterDocumentSpec,
  AgentAdapterId,
  AgentAdapterSource,
  AgentFieldDescriptorLike,
  AgentMappingDecision,
} from './adapter-types'

export const JEE_MAIN_ADAPTER = 'jee-main-2027' as const
export const JEE_MAIN_ADAPTER_VERSION = '2027.1'
export const JEE_MAIN_STATUS_LABEL = 'Beta — documentation-backed adapter; live portal not verified'
export const JEE_MAIN_VERIFIED_ON = '31 October 2026'

/** Exact official application origin + path verified from the NTA page. */
export const JEE_MAIN_PORTAL_ORIGIN = 'https://examinationservices.nic.in'
export const JEE_MAIN_PORTAL_PATH_PREFIX = '/JeeMaink2027/'

/** Synthetic local fixtures (never official pages). */
export const JEE_MAIN_FIXTURE_PATH = '/apply/agent/jee-main-2027-demo'
export const GENERIC_DEMO_PATH = '/apply/agent/demo-form'

export type AgentPageAdapter = 'generic' | 'jee-main-2027' | 'none'
export type AgentPageKind =
  | 'generic'
  | 'personal'
  | 'qualification'
  | 'exam'
  | 'documents'
  | 'declaration'
  | 'login'
  | 'unknown'

export type FillableJeePageKind = 'personal' | 'qualification'

export interface AgentPageContext {
  /** Origin + pathname only. Query strings and fragments are never accepted. */
  url: string
  kind: AgentPageKind
  fingerprint?: string
}

export interface AgentPageClassification {
  adapter: AgentPageAdapter
  sanitizedUrl: string | null
  official: boolean
  fixture: boolean
  reason: string
}

/**
 * The only profile fields the JEE Main adapter may ever map. This is narrower
 * than the generic agent on purpose: parent names, nationality, eligibility
 * state, address components, exam choices, identity documents, declarations
 * and uploads are not represented or are too sensitive to automate.
 */
export const JEE_MAIN_FILLABLE_CANONICALS = [
  'fullName',
  'gender',
  'dateOfBirth',
  'dateOfBirthDay',
  'dateOfBirthMonth',
  'dateOfBirthYear',
  'email',
  'mobileNumber',
  'category',
  'class10Board',
  'class12Board',
  'class10PassingYear',
  'class12PassingYear',
  'class10RollNumber',
  'class12RollNumber',
] as const

export type JeeMainFillableField = (typeof JEE_MAIN_FILLABLE_CANONICALS)[number]

export const JEE_MAIN_SOURCES = [
  {
    label: 'JEE (Main) 2027 official homepage',
    url: 'https://jeemain.nta.nic.in/',
  },
  {
    label: 'Online Application Form for JEE (Main) 2027 — Session 1 (published 24 Oct 2026)',
    url: 'https://jeemain.nta.nic.in/online-application-form-for-jee-main-2027-session-1/',
  },
  {
    label: 'JEE (Main) 2027 Information Bulletin (PDF, Appendix VI contains the application-form replica)',
    url: 'https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/202610241890224107.pdf',
  },
  {
    label: 'NTA public notice dated 24 October 2026 (PDF)',
    url: 'https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/20261024390682350.pdf',
  },
] as const

export const JEE_MAIN_DOCUMENT_SPECS = [
  {
    label: 'Photograph',
    spec: 'JPG/JPEG, 10–200 kB, colour, 80% face with ears and no mask, white background. The portal also requires a live photograph captured during the application.',
  },
  {
    label: 'Signature',
    spec: 'JPG/JPEG, 10–100 kB, clearly legible.',
  },
  {
    label: 'Class 10 certificate / marksheet',
    spec: 'PDF, 50–300 kB, clearly legible.',
  },
  {
    label: 'Disability / UDID certificate',
    spec: 'PDF, 50–300 kB, clearly legible, where applicable.',
  },
  {
    label: 'Physical-limitation certificate',
    spec: 'PDF, 50–300 kB, clearly legible, where applicable.',
  },
  {
    label: 'Non-Indian passport',
    spec: 'PDF, 50–300 kB, for foreign nationals including OCI candidates, where applicable.',
  },
] as const

export type JeeUploadDocumentType =
  | 'PHOTO'
  | 'SIGNATURE'
  | 'CLASS10_MARKSHEET'
  | 'PWD_CERTIFICATE'

interface JeeUploadRule {
  documentType: JeeUploadDocumentType
  label: string
  mimeTypes: readonly string[]
  formatLabel: string
  minBytes: number
  maxBytes: number
  minKb: number
  maxKb: number
}

/**
 * Advisory checks against the documented file format/size limits. This is not
 * an official verification: it only tells the student whether a private file
 * stored in Formly appears to fit the published limits. Dimensions, photo
 * recency, the live photograph and the portal's own validator remain manual.
 */
export const JEE_MAIN_UPLOAD_RULES: readonly JeeUploadRule[] = [
  {
    documentType: 'PHOTO',
    label: 'Photograph',
    mimeTypes: ['image/jpeg'],
    formatLabel: 'JPG/JPEG',
    minBytes: 10_000,
    maxBytes: 200_000,
    minKb: 10,
    maxKb: 200,
  },
  {
    documentType: 'SIGNATURE',
    label: 'Signature',
    mimeTypes: ['image/jpeg'],
    formatLabel: 'JPG/JPEG',
    minBytes: 10_000,
    maxBytes: 100_000,
    minKb: 10,
    maxKb: 100,
  },
  {
    documentType: 'CLASS10_MARKSHEET',
    label: 'Class 10 certificate / marksheet',
    mimeTypes: ['application/pdf'],
    formatLabel: 'PDF',
    minBytes: 50_000,
    maxBytes: 300_000,
    minKb: 50,
    maxKb: 300,
  },
  {
    documentType: 'PWD_CERTIFICATE',
    label: 'Disability / UDID certificate',
    mimeTypes: ['application/pdf'],
    formatLabel: 'PDF',
    minBytes: 50_000,
    maxBytes: 300_000,
    minKb: 50,
    maxKb: 300,
  },
]

export interface JeeUploadDocumentLike {
  documentType: string
  mimeType: string
  sizeBytes: number
}

export interface JeeUploadGuidance {
  status: 'missing' | 'ok' | 'outside-guidance'
  message: string
}

export function jeeUploadGuidance(
  documentType: JeeUploadDocumentType,
  document: JeeUploadDocumentLike | null | undefined
): JeeUploadGuidance {
  const rule = JEE_MAIN_UPLOAD_RULES.find(item => item.documentType === documentType)
  if (!rule) {
    return { status: 'missing', message: 'No documented file rule is available for this document.' }
  }
  if (!document) {
    return {
      status: 'missing',
      message: `No ${rule.label.toLowerCase()} in your private Formly documents. Upload one for your own checklist, then select it manually on the portal.`,
    }
  }
  const formatOk = rule.mimeTypes.includes(document.mimeType as never)
  const sizeKb = document.sizeBytes / 1000
  const sizeOk = document.sizeBytes >= rule.minBytes && document.sizeBytes <= rule.maxBytes
  if (formatOk && sizeOk) {
    return {
      status: 'ok',
      message: `Your stored file appears to fit the documented ${rule.formatLabel}, ${rule.minKb}–${rule.maxKb} kB range (${Math.round(sizeKb)} kB). Dimensions, photo rules and the portal's own validator still apply.`,
    }
  }
  const reasons: string[] = []
  if (!formatOk) reasons.push(`format is ${document.mimeType || 'unknown'}, not ${rule.formatLabel}`)
  if (!sizeOk) reasons.push(`size is ${Math.round(sizeKb)} kB, outside ${rule.minKb}–${rule.maxKb} kB`)
  return {
    status: 'outside-guidance',
    message: `Does not appear to fit the documented limits: ${reasons.join('; ')}. This is advisory only; re-check with the portal before uploading.`,
  }
}

export const JEE_MAIN_FILLS = [
  "Candidate's Name → your saved full name",
  'Candidate Date of Birth → day, month and year from your saved date of birth',
  'Gender → your saved gender, only when the portal option matches exactly',
  'Category → your saved category; the separate Confirm Category control stays manual',
  'Email Address and Mobile Number → your saved contact details',
  'Class 10 / Class 12 School Board → your saved board',
  'Year of Passing / Appearing → your saved passing year',
  'Registration No. / Enrollment No. / Roll No. → your saved roll number, only after you approve it',
] as const

export const JEE_MAIN_MANUAL = [
  'Father/guardian and mother/guardian names',
  'Nationality',
  'State/UT from where Class 12 was passed/appeared (State of Eligibility) — never treated as your home state',
  'Confirm Category, Confirm Email Address, Confirm Mobile Number and alternate contact details',
  'Present/permanent address components',
  'Health, income, residence and preparation questions',
  'Papers, session, question-paper medium and examination-city choices',
  'PwD/PwBD status, certificate details and disability documents',
  'Identity numbers, live photo, photograph/signature/certificate uploads',
  'Declaration, consent, payment and final submission',
] as const

/* ---------------------------------------------------------------------------
 * Origin policy
 * ------------------------------------------------------------------------- */

export function sanitizePageUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin + url.pathname
  } catch {
    return null
  }
}

/** The extension must send origin + pathname only. Query strings can contain
 * one-time portal tokens and must never enter a stored plan or log. */
export function isSanitizedPageUrl(rawUrl: string): boolean {
  if (rawUrl.includes('?') || rawUrl.includes('#')) return false
  return sanitizePageUrl(rawUrl) === rawUrl
}

function normalizedLocalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : '/'
}

export function classifyAgentPage(rawUrl: string): AgentPageClassification {
  const sanitizedUrl = sanitizePageUrl(rawUrl)
  if (!sanitizedUrl) {
    return { adapter: 'none', sanitizedUrl: null, official: false, fixture: false, reason: 'INVALID_URL' }
  }

  let url: URL
  try {
    url = new URL(sanitizedUrl)
  } catch {
    return { adapter: 'none', sanitizedUrl: null, official: false, fixture: false, reason: 'INVALID_URL' }
  }

  if (
    url.protocol === 'https:' &&
    url.hostname === 'examinationservices.nic.in' &&
    url.port === '' &&
    url.pathname.startsWith(JEE_MAIN_PORTAL_PATH_PREFIX)
  ) {
    return {
      adapter: JEE_MAIN_ADAPTER,
      sanitizedUrl,
      official: true,
      fixture: false,
      reason: 'OFFICIAL_JEE_MAIN_2027',
    }
  }

  if (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port === '3000'
  ) {
    const localPath = normalizedLocalPath(url.pathname)
    if (localPath === JEE_MAIN_FIXTURE_PATH || localPath.startsWith(JEE_MAIN_FIXTURE_PATH + '/')) {
      return {
        adapter: JEE_MAIN_ADAPTER,
        sanitizedUrl,
        official: false,
        fixture: true,
        reason: 'SYNTHETIC_JEE_MAIN_FIXTURE',
      }
    }
    if (localPath === GENERIC_DEMO_PATH) {
      return {
        adapter: 'generic',
        sanitizedUrl,
        official: false,
        fixture: true,
        reason: 'SYNTHETIC_GENERIC_DEMO',
      }
    }
  }

  return { adapter: 'none', sanitizedUrl, official: false, fixture: false, reason: 'UNSUPPORTED_ORIGIN' }
}

export function isSupportedJeePageKind(kind: AgentPageKind): kind is FillableJeePageKind {
  return kind === 'personal' || kind === 'qualification'
}

export function jeePageNotice(kind: AgentPageKind): string {
  switch (kind) {
    case 'login':
      return 'This is the JEE Main login/registration gate. Log in yourself first; the agent starts only on the Personal Details or Qualification Details pages.'
    case 'exam':
      return 'JEE Main paper, session, question-paper medium and examination-city choices are not autofilled. Choose them yourself on the official portal.'
    case 'documents':
      return 'Document uploads are never automated. Choose and upload your own photograph, signature and certificates. Official specifications: photograph JPG/JPEG 10–200 kB; signature JPG/JPEG 10–100 kB; Class 10 certificate PDF 50–300 kB.'
    case 'declaration':
      return 'The declaration, consent, payment and final submission are yours. The agent never ticks declarations or submits an application.'
    case 'unknown':
      return 'This JEE Main page is not one of the documented autofill sections. Nothing will be filled; open the Personal Details or Qualification Details page.'
    case 'personal':
    case 'qualification':
      return 'This JEE Main page is supported by the documentation-backed adapter.'
    case 'generic':
      return 'This is not a JEE Main page.'
  }
}

/* ---------------------------------------------------------------------------
 * Deterministic JEE Main field mapping
 * ------------------------------------------------------------------------- */

export interface JeeFieldDescriptorLike {
  kind: string
  label: string
  group?: string
  inputName?: string
  inputId?: string
  options?: { text: string; value: string }[]
}

export interface JeeMappingDecision {
  status: 'mapped' | 'ambiguous' | 'manual' | 'unsafe' | 'unmapped'
  canonical: JeeMainFillableField | null
  ambiguous: string[]
  needsReview: boolean
  reason: string
}

function mapped(canonical: JeeMainFillableField, reason: string, needsReview = false): JeeMappingDecision {
  return { status: 'mapped', canonical, ambiguous: [], needsReview, reason }
}

function manual(reason: string): JeeMappingDecision {
  return { status: 'manual', canonical: null, ambiguous: [], needsReview: false, reason }
}

function ambiguous(candidates: JeeMainFillableField[], reason: string): JeeMappingDecision {
  return { status: 'ambiguous', canonical: null, ambiguous: candidates, needsReview: false, reason }
}

function normalize(raw: string): string {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function squash(raw: string): string {
  return normalize(raw).replace(/ /g, '')
}

const UNSAFE_PATTERNS: RegExp[] = [
  /password/i,
  /\bpasswd\b/i,
  /\botp\b/i,
  /one[\s-]?time/i,
  /\bcaptcha\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /card[\s-]?(no|number|num|holder)/i,
  /\bdebit\b/i,
  /credit[\s-]?card/i,
  /\bpayment\b/i,
  /security[\s-]?(code|pin)/i,
  /bank[\s-]?(account|ifsc|branch)/i,
  /\baadhaar\b/i,
  /\baadhar\b/i,
  /\bpassport\b/i,
  /\bupload\b/i,
  /\battach(ment)?\b/i,
  /\bapplication\s*(no|number)\b/i,
  /\bdeclaration\b/i,
  /\bundertaking\b/i,
  /\bi\s+agree\b/i,
  /\bconsent\b/i,
]

function unsafeReason(descriptor: JeeFieldDescriptorLike): string | null {
  if (descriptor.kind === 'file') {
    return 'File uploads are never automated — choose and upload your own document on the official portal.'
  }
  const haystack = [
    descriptor.label,
    descriptor.group ?? '',
    descriptor.inputName ?? '',
    descriptor.inputId ?? '',
  ].join(' | ')
  return UNSAFE_PATTERNS.some(pattern => pattern.test(haystack))
    ? 'Skipped for safety (password, OTP, CAPTCHA, identity number, payment, declaration or document upload).'
    : null
}

function isIntegerInRange(raw: string, min: number, max: number): boolean {
  const value = parseInt(raw, 10)
  return String(value) === raw && value >= min && value <= max
}

function optionsLookLikeDay(options: { text: string; value: string }[]): boolean {
  const values = options.map(option => option.value || option.text)
  return values.length >= 15 && values.every(value => isIntegerInRange(value, 1, 31))
}

function optionsLookLikeMonth(options: { text: string; value: string }[]): boolean {
  const months = new Set([
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  ])
  const values = options.map(option => normalize(option.text))
  return values.length >= 12 && values.every(value => months.has(value) || isIntegerInRange(value, 1, 12))
}

function optionsLookLikeYear(options: { text: string; value: string }[]): boolean {
  const values = options.map(option => option.value || option.text)
  return values.length >= 8 && values.every(value => isIntegerInRange(value, 1950, 2035))
}

const DOB_CONTEXT = /(dateofbirth|\bdob\b|birthdate|dateofbrith)/
const DOB_LABEL = /(dateofbirth|\bdob\b|birthdate|dateofbrith)/

function dobPartFromLabel(key: string): 'dateOfBirthDay' | 'dateOfBirthMonth' | 'dateOfBirthYear' | null {
  if (['day', 'dobday', 'birthday', 'dayofbirth', 'dateofbirthday'].includes(key)) return 'dateOfBirthDay'
  if (['month', 'dobmonth', 'birthmonth', 'monthofbirth', 'dateofbirthmonth'].includes(key)) return 'dateOfBirthMonth'
  if (['year', 'dobyear', 'birthyear', 'yearofbirth', 'dateofbirthyear'].includes(key)) return 'dateOfBirthYear'
  return null
}

function dobPartFromOptions(
  options: { text: string; value: string }[]
): 'dateOfBirthDay' | 'dateOfBirthMonth' | 'dateOfBirthYear' | null {
  if (optionsLookLikeDay(options)) return 'dateOfBirthDay'
  if (optionsLookLikeMonth(options)) return 'dateOfBirthMonth'
  if (optionsLookLikeYear(options)) return 'dateOfBirthYear'
  return null
}

function compatible(kind: string, allowed: readonly string[]): boolean {
  return allowed.includes(kind)
}

const PERSONAL_MANUAL_REASONS: Record<string, string> = {
  confirmcategory:
    'Confirm Category is a confirmation control. Compare it with your saved category and select it yourself.',
  confirmemailaddress:
    'Confirmation fields are left for you — type or compare the saved email yourself.',
  confirmmobilenumber:
    'Confirmation fields are left for you — type or compare the saved mobile number yourself.',
  alternatecontactnooptional:
    'Alternate contact details are not stored in your Formly profile; fill this yourself.',
  alternatecontactno:
    'Alternate contact details are not stored in your Formly profile; fill this yourself.',
  alternatecontactnumber:
    'Alternate contact details are not stored in your Formly profile; fill this yourself.',
  nationality: 'Nationality is not stored in your Formly profile; fill this yourself.',
  fatherguardianname:
    'Parent/guardian details are not stored in Formly; fill this yourself.',
  motherguardianname:
    'Parent/guardian details are not stored in Formly; fill this yourself.',
  stateutfromwhere12thequivalentpassedappearing:
    'This is the State of Eligibility (where Class 12 was passed/appeared), not your home state. Fill it yourself.',
  stateofeligibility:
    'This is the State of Eligibility (where Class 12 was passed/appeared), not your home state. Fill it yourself.',
  areyoudiabetic:
    'Health information is never autofilled; answer this yourself.',
  placeofresidence:
    'Place-of-residence choices are not stored in your profile; select it yourself.',
  annualfamilyincome:
    'Income information is never autofilled; select it yourself.',
  modeofpreparation:
    'Preparation-mode choices are not stored in your profile; select it yourself.',
  mediumofschoolinginqualifyingexamination:
    'Schooling-medium choices are not stored in your profile; select it yourself.',
  premisesnoname:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  sublocality:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  locality:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  country:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  state:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  district:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  pincode:
    'Address components are not autofilled; enter the present/permanent address yourself.',
  presentaddress:
    'Present address is entered as separate components on the official form; fill them yourself.',
  permanentaddress:
    'Permanent address is entered as separate components on the official form; fill it yourself.',
  sameaspresentaddress:
    'The same-as-present-address action is yours; confirm it yourself.',
}

function mapPersonal(descriptor: JeeFieldDescriptorLike): JeeMappingDecision {
  const key = squash(descriptor.label)
  const groupKey = squash(descriptor.group ?? '')
  const context = groupKey + ' ' + key

  if (
    ['candidatesname', 'candidatename', 'nameofthecandidate', 'applicantname', 'nameofapplicant'].includes(key)
  ) {
    return compatible(descriptor.kind, ['text'])
      ? mapped('fullName', 'Documented personal-details label matched your saved full name.')
      : manual('The portal uses a non-text control for the candidate name; fill it yourself.')
  }

  if (['emailaddress', 'emailid', 'email'].includes(key)) {
    return compatible(descriptor.kind, ['text', 'email'])
      ? mapped('email', 'Documented contact label matched your saved email address.')
      : manual('The portal uses a non-text control for email; fill it yourself.')
  }

  if (['mobilenumber', 'mobileno', 'mobile'].includes(key)) {
    return compatible(descriptor.kind, ['text', 'tel'])
      ? mapped('mobileNumber', 'Documented contact label matched your saved mobile number.')
      : manual('The portal uses a non-text control for the mobile number; fill it yourself.')
  }

  if (key === 'gender' || key === 'sex') {
    return compatible(descriptor.kind, ['select', 'radio'])
      ? mapped('gender', 'Documented gender label; the saved option must match the portal exactly.')
      : manual('The portal uses a non-choice control for gender; fill it yourself.')
  }

  if (key === 'category') {
    return compatible(descriptor.kind, ['select', 'radio'])
      ? mapped('category', 'Documented category label; Confirm Category remains a separate manual confirmation.')
      : manual('The portal uses a non-choice control for category; fill it yourself.')
  }

  const dobInGroup = DOB_CONTEXT.test(groupKey)
  const dobInLabel = DOB_LABEL.test(key)
  if (dobInGroup || dobInLabel) {
    if (descriptor.kind === 'date' && dobInLabel) {
      return mapped('dateOfBirth', 'Documented date-of-birth label on a native date input.')
    }
    if (descriptor.kind === 'select' || descriptor.kind === 'radio') {
      const part = dobPartFromLabel(key) ?? dobPartFromOptions(descriptor.options ?? [])
      if (part) {
        return mapped(part, 'Documented date-of-birth control; the value is derived from your saved date of birth.')
      }
    }
    return manual(
      'The official JEE Main date of birth is entered through day/month/year selections. This control could not be identified safely, so it is left for you.'
    )
  }

  const reason = PERSONAL_MANUAL_REASONS[key]
  if (reason) return manual(reason)

  return manual('Not part of the documented JEE Main autofill set — fill this yourself.')
}

function classFromText(raw: string): 10 | 12 | 'both' | null {
  const text = normalize(raw)
  const ten = /\bclass\s*(?:10(?:th)?|x|ten)\b|\b10th\b|\bsslc\b|\bmatric(?:ulation)?\b/.test(text)
  const twelve = /\bclass\s*(?:12(?:th)?|xii|twelve)\b|\b12th\b|\bintermediate\b|\bsenior\s+secondary\b|\bhsc\b/.test(text)
  if (ten && twelve) return 'both'
  if (ten) return 10
  if (twelve) return 12
  return null
}

const QUALIFICATION_MANUAL_REASONS: Record<string, string> = {
  passstatus:
    'Pass status is not stored in your Formly profile; select it yourself.',
  qualifyingexam:
    'The qualifying-examination name is not stored in your Formly profile; select it yourself.',
  qualifyingexamination:
    'The qualifying-examination name is not stored in your Formly profile; select it yourself.',
  nameofqualifyingexam:
    'The qualifying-examination name is not stored in your Formly profile; select it yourself.',
  placeofschool:
    'Place of school is not stored in your Formly profile; select it yourself.',
  typeofschoolcollege:
    'School/college type is not stored in your Formly profile; select it yourself.',
  qualifyingexaminationstate:
    'Qualifying-examination state is not stored in your Formly profile; select it yourself.',
  qualifyingexaminationdistrict:
    'Qualifying-examination district is not stored in your Formly profile; select it yourself.',
  resultmode:
    'Result mode (percentage, grade or result awaited) is not the same as the marks format in your profile; select it yourself.',
  schoolcollegenameaddress:
    'School/college name and address are not stored in your Formly profile; fill them yourself.',
  schoolcollegeaddress:
    'School/college address is not stored in your Formly profile; fill it yourself.',
  schoolcollegeaddresspincode:
    'School/college address PIN code is not stored in your Formly profile; fill it yourself.',
}

function mapQualification(descriptor: JeeFieldDescriptorLike): JeeMappingDecision {
  const key = squash(descriptor.label)
  const reason = QUALIFICATION_MANUAL_REASONS[key]
  if (reason) return manual(reason)

  const classRef = classFromText(descriptor.group ?? '') ?? classFromText(descriptor.label)

  if (['schoolboard', 'board', 'boardname', 'nameofboard'].includes(key)) {
    if (classRef === 'both') {
      return ambiguous(
        ['class10Board', 'class12Board'],
        'The group mentions both Class 10 and Class 12 — choose the class yourself.'
      )
    }
    if (classRef === null) {
      return ambiguous(
        ['class10Board', 'class12Board'],
        'This board field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.'
      )
    }
    if (!compatible(descriptor.kind, ['text', 'select'])) {
      return manual('The portal uses an unsupported control for the school board; fill it yourself.')
    }
    return mapped(
      classRef === 10 ? 'class10Board' : 'class12Board',
      `Documented Class ${classRef} School Board label matched your saved board.`
    )
  }

  if (
    ['yearofpassingappearing', 'yearofpassing', 'passingyear', 'yearofappearing', 'yearofpassingorappearing'].includes(
      key
    )
  ) {
    if (classRef === 'both') {
      return ambiguous(
        ['class10PassingYear', 'class12PassingYear'],
        'The group mentions both Class 10 and Class 12 — choose the class yourself.'
      )
    }
    if (classRef === null) {
      return ambiguous(
        ['class10PassingYear', 'class12PassingYear'],
        'This passing-year field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.'
      )
    }
    if (!compatible(descriptor.kind, ['select', 'number', 'text'])) {
      return manual('The portal uses an unsupported control for the passing year; fill it yourself.')
    }
    return mapped(
      classRef === 10 ? 'class10PassingYear' : 'class12PassingYear',
      `Documented Class ${classRef} passing-year label matched your saved passing year.`
    )
  }

  if (
    [
      'registrationnoenrollmentnorollno',
      'registrationno',
      'registrationnumber',
      'enrollmentno',
      'enrollmentnumber',
      'rollno',
      'rollnumber',
    ].includes(key)
  ) {
    if (classRef === 'both') {
      return ambiguous(
        ['class10RollNumber', 'class12RollNumber'],
        'The group mentions both Class 10 and Class 12 — choose the class yourself.'
      )
    }
    if (classRef === null) {
      return ambiguous(
        ['class10RollNumber', 'class12RollNumber'],
        'This registration/roll field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.'
      )
    }
    if (!compatible(descriptor.kind, ['text'])) {
      return manual('The portal uses an unsupported control for the registration/roll number; fill it yourself.')
    }
    return mapped(
      classRef === 10 ? 'class10RollNumber' : 'class12RollNumber',
      `Documented Class ${classRef} registration/enrollment/roll label matched your saved roll number — review it before approving.`,
      true
    )
  }

  return manual('Not part of the documented JEE Main qualification autofill set — fill this yourself.')
}

/**
 * Strict JEE Main mapping. Only the verified Personal Details and Qualification
 * Details fields can become `mapped`; everything else is manual, ambiguous or
 * unsafe. The local model is never consulted for a JEE Main page.
 */
export function mapJeeMainField(
  descriptor: JeeFieldDescriptorLike,
  section: AgentPageKind
): JeeMappingDecision {
  const unsafe = unsafeReason(descriptor)
  if (unsafe) {
    return { status: 'unsafe', canonical: null, ambiguous: [], needsReview: false, reason: unsafe }
  }

  if (section === 'personal') return mapPersonal(descriptor)
  if (section === 'qualification') return mapQualification(descriptor)

  return manual(
    'This JEE Main page is not one of the documented autofill sections. Nothing will be filled here; open Personal Details or Qualification Details.'
  )
}

/* ---------------------------------------------------------------------------
 * Adapter object for the central registry
 * ------------------------------------------------------------------------- */

function classifyUrlForRegistry(rawUrl: string): AgentPageClassification | null {
  const result = classifyAgentPage(rawUrl)
  if (result.adapter === 'none') return null
  return result as AgentPageClassification
}

export const jeeMainAdapter: AgentAdapter = {
  id: JEE_MAIN_ADAPTER as AgentAdapterId,
  examId: 'JEE_MAIN',
  name: 'JEE Main 2027 (Session 1)',
  version: JEE_MAIN_ADAPTER_VERSION,
  status: 'DOCUMENTATION_BACKED',
  statusLabel: JEE_MAIN_STATUS_LABEL,
  verifiedOn: JEE_MAIN_VERIFIED_ON,
  officialDomains: [JEE_MAIN_PORTAL_ORIGIN],
  supportedPaths: [JEE_MAIN_PORTAL_PATH_PREFIX],
  fillablePageKinds: ['personal', 'qualification'],
  fillableCanonicals: JEE_MAIN_FILLABLE_CANONICALS,
  sources: JEE_MAIN_SOURCES as unknown as AgentAdapterSource[],
  documentSpecs: JEE_MAIN_DOCUMENT_SPECS as unknown as AgentAdapterDocumentSpec[],
  classifyUrl: classifyUrlForRegistry,
  isSupportedPageKind: isSupportedJeePageKind,
  pageNotice: jeePageNotice,
  mapField: (descriptor, pageKind) => mapJeeMainField(descriptor, pageKind as AgentPageKind),
}
