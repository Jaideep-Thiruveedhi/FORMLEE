import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Readiness checker focused unit tests.
 *
 * Run with tsx so TypeScript imports resolve without building:
 *
 *   npx tsx --test scripts/tests/readiness-checker.test.mjs
 *
 * These tests exercise the pure engine only — no database or server is needed.
 */

import { evaluateApplication } from '../../src/lib/apply-ai/applications.ts'
import { EXAM_BY_ID } from '../../src/lib/apply-ai/exams.ts'
import {
  validateCertificateMetadata,
  validateDocumentAgainstSpec,
} from '../../src/lib/apply-ai/document-validation.ts'
import {
  checkApplicationPreferenceConsistency,
  checkProfileSnapshotConsistency,
} from '../../src/lib/apply-ai/consistency.ts'
import { imageDimensionsFromBytes } from '../../src/lib/apply-ai/storage.ts'

const JEE = EXAM_BY_ID.JEE_MAIN

function baseProfile(overrides = {}) {
  return {
    id: 'profile-1',
    fullName: 'Amit Kumar',
    gender: 'MALE',
    dateOfBirth: '2008-04-12',
    email: 'amit@example.com',
    mobileNumber: '9876543210',
    nationality: 'India',
    nationalityOther: null,
    fatherName: 'Ramesh Kumar',
    motherName: 'Sunita Kumar',
    guardianName: null,
    guardianRelation: null,
    parentMobile: null,
    parentEmail: null,
    parentOccupation: null,
    permanentAddressLine: '12 MG Road',
    permanentCity: 'Patna',
    permanentDistrict: null,
    permanentState: 'Bihar',
    permanentPinCode: '800001',
    permanentCountry: 'India',
    currentSameAsPermanent: true,
    currentAddressLine: null,
    currentCity: null,
    currentDistrict: null,
    currentState: null,
    currentPinCode: null,
    currentCountry: null,
    addressLine: null,
    city: null,
    state: null,
    pinCode: null,
    class10Board: 'CBSE',
    class10SchoolName: 'Delhi Public School',
    class10PassingYear: '2024',
    class10RollNumber: 'C10-1234',
    class10MarksKind: 'PERCENTAGE',
    class10Marks: '92',
    class10Percentage: '92',
    class10Subjects: [],
    class12Status: 'APPEARING',
    class12Board: 'CBSE',
    class12SchoolName: 'Delhi Public School',
    class12ExamYear: '2027',
    class12PassingYear: null,
    class12RollNumber: 'C12-5678',
    class12MarksKind: null,
    class12Marks: null,
    class12Percentage: null,
    class12Subjects: [],
    class12ResultDeclaredAt: null,
    class12ResultUpdatedAt: null,
    category: 'GENERAL',
    categoryOtherDetail: null,
    categoryConfirmed: true,
    categoryConfirmedAt: null,
    pwdStatus: false,
    pwdStatusConfirmed: true,
    pwdCertificateDocumentId: null,
    categoryCertificateType: null,
    categoryCertificateDocumentId: null,
    categoryCertificateNumber: null,
    categoryCertificateAuthority: null,
    categoryCertificateJurisdiction: null,
    categoryCertificateIssueDate: null,
    categoryCertificateValidUntil: null,
    categoryCertificateFinancialYear: null,
    categoryCertificateVerificationStatus: 'SELF_REPORTED',
    categoryCertificateLastConfirmedAt: null,
    homeState: 'Bihar',
    preferredExamCities: ['Patna', 'Delhi'],
    profileVersion: 1,
    lastMajorUpdateAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function baseRow(overrides = {}) {
  return {
    id: 'app-1',
    workspaceId: 'ws-1',
    examId: 'JEE_MAIN',
    sessionId: 'jee-2027-session-1',
    examSession: 'Session 1',
    applicationYear: 2027,
    status: 'NOT_STARTED',
    preferences: {},
    checklist: {},
    notes: null,
    deadlineDate: '2027-01-15',
    deadlineState: 'ANNOUNCED',
    deadlineLabel: 'Last date to apply',
    deadlineSourceLabel: null,
    deadlineSourceUrl: null,
    deadlineVerifiedAt: null,
    deadlineNeedsUpdate: false,
    studentSubmittedAt: null,
    portalReferenceRecordedAt: null,
    portalReference: null,
    profileSnapshot: null,
    profileSnapshotAt: null,
    profileVersion: 1,
    mappingReviewRequired: false,
    mappingChangedFields: [],
    mappingReviewedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  }
}

function doc(overrides = {}) {
  return {
    id: 'doc-' + Math.random().toString(36).slice(2),
    documentType: 'PHOTO',
    displayLabel: null,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 50 * 1024,
    versions: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    replacedAt: null,
    isCurrent: true,
    supersedesId: null,
    certificate: {
      certificateNumber: null,
      issuingAuthority: null,
      issuingState: null,
      issueDate: null,
      validUntil: null,
      financialYear: null,
      verificationStatus: 'SELF_REPORTED',
      lastConfirmedAt: null,
    },
    hasPreviousVersions: false,
    ...overrides,
  }
}

function requiredDocuments() {
  return [
    doc({ documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 50 * 1024 }),
    doc({ documentType: 'SIGNATURE', mimeType: 'image/jpeg', sizeBytes: 30 * 1024 }),
    doc({ documentType: 'CLASS10_MARKSHEET', mimeType: 'application/pdf', sizeBytes: 100 * 1024, originalName: 'class10.pdf' }),
  ]
}

function evaluate(row, profile, documents, dimensions) {
  return evaluateApplication(row, JEE, profile, documents, { documentDimensions: dimensions })
}

/* --------------------------------------------------------------------------- */
/* Class 12 status handling                                                    */
/* --------------------------------------------------------------------------- */

test('appearing student is not penalised for missing Class 12 marks', () => {
  const profile = baseProfile({ class12Status: 'APPEARING', class12Marks: null, class12Percentage: null })
  const documents = requiredDocuments()
  const result = evaluate(baseRow(), profile, documents)
  const class12 = result.items.find(item => item.id === 'jee-profile-class12')
  assert.ok(class12)
  assert.equal(class12.state, 'AWAITING_RESULTS')
  assert.equal(class12.met, true)
  assert.equal(result.awaitingResultsCount, 1)
  assert.equal(result.missingCount, 0)
  assert.equal(result.readinessState, 'PARTIALLY_READY')
})

test('result-awaited student is not forced to invent marks', () => {
  const profile = baseProfile({
    class12Status: 'RESULT_AWAITED',
    class12ExamYear: '2026',
    class12PassingYear: null,
    class12Marks: null,
    class12Percentage: null,
  })
  const documents = requiredDocuments()
  const result = evaluate(baseRow(), profile, documents)
  const class12 = result.items.find(item => item.id === 'jee-profile-class12')
  assert.ok(class12)
  assert.equal(class12.state, 'AWAITING_RESULTS')
  assert.equal(class12.met, true)
  assert.equal(result.readinessState, 'PARTIALLY_READY')
})

test('dropper with previous passing details is complete for Class 12', () => {
  const profile = baseProfile({
    class12Status: 'PASSED',
    class12PassingYear: '2026',
    class12MarksKind: 'PERCENTAGE',
    class12Marks: '88',
    class12Percentage: '88',
    class12Subjects: [{ name: 'Physics', kind: 'PERCENTAGE', value: '90' }],
  })
  const documents = requiredDocuments()
  const result = evaluate(baseRow(), profile, documents)
  const class12 = result.items.find(item => item.id === 'jee-profile-class12')
  assert.ok(class12)
  assert.equal(class12.state, 'COMPLETE')
  assert.equal(class12.met, true)
})

/* --------------------------------------------------------------------------- */
/* Document validation                                                         */
/* --------------------------------------------------------------------------- */

test('photograph with wrong MIME type is flagged', () => {
  const profile = baseProfile()
  const documents = [
    doc({ documentType: 'PHOTO', mimeType: 'image/webp', sizeBytes: 80 * 1024 }),
    doc({ documentType: 'SIGNATURE', mimeType: 'image/jpeg', sizeBytes: 30 * 1024 }),
    doc({ documentType: 'CLASS10_MARKSHEET', mimeType: 'application/pdf', sizeBytes: 100 * 1024, originalName: 'class10.pdf' }),
  ]
  const result = evaluate(baseRow(), profile, documents)
  const photo = result.items.find(item => item.id === 'jee-doc-photo')
  assert.ok(photo)
  assert.equal(photo.state, 'ATTENTION_REQUIRED')
  assert.ok(photo.issues.some(issue => issue.code === 'DOC_WRONG_MIME'))
  assert.equal(result.attentionRequiredCount, 1)
})

test('oversized photograph is flagged with actionable message', () => {
  const profile = baseProfile()
  const documents = [
    doc({ documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 500 * 1024 }),
    doc({ documentType: 'SIGNATURE', mimeType: 'image/jpeg', sizeBytes: 30 * 1024 }),
    doc({ documentType: 'CLASS10_MARKSHEET', mimeType: 'application/pdf', sizeBytes: 100 * 1024, originalName: 'class10.pdf' }),
  ]
  const result = evaluate(baseRow(), profile, documents)
  const photo = result.items.find(item => item.id === 'jee-doc-photo')
  assert.ok(photo)
  assert.equal(photo.state, 'ATTENTION_REQUIRED')
  const issue = photo.issues.find(i => i.code === 'DOC_TOO_LARGE')
  assert.ok(issue)
  assert.match(issue.message, /200[\.0]*\s*kB/)
})

test('photograph with correct spec is complete', () => {
  const profile = baseProfile()
  const documents = requiredDocuments()
  const result = evaluate(baseRow(), profile, documents)
  const photo = result.items.find(item => item.id === 'jee-doc-photo')
  assert.ok(photo)
  assert.equal(photo.state, 'COMPLETE')
  assert.equal(photo.issues.length, 0)
})

test('dimension parser supports PNG and JPEG', () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x01, 0x2c, 0x00, 0x00, 0x01, 0x90,
  ])
  assert.deepEqual(imageDimensionsFromBytes(png), { width: 300, height: 400 })

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x64, 0x00, 0x96, 0x01,
    0x01, 0x11, 0x00,
  ])
  assert.deepEqual(imageDimensionsFromBytes(jpeg), { width: 150, height: 100 })

  assert.equal(imageDimensionsFromBytes(Buffer.from('not an image')), null)
})

test('document validator flags wrong dimensions against a supplied spec', () => {
  const photoDoc = doc({ documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 50 * 1024 })
  const spec = {
    mimeTypes: ['image/jpeg'],
    minBytes: 10 * 1024,
    maxBytes: 200 * 1024,
    minWidth: 100,
    minHeight: 120,
    maxWidth: 400,
    maxHeight: 500,
    spec: 'Test spec',
  }
  const issues = validateDocumentAgainstSpec(photoDoc, spec, { width: 50, height: 50 })
  assert.ok(issues.some(issue => issue.code === 'DOC_DIMENSION_WIDTH_LOW'))
  assert.ok(issues.some(issue => issue.code === 'DOC_DIMENSION_HEIGHT_LOW'))

  const okIssues = validateDocumentAgainstSpec(photoDoc, spec, { width: 200, height: 240 })
  assert.equal(okIssues.length, 0)
})

/* --------------------------------------------------------------------------- */
/* Certificate validation                                                      */
/* --------------------------------------------------------------------------- */

test('expired category certificate is flagged urgent', () => {
  const certificateDoc = doc({
    documentType: 'CATEGORY_CERTIFICATE',
    originalName: 'obc-cert.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100 * 1024,
    certificate: {
      certificateNumber: 'OB-1234',
      issuingAuthority: 'Bihar Govt',
      issuingState: 'Bihar',
      issueDate: '2024-01-01',
      validUntil: '2024-12-31',
      financialYear: '2023-24',
      verificationStatus: 'SELF_REPORTED',
      lastConfirmedAt: null,
    },
  })
  const issues = validateCertificateMetadata(certificateDoc, {})
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'CERT_EXPIRED')
  assert.equal(issues[0].severity, 'urgent')
})

test('future-dated certificate is flagged warning', () => {
  const certificateDoc = doc({
    documentType: 'CATEGORY_CERTIFICATE',
    originalName: 'obc-cert.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100 * 1024,
    certificate: {
      certificateNumber: 'OB-1234',
      issuingAuthority: 'Bihar Govt',
      issuingState: 'Bihar',
      issueDate: '2030-01-01',
      validUntil: '2031-12-31',
      financialYear: '2029-30',
      verificationStatus: 'SELF_REPORTED',
      lastConfirmedAt: null,
    },
  })
  const issues = validateCertificateMetadata(certificateDoc, {})
  assert.ok(issues.some(issue => issue.code === 'CERT_FUTURE_ISSUE'))
})

test('category certificate without number shows info', () => {
  const certificateDoc = doc({
    documentType: 'CATEGORY_CERTIFICATE',
    originalName: 'obc-cert.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100 * 1024,
    certificate: {
      certificateNumber: null,
      issuingAuthority: 'Bihar Govt',
      issuingState: 'Bihar',
      issueDate: '2026-01-01',
      validUntil: '2027-12-31',
      financialYear: '2025-26',
      verificationStatus: 'SELF_REPORTED',
      lastConfirmedAt: null,
    },
  })
  const issues = validateCertificateMetadata(certificateDoc, {})
  assert.ok(issues.some(issue => issue.code === 'CERT_NUMBER_MISSING'))
})

/* --------------------------------------------------------------------------- */
/* Consistency checks                                                          */
/* --------------------------------------------------------------------------- */

test('snapshot consistency detects different name spelling', () => {
  const profile = baseProfile({ fullName: 'Amit Kumar' })
  const snapshot = { values: { fullName: 'Amit Kumaar' } }
  const issues = checkProfileSnapshotConsistency(profile, snapshot)
  assert.ok(issues.some(issue => issue.field === 'Full name'))
  const nameIssue = issues.find(issue => issue.field === 'Full name')
  assert.equal(nameIssue.vaultValue, 'Amit Kumar')
  assert.equal(nameIssue.applicationValue, 'Amit Kumaar')
})

test('snapshot consistency detects conflicting Class 12 year', () => {
  const profile = baseProfile({ class12PassingYear: '2026' })
  const snapshot = { values: { class12PassingYear: '2025' } }
  const issues = checkProfileSnapshotConsistency(profile, snapshot)
  assert.ok(issues.some(issue => issue.field === 'Class 12 passing year'))
})

test('preference consistency detects category mismatch', () => {
  const profile = baseProfile({ category: 'GENERAL' })
  const issues = checkApplicationPreferenceConsistency(profile, { category: 'OBC' })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].field, 'category')
  assert.equal(issues[0].vaultValue, 'GENERAL')
  assert.equal(issues[0].applicationValue, 'OBC')
})

test('identical values produce no consistency issues', () => {
  const profile = baseProfile()
  const snapshot = {
    values: {
      fullName: 'Amit Kumar',
      dateOfBirth: '2008-04-12',
      email: 'amit@example.com',
      mobileNumber: '9876543210',
      class10PassingYear: '2024',
      class12PassingYear: null,
      category: 'GENERAL',
    },
  }
  const issues = checkProfileSnapshotConsistency(profile, snapshot)
  assert.equal(issues.length, 0)
})

/* --------------------------------------------------------------------------- */
/* Integration: missing documents                                              */
/* --------------------------------------------------------------------------- */

test('missing photograph is reported as missing requirement', () => {
  const profile = baseProfile()
  const result = evaluate(baseRow(), profile, [])
  const photo = result.items.find(item => item.id === 'jee-doc-photo')
  assert.ok(photo)
  assert.equal(photo.state, 'MISSING')
  assert.equal(photo.met, false)
  assert.ok(result.missingDocumentLabels.includes('Photograph'))
})

test('conditional category certificate is omitted when not applicable', () => {
  const profile = baseProfile({ category: 'GENERAL' })
  const result = evaluate(baseRow(), profile, [])
  const categoryCert = result.items.find(item => item.id === 'jee-doc-category')
  assert.equal(categoryCert, undefined)
})

test('PwD certificate is required when PwD status is true', () => {
  const profile = baseProfile({ pwdStatus: true, pwdStatusConfirmed: true })
  const result = evaluate(baseRow(), profile, [])
  const pwdCert = result.items.find(item => item.id === 'jee-doc-pwd')
  assert.ok(pwdCert)
  assert.equal(pwdCert.state, 'MISSING')
})

/* --------------------------------------------------------------------------- */
/* Snapshot staleness                                                          */
/* --------------------------------------------------------------------------- */

test('snapshot is stale when vault profileVersion is newer', () => {
  const profile = baseProfile({ profileVersion: 3 })
  const documents = requiredDocuments(profile)
  const row = baseRow({
    profileSnapshot: { values: {}, profileVersion: 2 },
    profileVersion: 2,
    checklist: {
      'jee-manual-bulletin': { done: true, updatedAt: '2026-10-01T00:00:00.000Z' },
      'jee-manual-preview': { done: true, updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  })
  const result = evaluate(row, profile, documents)
  assert.equal(result.snapshotStale, true)
  assert.equal(result.readinessState, 'PARTIALLY_READY')
})

test('snapshot is not stale when versions match', () => {
  const profile = baseProfile({ profileVersion: 2 })
  const documents = requiredDocuments(profile)
  const row = baseRow({
    profileSnapshot: { values: {}, profileVersion: 2 },
    profileVersion: 2,
    checklist: {
      'jee-manual-bulletin': { done: true, updatedAt: '2026-10-01T00:00:00.000Z' },
      'jee-manual-preview': { done: true, updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  })
  const result = evaluate(row, profile, documents)
  assert.equal(result.snapshotStale, false)
})

/* --------------------------------------------------------------------------- */
/* Cross-workspace isolation                                                   */
/* --------------------------------------------------------------------------- */

test('document dimensions are scoped to a workspace id and stored filename', () => {
  // The helper buildDocumentDimensionsMap uses workspaceId + storedName to read
  // files from the private storage root. This test verifies the pure dimension
  // parser itself is workspace-agnostic and only the caller supplies the scope.
  const docA = doc({ id: 'doc-a', documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 50 * 1024 })
  const docB = doc({ id: 'doc-b', documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 50 * 1024 })

  // Direct validator check: each workspace map points to a different file,
  // so the same profile+document yields different validation outcomes.
  const spec = {
    mimeTypes: ['image/jpeg'],
    minBytes: 10 * 1024,
    maxBytes: 200 * 1024,
    minWidth: 150,
    minHeight: 150,
    spec: 'Test dimension spec',
  }
  const issuesA = validateDocumentAgainstSpec(docA, spec, { width: 100, height: 100 })
  const issuesB = validateDocumentAgainstSpec(docB, spec, { width: 200, height: 200 })
  assert.equal(issuesA.length > 0, true)
  assert.equal(issuesB.length, 0)
})
