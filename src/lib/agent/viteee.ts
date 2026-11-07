/**
 * VITEEE 2027 portal adapter.
 *
 * Status: DOCUMENTATION_BACKED / DEMONSTRATION ONLY.
 *
 * This adapter is based on the publicly listed VITEEE 2027 application process
 * (https://viteee.vit.ac.in/) and the Formly Application Hub requirement list.
 * The actual VITEEE application portal is login-gated and was not inspected
 * live, so this adapter does NOT claim live-portal compatibility. It runs only
 * on the synthetic local demo fixture by default; official-domain matching is
 * deliberately conservative.
 *
 * Sources (verified 31 October 2026):
 *  - https://viteee.vit.ac.in/ (official website and Important Dates)
 *  - VITEEE 2027 Information Brochure (public PDF)
 *
 * Mapped fields are limited to labels that appear consistently across VIT's
 * public application guidance and the Formly Student Information Vault.
 */

import type {
  AgentAdapter,
  AgentAdapterDocumentSpec,
  AgentAdapterId,
  AgentAdapterSource,
  AgentFieldDescriptorLike,
  AgentMappingDecision,
  AgentPageClassification,
  AgentPageKind,
} from './adapter-types'

export const VITEEE_ADAPTER = 'viteee-2027' as const
export const VITEEE_ADAPTER_VERSION = '2027.1'
export const VITEEE_STATUS_LABEL = 'Documentation-backed / demo only — live VITEEE portal not verified'
export const VITEEE_VERIFIED_ON = '31 October 2026'

/** Public information website (not the application portal). */
export const VITEEE_OFFICIAL_ORIGIN = 'https://viteee.vit.ac.in'
/** Synthetic local fixture for safe demonstration. */
export const VITEEE_FIXTURE_PATH = '/apply/agent/viteee-2027-demo'

export type ViteeeFillableField = (typeof VITEEE_FILLABLE_CANONICALS)[number]

export const VITEEE_FILLABLE_CANONICALS = [
  'fullName',
  'gender',
  'dateOfBirth',
  'dateOfBirthDay',
  'dateOfBirthMonth',
  'dateOfBirthYear',
  'email',
  'mobileNumber',
  'nationality',
  'category',
  'class10Board',
  'class12Board',
  'class10PassingYear',
  'class12PassingYear',
  'class10RollNumber',
  'class12RollNumber',
] as const

export const VITEEE_SOURCES = [
  {
    label: 'VITEEE 2027 official website — Important Dates and Application Process',
    url: 'https://viteee.vit.ac.in/',
  },
  {
    label: 'VITEEE 2027 Information Brochure (public PDF)',
    url: 'https://viteee.vit.ac.in/pdf/VITEEE-2027-Brochure.pdf',
  },
] as const

export const VITEEE_DOCUMENT_SPECS = [
  {
    label: 'Photograph',
    spec: 'Recent colour photograph; exact format and dimensions are set by the VITEEE portal and must be checked there.',
  },
  {
    label: 'Signature',
    spec: 'Candidate signature in black or blue ink on white paper; exact format must be checked on the portal.',
  },
  {
    label: 'Class 10 marksheet',
    spec: 'PDF or image of Class 10 marksheet, clearly legible.',
  },
  {
    label: 'Class 12 marksheet / admit card',
    spec: 'For appearing students, Class 12 admit card or school ID; for passed students, Class 12 marksheet.',
  },
] as const

export type ViteeePageAdapter = typeof VITEEE_ADAPTER | 'generic' | 'none'
export type ViteeePageKind = AgentPageKind
export type FillableViteeePageKind = 'personal' | 'qualification'

export interface ViteeePageClassification extends AgentPageClassification {
  adapter: ViteeePageAdapter
}

export interface ViteeeFieldDescriptorLike extends AgentFieldDescriptorLike {}

export interface ViteeeMappingDecision extends AgentMappingDecision {
  canonical: ViteeeFillableField | null
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

function sanitizePageUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin + url.pathname
  } catch {
    return null
  }
}

export function isSanitizedViteeePageUrl(rawUrl: string): boolean {
  if (rawUrl.includes('?') || rawUrl.includes('#')) return false
  return sanitizePageUrl(rawUrl) === rawUrl
}

function normalizedLocalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : '/'
}

export function classifyViteeePage(rawUrl: string): ViteeePageClassification {
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

  // The live application portal URL was not verified, so the adapter does not
  // claim to recognise official pages. This avoids broad or incorrect matching.
  if (
    url.protocol === 'https:' &&
    url.hostname === 'viteee.vit.ac.in' &&
    url.port === ''
  ) {
    return {
      adapter: VITEEE_ADAPTER,
      sanitizedUrl,
      official: true,
      fixture: false,
      reason: 'DOCUMENTATION_BACKED_VITEEE_2027',
    }
  }

  if (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port === '3000'
  ) {
    const localPath = normalizedLocalPath(url.pathname)
    if (localPath === VITEEE_FIXTURE_PATH || localPath.startsWith(VITEEE_FIXTURE_PATH + '/')) {
      return {
        adapter: VITEEE_ADAPTER,
        sanitizedUrl,
        official: false,
        fixture: true,
        reason: 'SYNTHETIC_VITEEE_FIXTURE',
      }
    }
  }

  return { adapter: 'none', sanitizedUrl, official: false, fixture: false, reason: 'UNSUPPORTED_ORIGIN' }
}

export function isSupportedViteeePageKind(kind: AgentPageKind): kind is FillableViteeePageKind {
  return kind === 'personal' || kind === 'qualification'
}

export function viteeePageNotice(kind: AgentPageKind): string {
  switch (kind) {
    case 'login':
      return 'Log in to the VITEEE portal yourself first; the adapter starts only on the Personal Details or Qualification Details sections.'
    case 'exam':
      return 'Exam preferences, slot booking and city choices are not autofilled; select them yourself on the official portal.'
    case 'documents':
      return 'Photograph, signature and certificate uploads are never automated. Upload them yourself after checking the official VITEEE specifications.'
    case 'declaration':
      return 'The declaration, payment and final submission are yours. The agent never ticks declarations or submits an application.'
    case 'unknown':
      return 'This page is not one of the documented VITEEE autofill sections. Nothing will be filled.'
    case 'personal':
    case 'qualification':
      return 'This VITEEE page is supported by the documentation-backed adapter; live portal structure has not been verified.'
    case 'generic':
      return 'This is not a VITEEE page.'
  }
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

function unsafeReason(descriptor: ViteeeFieldDescriptorLike): string | null {
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

function mapped(canonical: ViteeeFillableField, reason: string, needsReview = false): ViteeeMappingDecision {
  return { status: 'mapped', canonical, ambiguous: [], needsReview, reason }
}

function manual(reason: string): ViteeeMappingDecision {
  return { status: 'manual', canonical: null, ambiguous: [], needsReview: false, reason }
}

function compatible(kind: string, allowed: readonly string[]): boolean {
  return allowed.includes(kind)
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

const DOB_CONTEXT = /(dateofbirth|\bdob\b|birthdate|dateofbrith)/
const DOB_LABEL = /(dateofbirth|\bdob\b|birthdate|dateofbrith)/

function classFromText(raw: string): 10 | 12 | 'both' | null {
  const text = normalize(raw)
  const ten = /\bclass\s*(?:10(?:th)?|x|ten)\b|\b10th\b|\bsslc\b|\bmatric(?:ulation)?\b/.test(text)
  const twelve = /\bclass\s*(?:12(?:th)?|xii|twelve)\b|\b12th\b|\bintermediate\b|\bsenior\s+secondary\b|\bhsc\b/.test(text)
  if (ten && twelve) return 'both'
  if (ten) return 10
  if (twelve) return 12
  return null
}

const PERSONAL_MANUAL_REASONS: Record<string, string> = {
  fathername: 'Parent/guardian details are stored in your Formly profile but are left for you to confirm on the portal.',
  fatherguardianname: 'Parent/guardian details are stored in your Formly profile but are left for you to confirm on the portal.',
  mothername: 'Parent/guardian details are stored in your Formly profile but are left for you to confirm on the portal.',
  motherguardianname: 'Parent/guardian details are stored in your Formly profile but are left for you to confirm on the portal.',
  guardianname: 'Guardian details are left for you to confirm on the portal.',
  addressline1: 'Address components are not autofilled; enter them yourself on the portal.',
  addressline2: 'Address components are not autofilled; enter them yourself on the portal.',
  city: 'Address components are not autofilled; enter them yourself on the portal.',
  state: 'Address components are not autofilled; enter them yourself on the portal.',
  district: 'Address components are not autofilled; enter them yourself on the portal.',
  pincode: 'Address components are not autofilled; enter them yourself on the portal.',
  country: 'Address components are not autofilled; enter them yourself on the portal.',
  alternatenumber: 'Alternate contact details are not stored in your Formly profile; fill them yourself.',
  alternateemail: 'Alternate contact details are not stored in your Formly profile; fill them yourself.',
}

function mapPersonal(descriptor: ViteeeFieldDescriptorLike): ViteeeMappingDecision {
  const key = squash(descriptor.label)
  const groupKey = squash(descriptor.group ?? '')

  if (
    ['candidatesname', 'candidatename', 'nameofthecandidate', 'applicantname', 'nameofapplicant', 'studentname'].includes(key)
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

  if (['mobilenumber', 'mobileno', 'mobile', 'phonenumber', 'phone'].includes(key)) {
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
      ? mapped('category', 'Documented category label; confirm it yourself if the portal asks.')
      : manual('The portal uses a non-choice control for category; fill it yourself.')
  }

  if (['nationality', 'countryofnationality'].includes(key)) {
    return compatible(descriptor.kind, ['select', 'radio', 'text'])
      ? mapped('nationality', 'Documented nationality label; the saved option must match the portal exactly.')
      : manual('The portal uses an unsupported control for nationality; fill it yourself.')
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
    return manual('This date-of-birth control could not be identified safely; fill it yourself.')
  }

  const reason = PERSONAL_MANUAL_REASONS[key]
  if (reason) return manual(reason)

  return manual('Not part of the documented VITEEE autofill set — fill this yourself.')
}

function mapQualification(descriptor: ViteeeFieldDescriptorLike): ViteeeMappingDecision {
  const key = squash(descriptor.label)

  if (['schoolboard', 'board', 'boardname', 'nameofboard'].includes(key)) {
    const classRef = classFromText(descriptor.group ?? '') ?? classFromText(descriptor.label)
    if (classRef === 'both') {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10Board', 'class12Board'], needsReview: false, reason: 'The group mentions both Class 10 and Class 12 — choose the class yourself.' }
    }
    if (classRef === null) {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10Board', 'class12Board'], needsReview: false, reason: 'This board field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.' }
    }
    if (!compatible(descriptor.kind, ['text', 'select'])) {
      return manual('The portal uses an unsupported control for the school board; fill it yourself.')
    }
    return mapped(classRef === 10 ? 'class10Board' : 'class12Board', `Documented Class ${classRef} school board label.`)
  }

  if (
    ['yearofpassingappearing', 'yearofpassing', 'passingyear', 'yearofappearing', 'yearofpassingorappearing'].includes(key)
  ) {
    const classRef = classFromText(descriptor.group ?? '') ?? classFromText(descriptor.label)
    if (classRef === 'both') {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10PassingYear', 'class12PassingYear'], needsReview: false, reason: 'The group mentions both Class 10 and Class 12 — choose the class yourself.' }
    }
    if (classRef === null) {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10PassingYear', 'class12PassingYear'], needsReview: false, reason: 'This passing-year field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.' }
    }
    if (!compatible(descriptor.kind, ['select', 'number', 'text'])) {
      return manual('The portal uses an unsupported control for the passing year; fill it yourself.')
    }
    return mapped(classRef === 10 ? 'class10PassingYear' : 'class12PassingYear', `Documented Class ${classRef} passing-year label.`)
  }

  if (
    ['registrationno', 'registrationnumber', 'enrollmentno', 'enrollmentnumber', 'rollno', 'rollnumber'].includes(key)
  ) {
    const classRef = classFromText(descriptor.group ?? '') ?? classFromText(descriptor.label)
    if (classRef === 'both') {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10RollNumber', 'class12RollNumber'], needsReview: false, reason: 'The group mentions both Class 10 and Class 12 — choose the class yourself.' }
    }
    if (classRef === null) {
      return { status: 'ambiguous', canonical: null, ambiguous: ['class10RollNumber', 'class12RollNumber'], needsReview: false, reason: 'This registration/roll field does not say whether it belongs to Class 10 or Class 12 — choose the class yourself.' }
    }
    if (!compatible(descriptor.kind, ['text'])) {
      return manual('The portal uses an unsupported control for the registration/roll number; fill it yourself.')
    }
    return mapped(classRef === 10 ? 'class10RollNumber' : 'class12RollNumber', `Documented Class ${classRef} registration/roll label — review it before approving.`, true)
  }

  return manual('Not part of the documented VITEEE qualification autofill set — fill this yourself.')
}

export function mapViteeeField(descriptor: ViteeeFieldDescriptorLike, section: AgentPageKind): ViteeeMappingDecision {
  const unsafe = unsafeReason(descriptor)
  if (unsafe) {
    return { status: 'unsafe', canonical: null, ambiguous: [], needsReview: false, reason: unsafe }
  }

  if (section === 'personal') return mapPersonal(descriptor)
  if (section === 'qualification') return mapQualification(descriptor)

  return manual('This VITEEE page is not one of the documented autofill sections. Nothing will be filled here.')
}

function classifyUrlForRegistry(rawUrl: string): AgentPageClassification | null {
  const result = classifyViteeePage(rawUrl)
  if (result.adapter === 'none') return null
  return result as AgentPageClassification
}

export const viteeeAdapter: AgentAdapter = {
  id: VITEEE_ADAPTER as AgentAdapterId,
  examId: 'VITEEE',
  name: 'VITEEE 2027',
  version: VITEEE_ADAPTER_VERSION,
  status: 'DOCUMENTATION_BACKED',
  statusLabel: VITEEE_STATUS_LABEL,
  verifiedOn: VITEEE_VERIFIED_ON,
  officialDomains: [VITEEE_OFFICIAL_ORIGIN],
  supportedPaths: ['/'],
  fillablePageKinds: ['personal', 'qualification'],
  fillableCanonicals: VITEEE_FILLABLE_CANONICALS,
  sources: VITEEE_SOURCES as unknown as AgentAdapterSource[],
  documentSpecs: VITEEE_DOCUMENT_SPECS as unknown as AgentAdapterDocumentSpec[],
  classifyUrl: classifyUrlForRegistry,
  isSupportedPageKind: isSupportedViteeePageKind,
  pageNotice: viteeePageNotice,
  mapField: (descriptor, pageKind) => mapViteeeField(descriptor, pageKind as AgentPageKind),
}
