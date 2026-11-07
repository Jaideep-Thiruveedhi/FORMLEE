/**
 * Pure profile-value projection for the Apply Agent.
 *
 * Kept free of database/network imports so the "never invent data" rules can
 * be tested directly. `values.ts` performs the workspace-scoped lookup and
 * then delegates here.
 */

export const AGENT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function derivedDobParts(iso: string | null): { day: string; month: string; year: string } | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const monthNumber = parseInt(match[2], 10)
  const dayNumber = parseInt(match[3], 10)
  if (monthNumber < 1 || monthNumber > 12) return null
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  if (dayNumber < 1 || dayNumber > daysInMonth) return null
  return {
    year: match[1],
    month: AGENT_MONTH_NAMES[monthNumber - 1],
    day: match[3],
  }
}

/**
 * Resolves one canonical field from the student's saved profile row. Returns
 * null when the profile has no usable value — callers must report the field as
 * missing and leave the form untouched, never guess.
 */
export function valueFromProfileRow(profile: Record<string, unknown>, field: string): string | boolean | null {
  const class12Status = stringOrEmpty(profile.class12Status)
  const class12Passed = class12Status === 'PASSED'

  switch (field) {
    // Personal
    case 'fullName':
    case 'email':
    case 'mobileNumber':
    case 'nationality':
    case 'nationalityOther':
    // Family
    case 'fatherName':
    case 'motherName':
    case 'guardianName':
    case 'guardianRelation':
    case 'parentMobile':
    case 'parentEmail':
    case 'parentOccupation':
    // Address (explicit current/permanent values; legacy fallbacks below)
    case 'permanentAddressLine':
    case 'permanentCity':
    case 'permanentDistrict':
    case 'permanentCountry':
    case 'currentAddressLine':
    case 'currentCity':
    case 'currentDistrict':
    case 'currentCountry':
    // Class 10
    case 'class10Board':
    case 'class10SchoolName':
    case 'class10RollNumber':
    case 'class10Marks':
    case 'class10Percentage':
    // Class 12
    case 'class12Board':
    case 'class12SchoolName':
    case 'class12RollNumber':
      return stringOrEmpty(profile[field]) || null

    case 'permanentState':
      return stringOrEmpty(profile.permanentState) || stringOrEmpty(profile.state) || null
    case 'permanentPinCode':
      return stringOrEmpty(profile.permanentPinCode) || stringOrEmpty(profile.pinCode) || null
    case 'currentState':
      return stringOrEmpty(profile.currentState) || null
    case 'currentPinCode':
      return stringOrEmpty(profile.currentPinCode) || null

    // Legacy single-address fields stay usable for older forms but point at
    // the permanent address, which is the safe default for "address" labels.
    case 'addressLine':
      return stringOrEmpty(profile.permanentAddressLine) || stringOrEmpty(profile.addressLine) || null
    case 'city':
      return stringOrEmpty(profile.permanentCity) || stringOrEmpty(profile.city) || null
    case 'state':
      return stringOrEmpty(profile.permanentState) || stringOrEmpty(profile.state) || null
    case 'pinCode':
      return stringOrEmpty(profile.permanentPinCode) || stringOrEmpty(profile.pinCode) || null

    case 'gender':
    case 'class10MarksKind':
    case 'homeState':
      return stringOrEmpty(profile[field]) || null

    // Category is filled ONLY after an explicit student confirmation. An
    // unconfirmed category is reported missing, never guessed or inferred.
    case 'category':
      return profile.categoryConfirmed === true ? stringOrEmpty(profile.category) || null : null
    case 'categoryOtherDetail':
      return profile.categoryConfirmed === true ? stringOrEmpty(profile.categoryOtherDetail) || null : null

    case 'dateOfBirth':
      return stringOrEmpty(profile.dateOfBirth) || null
    case 'dateOfBirthDay':
    case 'dateOfBirthMonth':
    case 'dateOfBirthYear': {
      const parts = derivedDobParts(typeof profile.dateOfBirth === 'string' ? profile.dateOfBirth : null)
      if (!parts) return null
      if (field === 'dateOfBirthDay') return parts.day
      if (field === 'dateOfBirthMonth') return parts.month
      return parts.year
    }

    case 'class10PassingYear':
      return typeof profile.class10PassingYear === 'number' ? String(profile.class10PassingYear) : null
    case 'class12ExamYear':
      return typeof profile.class12ExamYear === 'number' ? String(profile.class12ExamYear) : null
    case 'class12PassingYear':
      // A pending/appearing student has no passing year. Leaving this missing
      // is deliberate; the form field is never filled with a guessed result.
      return class12Passed && typeof profile.class12PassingYear === 'number'
        ? String(profile.class12PassingYear)
        : null
    case 'class12MarksKind':
      return class12Passed ? stringOrEmpty(profile.class12MarksKind) || null : null
    case 'class12Marks':
      return class12Passed ? stringOrEmpty(profile.class12Marks) || null : null
    case 'class12Percentage':
      return class12Passed ? stringOrEmpty(profile.class12Percentage) || null : null
    case 'class12Status':
      return class12Status || null

    case 'pwdStatus':
      // Only ever CHECKED after the student explicitly confirmed the PwD
      // answer. An unchecked/unknown box is left exactly as the form has it.
      return profile.pwdStatus === true && profile.pwdStatusConfirmed === true ? true : null
    case 'preferredExamCities': {
      if (!Array.isArray(profile.preferredExamCities)) return null
      const cities = profile.preferredExamCities
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map(c => c.trim())
      return cities.length > 0 ? cities.join(', ') : null
    }
    default:
      return null
  }
}
