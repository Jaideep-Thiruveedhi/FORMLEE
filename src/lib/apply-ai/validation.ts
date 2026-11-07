import { z } from 'zod'
import { STATE_OPTIONS } from './profile'
import type { MarksKind, SubjectEntry } from './types'

/**
 * Validation schemas shared by the client (inline feedback) and the API routes
 * (authoritative per-field draft parsing). Validation here enforces data FORMATS
 * only — it never encodes examination eligibility rules, dates or fees.
 */

const PERCENTAGE_REGEX = /^(?:[0-9]{1,2}(?:\.[0-9]{1,2})?|100(?:\.0{1,2})?)$/
const CGPA_REGEX = /^(?:[0-9](?:\.[0-9]{1,2})?|10(?:\.0{1,2})?)$/
const GRADE_REGEX = /^[A-Za-z0-9+./-]{1,8}$/
const YEAR_REGEX = /^[0-9]{4}$/
const MOBILE_REGEX = /^\+?[0-9]{10,13}$/
const PIN_REGEX = /^[0-9]{6}$/
const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

const MAX_YEAR = new Date().getFullYear() + 6

export type InvalidField = { field: string; message: string }

export interface ProfileDraftResult {
  accepted: Record<string, unknown>
  invalidFields: InvalidField[]
}

/* ---------- scalar field schemas (input expected pre-trimmed) ---------- */

const nonEmptyString = (max: number, min = 1) => z.string().min(min).max(max)

const optionalEmpty = <T extends z.ZodType>(schema: T, emptyLiteral = '') =>
  z.union([z.literal(emptyLiteral), schema])

const GENDER_VALUES = ['MALE', 'FEMALE', 'TRANSGENDER'] as const
const CATEGORY_VALUES = ['GENERAL', 'EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] as const
const MARKS_KIND_VALUES = ['PERCENTAGE', 'GRADE', 'CGPA'] as const
const CLASS12_STATUS_VALUES = ['APPEARING', 'RESULT_AWAITED', 'PASSED'] as const
const VERIFICATION_VALUES = ['SELF_REPORTED', 'STUDENT_CONFIRMED'] as const
const NATIONALITY_VALUES = ['India', 'Other'] as const

const stateValues = STATE_OPTIONS.map(o => o.value)

const dobSchema = z
  .string()
  .regex(DATE_REGEX)
  .refine(value => {
    const date = new Date(value + 'T00:00:00Z')
    if (Number.isNaN(date.getTime())) return false
    return date.getTime() <= Date.now()
  }, { error: 'Enter a real date of birth, not in the future' })

const plainDateSchema = z.string().regex(DATE_REGEX, { error: 'Enter a real date (YYYY-MM-DD)' })

const yearSchema = z
  .string()
  .regex(YEAR_REGEX)
  .refine(value => {
    const year = parseInt(value, 10)
    return year >= 1990 && year <= MAX_YEAR
  }, { error: `Enter a 4-digit year between 1990 and ${MAX_YEAR}` })

const emailSchema = z.email().max(120)
const mobileSchema = z.string().regex(MOBILE_REGEX, {
  error: 'Enter 10–13 digits, e.g., 9876543210',
})
const pinSchema = z.string().regex(PIN_REGEX, { error: 'Enter a 6-digit PIN code' })
const percentageSchema = z.string().regex(PERCENTAGE_REGEX, {
  error: 'Enter a percentage between 0 and 100, e.g., 92.4',
})

const cityEntrySchema = z.string().min(1).max(60)
const cityListSchema = z
  .array(cityEntrySchema)
  .max(6)
  .refine(entries => new Set(entries).size === entries.length, {
    error: 'Remove duplicate cities',
  })

const subjectRowSchema = z.object({
  name: nonEmptyString(60),
  kind: z.enum(MARKS_KIND_VALUES),
  value: z.string().max(24),
})

const subjectListSchema = z
  .array(subjectRowSchema)
  .max(12)
  .refine(entries => new Set(entries.map(e => e.name.toLowerCase())).size === entries.length, {
    error: 'Remove duplicate subjects',
  })

export type SubjectRowInput = z.infer<typeof subjectRowSchema>

/** Validates a marks/grade value against the declared format, or any supported shape. */
function validateMarksValue(value: string, kind: MarksKind | null | undefined): string | null {
  if (kind === 'PERCENTAGE' && !PERCENTAGE_REGEX.test(value)) {
    return 'Percentage must be between 0 and 100, e.g., 92.4'
  }
  if (kind === 'CGPA' && !CGPA_REGEX.test(value)) {
    return 'CGPA must be between 0 and 10, e.g., 9.2'
  }
  if (kind === 'GRADE' && !GRADE_REGEX.test(value)) {
    return 'Enter a grade up to 8 characters, e.g., A1'
  }
  if (!kind) {
    const anyShape =
      PERCENTAGE_REGEX.test(value) || CGPA_REGEX.test(value) || GRADE_REGEX.test(value)
    if (!anyShape) return 'Enter marks (0–100), CGPA (0–10), or a grade like A1'
  }
  return null
}

/* ---------- literal field schemas map ---------- */

const FIELD_SCHEMAS: Record<string, z.ZodType> = {
  // Personal
  fullName: nonEmptyString(120, 2),
  gender: optionalEmpty(z.enum(GENDER_VALUES)),
  dateOfBirth: dobSchema,
  email: emailSchema,
  mobileNumber: mobileSchema,
  nationality: optionalEmpty(z.enum(NATIONALITY_VALUES)),
  nationalityOther: z.string().min(2).max(80),

  // Family
  fatherName: z.string().min(2).max(120),
  motherName: z.string().min(2).max(120),
  guardianName: z.string().min(2).max(120),
  guardianRelation: z.string().min(1).max(60),
  parentMobile: mobileSchema,
  parentEmail: emailSchema,
  parentOccupation: z.string().max(100),

  // Permanent address
  permanentAddressLine: nonEmptyString(240, 2),
  permanentCity: nonEmptyString(80, 2),
  permanentDistrict: nonEmptyString(80, 2),
  permanentState: optionalEmpty(z.enum(stateValues as [string, ...string[]])),
  permanentPinCode: pinSchema,
  permanentCountry: z.string().min(2).max(80),

  // Current address
  currentSameAsPermanent: z.boolean(),
  currentAddressLine: nonEmptyString(240, 2),
  currentCity: nonEmptyString(80, 2),
  currentDistrict: nonEmptyString(80, 2),
  currentState: optionalEmpty(z.enum(stateValues as [string, ...string[]])),
  currentPinCode: pinSchema,
  currentCountry: z.string().min(2).max(80),

  // Legacy address (still accepted from older clients)
  addressLine: nonEmptyString(240, 2),
  city: nonEmptyString(80, 2),
  state: optionalEmpty(z.enum(stateValues as [string, ...string[]])),
  pinCode: pinSchema,

  // Class 10
  class10Board: nonEmptyString(80, 2),
  class10SchoolName: nonEmptyString(160, 2),
  class10PassingYear: yearSchema,
  class10RollNumber: z.string().min(1).max(40),
  class10MarksKind: optionalEmpty(z.enum(MARKS_KIND_VALUES)),
  class10Marks: z.string().min(1).max(24),
  class10Percentage: percentageSchema,
  class10Subjects: subjectListSchema,

  // Class 12
  class12Status: optionalEmpty(z.enum(CLASS12_STATUS_VALUES)),
  class12Board: nonEmptyString(80, 2),
  class12SchoolName: nonEmptyString(160, 2),
  class12ExamYear: yearSchema,
  class12PassingYear: yearSchema,
  class12RollNumber: z.string().min(1).max(40),
  class12MarksKind: optionalEmpty(z.enum(MARKS_KIND_VALUES)),
  class12Marks: z.string().min(1).max(24),
  class12Percentage: percentageSchema,
  class12Subjects: subjectListSchema,

  // Category & certificates
  category: optionalEmpty(z.enum(CATEGORY_VALUES)),
  categoryOtherDetail: z.string().min(2).max(120),
  categoryConfirmed: z.boolean(),
  pwdStatus: z.boolean(),
  pwdStatusConfirmed: z.boolean(),
  pwdCertificateDocumentId: z.string().min(1).max(80),
  categoryCertificateType: z.string().min(1).max(40),
  categoryCertificateDocumentId: z.string().min(1).max(80),
  categoryCertificateNumber: z.string().min(1).max(120),
  categoryCertificateAuthority: z.string().min(2).max(160),
  categoryCertificateJurisdiction: z.string().min(2).max(120),
  categoryCertificateIssueDate: plainDateSchema,
  categoryCertificateValidUntil: plainDateSchema,
  categoryCertificateFinancialYear: z.string().min(1).max(40),
  categoryCertificateVerificationStatus: optionalEmpty(z.enum(VERIFICATION_VALUES)),

  // Preferences
  homeState: optionalEmpty(z.enum(stateValues as [string, ...string[]])),
  preferredExamCities: cityListSchema,
}

export const PROFILE_FIELD_IDS = Object.keys(FIELD_SCHEMAS)

/**
 * Draft-mode per-field parsing: every field is validated independently; valid
 * values are accepted, invalid values are reported and skipped. Empty strings
 * become null (no value). This never invents or transforms student-entered data.
 */
export function parseProfileDraft(raw: Record<string, unknown>): ProfileDraftResult {
  const accepted: Record<string, unknown> = {}
  const invalidFields: InvalidField[] = []

  for (const fieldId of PROFILE_FIELD_IDS) {
    const value = raw[fieldId]

    if (value === undefined) continue

    if (value === null || value === '') {
      accepted[fieldId] = null
      continue
    }

    const schema = FIELD_SCHEMAS[fieldId]
    if (!schema) continue

    const result = schema.safeParse(value)
    if (!result.success) {
      const firstMessage = result.error.issues[0]?.message ?? 'Invalid value'
      invalidFields.push({ field: fieldId, message: firstMessage })
      continue
    }

    accepted[fieldId] = result.data
  }

  // Cross-field checks: marks value must match the selected marks format.
  for (const [marksField, kindField] of [
    ['class10Marks', 'class10MarksKind'],
    ['class12Marks', 'class12MarksKind'],
  ] as const) {
    const marks = accepted[marksField]
    if (typeof marks !== 'string') continue
    const kind = (accepted[kindField] as MarksKind | null | undefined) ?? null
    const marksError = validateMarksValue(marks, kind)
    if (marksError) {
      invalidFields.push({ field: marksField, message: marksError })
      delete accepted[marksField]
    }
  }

  // Subject rows: validate the optional per-subject marks/grade value as well.
  for (const listField of ['class10Subjects', 'class12Subjects'] as const) {
    const rows = accepted[listField]
    if (!Array.isArray(rows)) continue
    rows.forEach((row, index) => {
      const subjectRow = row as { name: string; kind: MarksKind; value: string }
      if (!subjectRow.value) return
      const valueError = validateMarksValue(subjectRow.value, subjectRow.kind)
      if (valueError) {
        invalidFields.push({
          field: listField,
          message: `Subject “${subjectRow.name}”: ${valueError}`,
        })
        delete rows[index]
      }
    })
    const cleaned = rows.filter(Boolean)
    if (cleaned.length === 0 && Array.isArray(raw[listField])) accepted[listField] = null
    else accepted[listField] = cleaned.length === 0 ? null : cleaned
  }

  // A PwD certificate link only makes sense while the PwD answer is checked.
  if (accepted.pwdStatus === false && accepted.pwdCertificateDocumentId !== undefined) {
    accepted.pwdCertificateDocumentId = null
  }

  return { accepted, invalidFields }
}

/** Normalizes one uploaded subject row for parsing (trim + clamp). */
export function normalizeSubjectRows(rows: unknown): unknown | null {
  if (!Array.isArray(rows)) return null
  return rows
    .filter(row => row && typeof row === 'object')
    .slice(0, 12)
    .map(row => {
      const r = row as Record<string, unknown>
      return {
        name: typeof r.name === 'string' ? r.name.trim() : '',
        kind: MARKS_KIND_VALUES.includes(r.kind as MarksKind) ? r.kind : 'PERCENTAGE',
        value: typeof r.value === 'string' ? r.value.trim() : '',
      }
    })
}

/** Splits and cleans the preferred-cities input ("Delhi, Patna") into entries. */
export function splitCityInput(value: string): string[] {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0 && part.length <= 60)
}

export function subjectEntriesFromInput(rows: unknown): SubjectEntry[] {
  const normalized = normalizeSubjectRows(rows)
  if (!Array.isArray(normalized)) return []
  return normalized.map(row => {
    const r = row as { name: string; kind: string; value: string }
    return {
      name: r.name,
      kind: (r.kind as MarksKind) ?? 'PERCENTAGE',
      value: r.value,
    }
  })
}
