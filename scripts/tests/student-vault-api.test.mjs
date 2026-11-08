import test from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

/**
 * Student Information Vault — end-to-end API tests.
 *
 * Run against an ISOLATED server + disposable database, e.g.:
 *
 *   $env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/formlee_vault_test?schema=public'
 *   $env:FORMLEE_STORAGE_DIR='C:\Temp\formlee-vault-test-storage'
 *   $env:BETTER_AUTH_URL='http://localhost:3101'
 *   npx next dev -p 3101
 *   $env:STUDENT_VAULT_TEST_BASE_URL='http://localhost:3101'
 *   node --test scripts/tests/student-vault-api.test.mjs
 *
 * Every test mints its own anonymous workspace. It never touches the
 * development workspace or any production database.
 */

const BASE_URL = (
  process.env.STUDENT_VAULT_TEST_BASE_URL ?? 'http://localhost:3101'
).replace(/\/$/, '')

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xuoAAAAASUVORK5CYII=',
  'base64'
)

const prisma = new PrismaClient()

/* ---------------- HTTP harness ---------------- */

function createJar() {
  return { cookies: new Map() }
}

function cookieHeader(jar) {
  return Array.from(jar.cookies, ([name, value]) => `${name}=${value}`).join('; ')
}

function storeCookies(jar, response) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const raw of setCookies) {
    const [pair] = raw.split(';')
    const equals = pair.indexOf('=')
    if (equals > 0) {
      jar.cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim())
    }
  }
}

async function request(jar, path, init = {}) {
  const headers = new Headers(init.headers ?? {})
  if (jar && jar.cookies.size > 0) headers.set('cookie', cookieHeader(jar))

  let body = init.body
  if (
    body &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !Buffer.isBuffer(body)
  ) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(BASE_URL + path, {
    ...init,
    body,
    headers,
    redirect: 'manual',
  })
  if (jar) storeCookies(jar, response)

  const text = await response.text()
  let json = null
  try {
    json = text.length > 0 ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { response, status: response.status, body: json, text }
}

async function freshWorkspace() {
  const jar = createJar()
  const result = await request(jar, '/api/apply/workspace', { method: 'POST' })
  assert.equal(result.status, 200, `workspace creation failed: ${result.text}`)
  assert.ok(jar.cookies.size > 0, 'workspace response must set an httpOnly cookie')
  return jar
}

async function saveProfile(jar, payload) {
  return request(jar, '/api/apply/profile', { method: 'PUT', body: payload })
}

async function getProfile(jar) {
  return request(jar, '/api/apply/profile')
}

function section(evaluation, sectionId) {
  const found = evaluation.sections.find(entry => entry.sectionId === sectionId)
  assert.ok(found, `section ${sectionId} missing from evaluation`)
  return found
}

async function uploadDocument(jar, documentType, extra = {}, fileName = 'document.png') {
  const form = new FormData()
  form.set('documentType', documentType)
  form.set('file', new File([PNG_BYTES], fileName, { type: 'image/png' }))
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return request(jar, '/api/apply/documents', { method: 'POST', body: form })
}

async function createApplication(jar, examId = 'JEE_MAIN', sessionId = 'jee-main-2027-session-1') {
  return request(jar, '/api/apply/applications', {
    method: 'POST',
    body: { examId, sessionId },
  })
}

async function pairAgent(jar) {
  const ticket = await request(jar, '/api/agent/pairing-ticket', { method: 'POST' })
  assert.equal(ticket.status, 200, ticket.text)
  const paired = await request(jar, '/api/agent/pair', {
    method: 'POST',
    body: { code: ticket.body.code },
  })
  assert.equal(paired.status, 200, paired.text)
  return paired.body.token
}

async function agentValues(token, fields) {
  return request(null, '/api/agent/values', {
    method: 'POST',
    headers: { 'x-rankora-agent-session': token },
    body: { fields },
  })
}

/* ---------------- profile fixtures ---------------- */

const BASE = {
  fullName: 'Vault Test Student',
  dateOfBirth: '2008-05-14',
  gender: 'FEMALE',
  email: 'vault.test@example.com',
  mobileNumber: '9876543210',
  nationality: 'India',
  fatherName: 'Test Father',
  motherName: 'Test Mother',
  permanentAddressLine: '12 Test Lane',
  permanentCity: 'Patna',
  permanentDistrict: 'Patna',
  permanentState: 'Bihar',
  permanentPinCode: '800001',
  permanentCountry: 'India',
  currentSameAsPermanent: true,
  class10Board: 'CBSE',
  class10SchoolName: 'Test Public School',
  class10PassingYear: '2024',
  class10MarksKind: 'PERCENTAGE',
  class10Marks: '92.4',
  class12Board: 'CBSE',
  class12SchoolName: 'Test Public School',
  category: 'GENERAL',
  categoryConfirmed: true,
  pwdStatus: false,
  homeState: 'Bihar',
  preferredExamCities: ['Patna'],
}

const STUDENT_A = {
  ...BASE,
  fullName: 'Student A Appearing',
  email: 'student.a@example.com',
  class12Status: 'APPEARING',
  class12ExamYear: '2027',
}

const STUDENT_B = {
  ...BASE,
  fullName: 'Student B Result Awaited',
  email: 'student.b@example.com',
  class12Status: 'RESULT_AWAITED',
  class12ExamYear: '2026',
}

const STUDENT_C = {
  ...BASE,
  fullName: 'Student C Passed',
  email: 'student.c@example.com',
  class12Status: 'PASSED',
  class12PassingYear: '2026',
  class12MarksKind: 'PERCENTAGE',
  class12Marks: '91.8',
  class12Percentage: '91.8',
}

const STUDENT_D = {
  ...BASE,
  fullName: 'Student D Dropper',
  email: 'student.d@example.com',
  class12Status: 'PASSED',
  class12PassingYear: '2025',
  class12MarksKind: 'PERCENTAGE',
  class12Marks: '88.2',
  class12Percentage: '88.2',
  category: 'OBC_NCL',
  categoryConfirmed: false,
}

const STUDENT_E = {
  ...BASE,
  fullName: 'Student E Certificate',
  email: 'student.e@example.com',
  class12Status: 'PASSED',
  class12PassingYear: '2025',
  category: 'SC',
  categoryConfirmed: true,
  pwdStatus: true,
  pwdStatusConfirmed: false,
}

const STUDENT_F = {
  ...BASE,
  fullName: 'Student F Minimal',
  email: 'student.f@example.com',
  class12Status: 'PASSED',
  class12PassingYear: '2026',
  category: 'GENERAL',
  categoryConfirmed: true,
  pwdStatus: false,
  guardianName: undefined,
  guardianRelation: undefined,
}

/* ---------------- tests ---------------- */

test('Student Information Vault API', { timeout: 600_000 }, async t => {
  try {
    await request(null, '/api/apply/workspace', { method: 'POST' })
  } catch {
    assert.fail(
      `Vault test server is not reachable at ${BASE_URL}. ` +
        'Start an isolated server against a disposable database first.'
    )
  }
  await prisma.$connect()
  t.after(async () => {
    await prisma.$disconnect()
  })

  await t.test('missing and invalid data are reported, never invented', async () => {
    const jar = await freshWorkspace()

    const empty = await getProfile(jar)
    assert.equal(empty.status, 200)
    assert.equal(empty.body.profile, null)
    assert.equal(empty.body.evaluation.status, 'INCOMPLETE')

    const created = await saveProfile(jar, {})
    assert.equal(created.status, 200, created.text)
    assert.ok(created.body.profile.id)
    assert.equal(created.body.profile.profileVersion, 1)
    assert.deepEqual(created.body.changedFields, ['profile-created'])
    assert.equal(created.body.history.length, 1)

    const again = await saveProfile(jar, {})
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.changedFields, [], 'unchanged save must not create history')
    assert.equal(again.body.profile.profileVersion, 1, 'unchanged save must not bump the version')
    assert.equal(again.body.history.length, 1)

    const invalid = await saveProfile(jar, {
      fullName: 'A',
      email: 'not-an-email',
      pinCode: '123',
      dateOfBirth: '2099-01-01',
      class10PassingYear: '1800',
      class10MarksKind: 'PERCENTAGE',
      class10Marks: 'A1',
      categoryConfirmed: true,
    })
    assert.equal(invalid.status, 200, invalid.text)
    const fields = invalid.body.invalidFields.map(issue => issue.field).sort()
    for (const expected of [
      'fullName',
      'email',
      'pinCode',
      'dateOfBirth',
      'class10PassingYear',
      'class10Marks',
    ]) {
      assert.ok(fields.includes(expected), `expected ${expected} to be rejected, got ${fields}`)
    }
    // Draft mode keeps the valid values and rejects only the invalid ones: the
    // one valid field (marks format) is stored, nothing invalid is.
    assert.equal(invalid.body.profile.fullName, null)
    assert.equal(invalid.body.profile.email, null)
    assert.equal(invalid.body.profile.pinCode, null)
    assert.equal(invalid.body.profile.class10PassingYear, null)
    assert.equal(invalid.body.profile.class10Marks, null)
    assert.equal(invalid.body.profile.class10MarksKind, 'PERCENTAGE')
    assert.equal(invalid.body.profile.categoryConfirmed, false)
    assert.equal(invalid.body.profile.profileVersion, 2)
  })

  await t.test('Student A — appearing in Class 12 is awaiting, not incomplete', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_A)
    assert.equal(saved.status, 200, saved.text)

    const evaluation = saved.body.evaluation
    assert.equal(evaluation.status, 'COMPLETE')
    assert.equal(evaluation.completedSections, 7)
    assert.equal(evaluation.hasAwaitingResults, true)
    assert.equal(section(evaluation, 'class12').state, 'AWAITING_RESULTS')
    assert.equal(saved.body.profile.class12Marks, null)
    assert.equal(saved.body.profile.class12PassingYear, null)

    const app = await createApplication(jar)
    assert.equal(app.status, 201, app.text)
    const result = app.body.application.evaluation
    assert.equal(result.awaitingResultsCount, 1)
    assert.equal(
      result.missingDocumentLabels.includes('Class 12 marksheet / certificate'),
      false,
      'pending results must not make the Class 12 marksheet missing'
    )
    assert.equal(result.missingProfileLabels.length, 0)
  })

  await t.test('Student B — result awaited with no marks', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_B)
    assert.equal(saved.status, 200, saved.text)
    assert.equal(section(saved.body.evaluation, 'class12').state, 'AWAITING_RESULTS')
    assert.equal(saved.body.profile.class12ExamYear, 2026)
    assert.equal(saved.body.profile.class12PassingYear, null)

    const app = await createApplication(jar)
    assert.equal(app.status, 201, app.text)
    const result = app.body.application.evaluation
    assert.equal(result.awaitingResultsCount, 1)
    assert.equal(result.missingDocumentLabels.includes('Class 12 marksheet / certificate'), false)
  })

  await t.test('Student C — Update Class 12 Results mutates the same record and keeps history', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, {
      ...STUDENT_A,
      fullName: 'Student C Passed',
      email: 'student.c@example.com',
    })
    const profileId = saved.body.profile.id
    assert.equal(saved.body.profile.profileVersion, 1)

    const update = await request(jar, '/api/apply/profile/class12-results', {
      method: 'POST',
      body: {
        class12PassingYear: '2026',
        resultDeclaredOn: '2026-05-20',
        class12RollNumber: 'C12-9999',
        class12MarksKind: 'PERCENTAGE',
        class12Marks: '91.8',
        class12Percentage: '91.8',
      },
    })
    assert.equal(update.status, 200, update.text)
    assert.equal(update.body.profile.id, profileId, 'must update the same profile record')
    assert.equal(update.body.profile.class12Status, 'PASSED')
    assert.equal(update.body.profile.class12PassingYear, 2026)
    assert.equal(update.body.profile.class12Marks, '91.8')
    assert.equal(update.body.profile.class12ResultDeclaredAt, '2026-05-20T00:00:00.000Z')
    assert.equal(update.body.profile.profileVersion, 2)
    assert.equal(section(update.body.evaluation, 'class12').state, 'COMPLETE')
    assert.ok(update.body.changedFields.includes('class12Status'))

    const history = await getProfile(jar)
    assert.equal(history.body.history[0].reason, 'CLASS12_RESULT_UPDATE')

    const repeat = await request(jar, '/api/apply/profile/class12-results', {
      method: 'POST',
      body: {
        class12PassingYear: '2026',
        class12RollNumber: 'C12-9999',
        class12MarksKind: 'PERCENTAGE',
        class12Marks: '91.8',
        class12Percentage: '91.8',
      },
    })
    assert.equal(repeat.status, 200, repeat.text)
    assert.deepEqual(repeat.body.changedFields, [])
    assert.equal(repeat.body.profile.profileVersion, 2, 'unchanged result must not bump the version')

    const correction = await request(jar, '/api/apply/profile/class12-results', {
      method: 'POST',
      body: {
        class12PassingYear: '2026',
        class12MarksKind: 'PERCENTAGE',
        class12Marks: '92.4',
        class12Percentage: '92.4',
      },
    })
    assert.equal(correction.status, 200, correction.text)
    assert.equal(correction.body.profile.profileVersion, 3)
    assert.equal(correction.body.profile.class12Marks, '92.4')

    const afterCorrection = await getProfile(jar)
    assert.equal(afterCorrection.body.history[0].reason, 'CLASS12_RESULT_CORRECTION')
    const versions = await prisma.studentProfileVersion.findMany({
      where: { profileId },
      orderBy: { createdAt: 'asc' },
    })
    assert.ok(versions.length >= 3)
    assert.equal(
      new Set(versions.map(row => row.profileId)).size,
      1,
      'no duplicate education profile may be created'
    )

    // Reverting to "appearing" clears live result values but keeps history.
    const revert = await saveProfile(jar, {
      ...STUDENT_A,
      fullName: 'Student C Passed',
      email: 'student.c@example.com',
    })
    assert.equal(revert.status, 200, revert.text)
    assert.equal(revert.body.profile.class12Status, 'APPEARING')
    assert.equal(revert.body.profile.class12PassingYear, null)
    assert.equal(revert.body.profile.class12Marks, null)
    assert.equal(revert.body.profile.class12Percentage, null)
    assert.equal(section(revert.body.evaluation, 'class12').state, 'AWAITING_RESULTS')
    assert.ok(versions.length < (await prisma.studentProfileVersion.count({ where: { profileId } })))
  })

  await t.test('Student D — dropper with unconfirmed category needs explicit confirmation', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_D)
    assert.equal(saved.status, 200, saved.text)
    assert.equal(saved.body.profile.category, 'OBC_NCL')
    assert.equal(saved.body.profile.categoryConfirmed, false)
    assert.equal(section(saved.body.evaluation, 'category').state, 'NEEDS_CONFIRMATION')

    const token = await pairAgent(jar)
    const unconfirmed = await agentValues(token, ['category', 'class12PassingYear'])
    assert.equal(unconfirmed.status, 200, unconfirmed.text)
    assert.equal(unconfirmed.body.values.category, undefined, 'category must not be filled before confirmation')
    assert.ok(unconfirmed.body.missing.includes('category'))
    assert.equal(unconfirmed.body.values.class12PassingYear, '2025')

    const confirmed = await saveProfile(jar, { ...STUDENT_D, categoryConfirmed: true })
    assert.equal(confirmed.status, 200, confirmed.text)
    assert.equal(section(confirmed.body.evaluation, 'category').state, 'COMPLETE')
    assert.ok(confirmed.body.profile.categoryConfirmedAt)

    const after = await agentValues(token, ['category'])
    assert.equal(after.body.values.category, 'OBC_NCL')
  })

  await t.test('Student E — category and PwD stay separate, certificates link and version', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_E)
    assert.equal(saved.status, 200, saved.text)
    assert.equal(section(saved.body.evaluation, 'category').state, 'NEEDS_CONFIRMATION')
    assert.ok(section(saved.body.evaluation, 'category').missingLabels.includes('PwBD / PwD confirmation'))

    const upload = await uploadDocument(jar, 'CATEGORY_CERTIFICATE', {
      certificateNumber: 'SC/2025/001',
      issuingAuthority: 'District Collector Office',
      issuingState: 'Bihar',
      issueDate: '2025-04-01',
      financialYear: '2025-26',
    })
    assert.equal(upload.status, 201, upload.text)
    const documentId = upload.body.document.id
    assert.equal(upload.body.document.certificate.certificateNumber, 'SC/2025/001')
    assert.equal(upload.body.document.isCurrent, true)

    const linked = await saveProfile(jar, {
      ...STUDENT_E,
      categoryCertificateType: 'SC',
      categoryCertificateDocumentId: documentId,
      pwdStatusConfirmed: true,
    })
    assert.equal(linked.status, 200, linked.text)
    assert.equal(linked.body.profile.categoryCertificateDocumentId, documentId)
    assert.equal(linked.body.profile.pwdStatusConfirmed, true)
    assert.equal(section(linked.body.evaluation, 'category').state, 'COMPLETE')

    const metadata = await request(jar, `/api/apply/documents/${documentId}`, {
      method: 'PATCH',
      body: {
        certificateNumber: 'SC/2025/001-CORRECTED',
        verificationStatus: 'STUDENT_CONFIRMED',
      },
    })
    assert.equal(metadata.status, 200, metadata.text)
    const mirrored = await getProfile(jar)
    assert.equal(mirrored.body.profile.categoryCertificateNumber, 'SC/2025/001-CORRECTED')
    assert.equal(mirrored.body.profile.categoryCertificateVerificationStatus, 'STUDENT_CONFIRMED')
    assert.ok(mirrored.body.profile.profileVersion > 1, 'certificate metadata change advances the vault')

    const replacement = await uploadDocument(jar, 'CATEGORY_CERTIFICATE', {
      certificateNumber: 'SC/2025/002',
      issuingAuthority: 'District Collector Office',
      issuingState: 'Bihar',
    })
    assert.equal(replacement.status, 201, replacement.text)
    assert.equal(replacement.body.document.versions, 2)
    assert.equal(replacement.body.document.supersedesId, documentId)

    const afterReplace = await getProfile(jar)
    assert.equal(
      afterReplace.body.profile.categoryCertificateDocumentId,
      replacement.body.document.id,
      'vault link must move to the current version'
    )

    const versions = await request(jar, `/api/apply/documents/${replacement.body.document.id}/versions`)
    assert.equal(versions.status, 200, versions.text)
    assert.equal(versions.body.documents.length, 2)
    assert.equal(versions.body.documents[0].isCurrent, true)
    assert.equal(versions.body.documents[1].id, documentId)
    assert.equal(versions.body.documents[1].isCurrent, false)

    const oldFile = await request(jar, `/api/apply/documents/${documentId}/file`)
    assert.equal(oldFile.status, 200, 'replaced file must remain downloadable by its owner')

    const blocked = await request(jar, `/api/apply/documents/${documentId}`, { method: 'DELETE' })
    assert.equal(blocked.status, 200, 'superseded, unreferenced versions may be removed on request')

    const linkedDelete = await request(
      jar,
      `/api/apply/documents/${replacement.body.document.id}`,
      { method: 'DELETE' }
    )
    assert.equal(linkedDelete.status, 409)
    assert.equal(linkedDelete.body.code, 'DOCUMENT_LINKED_TO_PROFILE')
  })

  await t.test('Student F — minimal General student with nothing conditional', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_F)
    assert.equal(saved.status, 200, saved.text)
    assert.equal(saved.body.evaluation.status, 'COMPLETE')
    assert.equal(section(saved.body.evaluation, 'category').state, 'COMPLETE')
    assert.equal(saved.body.profile.pwdStatus, false)
    assert.equal(saved.body.profile.pwdStatusConfirmed, false)
    assert.equal(saved.body.profile.class10Marks, '92.4')
  })

  await t.test('cross-workspace and unauthenticated access is rejected', async () => {
    const jarA = await freshWorkspace()
    const jarB = await freshWorkspace()
    await saveProfile(jarA, STUDENT_A)
    await saveProfile(jarB, STUDENT_B)

    const upload = await uploadDocument(jarA, 'PHOTO')
    assert.equal(upload.status, 201, upload.text)
    const docId = upload.body.document.id

    const app = await createApplication(jarA)
    assert.equal(app.status, 201, app.text)
    const appId = app.body.application.id

    assert.equal((await getProfile(jarB)).status, 200)
    assert.equal((await request(jarB, `/api/apply/documents/${docId}/file`)).status, 404)
    assert.equal((await request(jarB, `/api/apply/documents/${docId}/versions`)).status, 404)
    assert.equal((await request(jarB, `/api/apply/documents/${docId}`, { method: 'DELETE' })).status, 404)
    assert.equal((await request(jarB, `/api/apply/applications/${appId}`)).status, 404)
    assert.equal(
      (await request(jarB, `/api/apply/applications/${appId}`, { method: 'DELETE' })).status,
      404
    )

    const anonymous = createJar()
    assert.equal((await request(anonymous, '/api/apply/profile')).status, 401)
    assert.equal((await request(anonymous, '/api/apply/documents')).status, 401)
    assert.equal((await request(anonymous, `/api/apply/documents/${docId}/file`)).status, 401)
    assert.equal((await request(anonymous, '/api/apply/applications')).status, 401)

    const invalidCookie = createJar()
    invalidCookie.cookies.set('rankora_workspace', 'not-a-valid-token')
    assert.equal((await request(invalidCookie, '/api/apply/profile')).status, 401)
  })

  await t.test('snapshot isolation and explicit mapping review', async () => {
    const jar = await freshWorkspace()
    const saved = await saveProfile(jar, STUDENT_A)
    assert.equal(saved.status, 200, saved.text)

    const created = await createApplication(jar)
    assert.equal(created.status, 201, created.text)
    const applicationId = created.body.application.id
    assert.equal(created.body.application.profileVersion, 1)
    assert.equal(created.body.application.mappingReviewRequired, false)

    const preferences = await request(jar, `/api/apply/applications/${applicationId}`, {
      method: 'PATCH',
      body: { preferences: { paperPreference: 'Paper 1 (B.E./B.Tech)' } },
    })
    assert.equal(preferences.status, 200, preferences.text)
    assert.equal(
      preferences.body.application.preferences.paperPreference,
      'Paper 1 (B.E./B.Tech)'
    )

    // The exam-specific preference must never leak into the master vault.
    const vault = await getProfile(jar)
    assert.equal(vault.body.profile.paperPreference, undefined)

    const changed = await saveProfile(jar, { ...STUDENT_A, fullName: 'Student A Renamed' })
    assert.equal(changed.status, 200, changed.text)
    assert.equal(changed.body.profile.profileVersion, 2)

    const stale = await request(jar, `/api/apply/applications/${applicationId}`)
    assert.equal(stale.status, 200)
    assert.equal(stale.body.application.mappingReviewRequired, true)
    assert.ok(stale.body.application.mappingChangedFields.includes('fullName'))
    assert.equal(stale.body.application.profileVersion, 1, 'snapshot version must not move silently')
    assert.equal(
      stale.body.application.preferences.paperPreference,
      'Paper 1 (B.E./B.Tech)',
      'application-specific preferences survive a vault change'
    )

    const list = await request(jar, '/api/apply/applications')
    assert.equal(list.status, 200)
    assert.ok(
      list.body.reminders.some(reminder => reminder.kind === 'review'),
      'the Hub must surface a review reminder'
    )

    const approved = await request(jar, `/api/apply/applications/${applicationId}`, {
      method: 'PATCH',
      body: { reviewMapping: true },
    })
    assert.equal(approved.status, 200, approved.text)
    assert.equal(approved.body.application.mappingReviewRequired, false)
    assert.deepEqual(approved.body.application.mappingChangedFields, [])
    assert.equal(approved.body.application.profileVersion, 2)
    assert.ok(approved.body.application.mappingReviewedAt)
    assert.equal(approved.body.application.preferences.paperPreference, 'Paper 1 (B.E./B.Tech)')
  })

  await t.test('prepared snapshot blocks deletion of referenced documents', async () => {
    const jar = await freshWorkspace()
    await saveProfile(jar, STUDENT_A)
    const upload = await uploadDocument(jar, 'PHOTO')
    assert.equal(upload.status, 201, upload.text)
    const docId = upload.body.document.id

    const app = await createApplication(jar)
    assert.equal(app.status, 201, app.text)

    const blocked = await request(jar, `/api/apply/documents/${docId}`, { method: 'DELETE' })
    assert.equal(blocked.status, 409, blocked.text)
    assert.equal(blocked.body.code, 'DOCUMENT_REFERENCED_BY_APPLICATION')
  })

  await t.test('document changes flag prepared applications without touching preferences', async () => {
    const jar = await freshWorkspace()
    await saveProfile(jar, STUDENT_A)
    const app = await createApplication(jar)
    assert.equal(app.status, 201, app.text)
    const applicationId = app.body.application.id

    const upload = await uploadDocument(jar, 'PHOTO')
    assert.equal(upload.status, 201, upload.text)

    const flagged = await request(jar, `/api/apply/applications/${applicationId}`)
    assert.equal(flagged.status, 200)
    assert.equal(flagged.body.application.mappingReviewRequired, true)
    assert.ok(flagged.body.application.mappingChangedFields.includes('documents'))

    const approved = await request(jar, `/api/apply/applications/${applicationId}`, {
      method: 'PATCH',
      body: { reviewMapping: true },
    })
    assert.equal(approved.status, 200, approved.text)
    assert.equal(approved.body.application.mappingReviewRequired, false)

    // Replacing the file supersedes the old row: the snapshot document set
    // changes, so the application asks for review again.
    const replacement = await uploadDocument(jar, 'PHOTO')
    assert.equal(replacement.status, 201, replacement.text)
    assert.equal(replacement.body.document.supersedesId, upload.body.document.id)

    const reflagged = await request(jar, `/api/apply/applications/${applicationId}`)
    assert.equal(reflagged.body.application.mappingReviewRequired, true)
    assert.ok(reflagged.body.application.mappingChangedFields.includes('documents'))
  })

  await t.test('agent never fills pending results or unconfirmed PwD', async () => {
    const jar = await freshWorkspace()
    await saveProfile(jar, {
      ...STUDENT_B,
      pwdStatus: true,
      pwdStatusConfirmed: false,
    })
    const token = await pairAgent(jar)

    const pending = await agentValues(token, [
      'class12PassingYear',
      'class12Marks',
      'class12Percentage',
      'class12ExamYear',
      'class12Status',
      'pwdStatus',
      'nationality',
      'permanentCity',
      'permanentPinCode',
    ])
    assert.equal(pending.status, 200, pending.text)
    for (const field of ['class12PassingYear', 'class12Marks', 'class12Percentage', 'pwdStatus']) {
      assert.equal(pending.body.values[field], undefined, `${field} must stay empty`)
      assert.ok(pending.body.missing.includes(field), `${field} must be reported missing`)
    }
    assert.equal(pending.body.values.class12ExamYear, '2026')
    assert.equal(pending.body.values.class12Status, 'RESULT_AWAITED')
    assert.equal(pending.body.values.nationality, 'India')
    assert.equal(pending.body.values.permanentPinCode, '800001')

    const values = await agentValues(token, ['category', 'class12PassingYear'])
    assert.equal(values.body.values.category, 'GENERAL', 'confirmed General may be reused')
    assert.equal(values.body.values.class12PassingYear, undefined)
  })

  await t.test('signed-in workspace: claim, stale cookie and expired session', async () => {
    const anonymousJar = await freshWorkspace()
    await saveProfile(anonymousJar, STUDENT_A)
    const staleCookie = cookieHeader(anonymousJar)

    const email = `vault-auth-${Date.now()}@example.com`
    const password = 'TestPassw0rd!123'
    const signUp = await request(null, '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: BASE_URL },
      body: { email, password, name: 'Vault Auth Student' },
    })
    assert.equal(signUp.status, 200, signUp.text)

    const sessionJar = createJar()
    storeCookies(sessionJar, signUp.response)
    assert.ok(sessionJar.cookies.size > 0, 'sign-up must set a session cookie')

    // The session cookie plus the anonymous workspace cookie performs the claim.
    const claimingJar = createJar()
    for (const [name, value] of anonymousJar.cookies) claimingJar.cookies.set(name, value)
    for (const [name, value] of sessionJar.cookies) claimingJar.cookies.set(name, value)

    const claim = await request(claimingJar, '/api/apply/claim-workspace', { method: 'POST' })
    assert.equal(claim.status, 200, claim.text)
    assert.equal(claim.body.changed, true)

    const owned = await request(sessionJar, '/api/apply/profile')
    assert.equal(owned.status, 200)
    assert.equal(owned.body.profile.fullName, 'Student A Appearing')

    // The old browser cookie alone is no longer authorisation once claimed.
    const staleOnly = createJar()
    staleOnly.cookies.set('rankora_workspace', staleCookie.split('=')[1])
    assert.equal((await request(staleOnly, '/api/apply/profile')).status, 401)

    // Expire every session for this account: the cookie must stop working.
    const user = await prisma.user.findUnique({ where: { email } })
    assert.ok(user)
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const expired = await request(sessionJar, '/api/apply/profile')
    assert.equal(expired.status, 401, 'expired sessions must not authorise vault access')
    const expiredAgent = await request(sessionJar, '/api/agent/pairing-ticket', { method: 'POST' })
    assert.equal(expiredAgent.status, 401)
  })

  await t.test('deterministic field mapping understands the new vault fields', async () => {
    const jar = await freshWorkspace()
    await saveProfile(jar, STUDENT_A)
    const token = await pairAgent(jar)

    const descriptor = (index, label, kind = 'text', group = '') => ({
      index,
      label,
      kind,
      group,
      inputName: '',
      inputId: '',
      required: false,
      options: [],
    })

    const mapped = await request(null, '/api/agent/map', {
      method: 'POST',
      headers: { 'x-rankora-agent-session': token },
      body: {
        fields: [
          descriptor(0, "Father's Name"),
          descriptor(1, "Mother's Name"),
          descriptor(2, 'Permanent Address'),
          descriptor(3, 'Current Address'),
          descriptor(4, 'Class 12 Year of Appearing'),
          descriptor(5, 'Class 12 Year of Passing'),
          descriptor(6, 'PwBD', 'checkbox'),
          descriptor(7, 'Category', 'select'),
          descriptor(8, 'Address Line 2'),
          descriptor(9, 'Communication Address'),
        ],
      },
    })
    assert.equal(mapped.status, 200, mapped.text)

    const byLabel = new Map(mapped.body.plan.items.map(item => [item.label, item]))
    assert.equal(byLabel.get("Father's Name").canonical, 'fatherName')
    assert.equal(byLabel.get("Mother's Name").canonical, 'motherName')
    assert.equal(byLabel.get('Permanent Address').canonical, 'permanentAddressLine')
    assert.equal(byLabel.get('Current Address').canonical, 'currentAddressLine')
    assert.equal(byLabel.get('Class 12 Year of Appearing').canonical, 'class12ExamYear')
    assert.equal(byLabel.get('Class 12 Year of Passing').canonical, 'class12PassingYear')
    assert.equal(byLabel.get('PwBD').canonical, 'pwdStatus')
    assert.equal(byLabel.get('Category').canonical, 'category')

    const line2 = byLabel.get('Address Line 2')
    assert.equal(line2.canonical, null, 'address line 2 must never be reconstructed')
    assert.equal(line2.needsReview, false)

    const communication = byLabel.get('Communication Address')
    assert.equal(communication.canonical, 'currentAddressLine')
    assert.equal(communication.needsReview, true, 'ambiguous address wording needs review')
  })

  await t.test('disposable database contains only synthetic test data', async () => {
    const databaseName = await prisma.$queryRaw`SELECT current_database() AS name`
    assert.equal(databaseName[0].name, 'formlee_vault_test', 'tests must never run on the real database')
    const profiles = await prisma.studentProfile.count()
    assert.ok(profiles > 0)
  })
})
