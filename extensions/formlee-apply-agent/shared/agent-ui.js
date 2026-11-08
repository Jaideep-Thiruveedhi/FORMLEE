/**
 * Shared Formlee agent UI vocabulary.
 *
 * One place for the human-readable names and status language used by the
 * popup and the Chrome Side Panel, so both interfaces describe fields,
 * results and adapter honesty identically. Previously the popup carried
 * its own copies of these tables while content/pet.js carried a larger
 * duplicate — the panels now share this superset.
 *
 * Dependency-free UMD wrapper (same pattern as shared/agent-core.js), so
 * it can be scripted into pages, panels and tests alike.
 */

const FormleeAgentUI = (function () {
  'use strict'

  /**
   * Superset of vault canonical field names → friendly labels (popup and
   * pet tables merged). Anything missing falls back to the raw canonical.
   */
  const FIELD_NAMES = {
    fullName: 'Full name',
    gender: 'Gender',
    dateOfBirth: 'Date of birth',
    dateOfBirthDay: 'Date of birth — day',
    dateOfBirthMonth: 'Date of birth — month',
    dateOfBirthYear: 'Date of birth — year',
    email: 'Email address',
    mobileNumber: 'Mobile number',
    nationality: 'Nationality',
    fatherName: "Father's name",
    motherName: "Mother's name",
    guardianName: 'Guardian name',
    guardianRelation: 'Guardian relation',
    permanentAddressLine: 'Permanent address',
    permanentCity: 'Permanent city',
    permanentState: 'Permanent state',
    permanentPinCode: 'Permanent PIN code',
    currentAddressLine: 'Current address',
    currentCity: 'Current city',
    currentState: 'Current state',
    currentPinCode: 'Current PIN code',
    addressLine: 'Address',
    city: 'City',
    state: 'State',
    pinCode: 'PIN code',
    class10Board: 'Class 10 board',
    class10SchoolName: 'Class 10 school',
    class10PassingYear: 'Class 10 passing year',
    class10RollNumber: 'Class 10 roll number',
    class10MarksKind: 'Class 10 marks format',
    class10Marks: 'Class 10 marks',
    class12Status: 'Class 12 status',
    class12Board: 'Class 12 board',
    class12SchoolName: 'Class 12 school',
    class12ExamYear: 'Class 12 exam year',
    class12PassingYear: 'Class 12 passing year',
    class12RollNumber: 'Class 12 roll number',
    class12MarksKind: 'Class 12 marks format',
    class12Marks: 'Class 12 marks',
    category: 'Category',
    pwdStatus: 'PwD status',
    homeState: 'Home state',
    preferredExamCities: 'Preferred exam cities',
  }

  /** Fill/verify outcome → honest sentence shown to the student. */
  const RESULT_LINES = {
    filled: 'filled and verified',
    'no-option': 'no matching option — left blank',
    stale: 'page changed since the scan — inspect again',
    refused: 'refused for safety',
    skipped: 'left untouched',
    unsupported: 'unsupported field type — left blank',
    'no-saved-value': 'no saved value in your profile — left blank',
    unverified: 'written but could not be verified — check it yourself',
  }

  const PAGE_KIND_LABELS = {
    personal: 'Personal Details',
    qualification: 'Qualification Details',
    exam: 'Examination choices',
    documents: 'Document uploads',
    declaration: 'Declaration',
    login: 'Login / registration',
    unknown: 'unrecognised page',
    generic: 'generic page',
  }

  function fieldName(canonical) {
    return FIELD_NAMES[canonical] || canonical || 'Field'
  }

  function resultLine(status) {
    return RESULT_LINES[status] || status || 'unknown result'
  }

  function pageKindLabel(kind) {
    return PAGE_KIND_LABELS[kind] || kind || 'this page'
  }

  /**
   * Reduce the adapter's free-text statusLabel to one of the supported,
   * user-facing status labels. The backend sends a human-readable sentence;
   * the panels extract the canonical keyword so the student sees a
   * consistent badge regardless of adapter wording.
   */
  function clearStatusLabel(adapterStatus) {
    const text = String(adapterStatus || '').toLowerCase()
    if (text.includes('fully tested')) return 'Fully tested'
    if (text.includes('limited beta')) return 'Limited beta'
    if (text.includes('demo only') || text.includes('/ demo') || text.includes('demonstration')) return 'Demo only'
    if (text.includes('documentation-backed')) return 'Documentation-backed'
    if (text.includes('coming soon')) return 'Coming soon'
    if (text.includes('unsupported')) return 'Unsupported'
    return null
  }

  /** Tone class for a banner: '', 'warn' or 'error'. */
  function adapterTone(adapterStatus) {
    const status = clearStatusLabel(adapterStatus)
    if (status === 'Fully tested') return ''
    if (status === 'Unsupported' || status === 'Coming soon') return 'error'
    return 'warn'
  }

  /** Honest one-line summary for the current adapter/page combination. */
  function adapterSummary(adapterStatus, pageKind) {
    const status = clearStatusLabel(adapterStatus)
    const page = pageKindLabel(pageKind)
    switch (status) {
      case 'Fully tested':
        return 'This adapter is fully tested and ready to use. Page: ' + page + '.'
      case 'Limited beta':
        return 'This adapter is in limited beta — review every field after filling. Page: ' + page + '.'
      case 'Documentation-backed':
        return 'This adapter uses published portal guidance only; the live page structure has not been verified. Page: ' + page + '.'
      case 'Demo only':
        return 'This adapter runs on the local demo only; the live portal has not been verified. Page: ' + page + '.'
      case 'Coming soon':
        return 'This examination is not yet supported by the Formlee agent.'
      case 'Unsupported':
        return 'This examination is not supported by the Formlee agent.'
      default:
        return 'Page: ' + page + '.'
    }
  }

  return {
    FIELD_NAMES,
    RESULT_LINES,
    PAGE_KIND_LABELS,
    fieldName,
    resultLine,
    pageKindLabel,
    clearStatusLabel,
    adapterTone,
    adapterSummary,
  }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = FormleeAgentUI
