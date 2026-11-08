import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Application Hub API integration tests.
 *
 * Run against an ISOLATED server/database, e.g.:
 *
 *   $env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/formlee_hub_test?schema=public'
 *   $env:FORMLEE_STORAGE_DIR='C:\Temp\formlee-hub-test-storage'
 *   npx next dev -p 3100
 *   $env:APPLICATION_HUB_TEST_BASE_URL='http://localhost:3100'
 *   node --test scripts/tests/application-hub-api.test.mjs
 *
 * The tests create fresh anonymous workspaces and clean up every application
 * and document they create. They never use the development workspace.
 */

const BASE_URL = (
  process.env.APPLICATION_HUB_TEST_BASE_URL ?? 'http://localhost:3100'
).replace(/\/$/, '')

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xuoAAAAASUVORK5CYII=',
  'base64'
)

const COMPLETE_PROFILE = {
  fullName: 'Hub Test Student',
  gender: 'FEMALE',
  dateOfBirth: '2008-05-14',
  email: 'hub-test@example.com',
  mobileNumber: '9876543210',
  nationality: 'India',
  fatherName: 'Hub Test Father',
  // Deliberately the LEGACY single-address fields: older clients must keep
  // working through the permanent-address fallback.
  addressLine: '12 Test Lane',
  city: 'Patna',
  state: 'Bihar',
  pinCode: '800001',
  currentSameAsPermanent: true,
  class10Board: 'CBSE',
  class10SchoolName: 'Hub Test School',
  class10PassingYear: '2024',
  class10RollNumber: 'C10-1234',
  class10MarksKind: 'PERCENTAGE',
  class10Marks: '92.4',
  class10Subjects: [{ name: 'Mathematics', kind: 'PERCENTAGE', value: '95' }],
  class12Status: 'PASSED',
  class12Board: 'CBSE',
  class12SchoolName: 'Hub Test School',
  class12PassingYear: '2026',
  class12RollNumber: 'C12-5678',
  class12MarksKind: 'PERCENTAGE',
  class12Marks: '91.8',
  class12Subjects: [
    { name: 'Physics', kind: 'PERCENTAGE', value: '90' },
    { name: 'Chemistry', kind: 'PERCENTAGE', value: '89' },
    { name: 'Mathematics', kind: 'PERCENTAGE', value: '95' },
  ],
  category: 'GENERAL',
  categoryConfirmed: true,
  pwdStatus: false,
  homeState: 'Bihar',
  preferredExamCities: ['Patna', 'Delhi'],
}

function createJar() {
  return { cookies: new Map() }
}

function storeCookies(jar, response) {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
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
  if (jar && jar.cookies.size > 0) {
    headers.set(
      'cookie',
      Array.from(jar.cookies, ([name, value]) => `${name}=${value}`).join('; ')
    )
  }

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

async function createApplication(jar, examId, sessionId, bucket) {
  const result = await request(jar, '/api/apply/applications', {
    method: 'POST',
    body: { examId, sessionId },
  })
  assert.equal(result.status, 201, `create ${examId}/${sessionId} failed: ${result.text}`)
  bucket.push(result.body.application.id)
  return result.body.application
}

test('Application Hub API', { timeout: 180_000 }, async t => {
  try {
    await request(null, '/api/apply/workspace', { method: 'POST' })
  } catch {
    assert.fail(
      `Application Hub test server is not reachable at ${BASE_URL}. ` +
        'Start an isolated server first (see the header of this test file).'
    )
  }

  const jarA = await freshWorkspace()
  const jarB = await freshWorkspace()
  const createdA = []
  const createdB = []
  const documentsA = []

  let app1
  let app2

  try {
    await t.test('requires a workspace for every hub read', async () => {
      const result = await request(null, '/api/apply/applications')
      assert.equal(result.status, 401)
    })

    await t.test('creates a tracked JEE Main 2027 Session 1 application with the verified deadline', async () => {
      app1 = await createApplication(
        jarA,
        'JEE_MAIN',
        'jee-main-2027-session-1',
        createdA
      )

      assert.equal(app1.status, 'NOT_STARTED')
      assert.equal(app1.applicationYear, 2027)
      assert.match(app1.sessionLabel, /Session 1/)
      assert.equal(app1.supportStatus, 'BETA')

      assert.equal(app1.deadline.state, 'ANNOUNCED')
      assert.equal(app1.deadline.date, '2026-11-22')
      assert.equal(app1.deadline.needsUpdate, false)
      assert.equal(app1.deadline.catalogUpdated, false)
      assert.equal(app1.deadline.verifiedAt, '2026-10-31')
      assert.match(app1.deadline.source.url, /^https:\/\//)
      assert.match(app1.deadline.note, /correction window/i)

      assert.equal(app1.submission.studentConfirmedAt, null)
      assert.equal(app1.submission.portalVerification, 'NONE')

      assert.equal(app1.evaluation.officialChecklistAvailable, true)
      assert.equal(app1.evaluation.progressPercent, 0)
      assert.ok(app1.evaluation.missingProfileLabels.length > 0)
      assert.ok(app1.evaluation.missingDocumentLabels.includes('Photograph'))
      assert.equal(app1.evaluation.nextAction.kind, 'profile')
      assert.ok(app1.evaluation.applicableCount > 0)
    })

    await t.test('rejects a duplicate for the same workspace/exam/session/year', async () => {
      const duplicate = await request(jarA, '/api/apply/applications', {
        method: 'POST',
        body: { examId: 'JEE_MAIN', sessionId: 'jee-main-2027-session-1' },
      })
      assert.equal(duplicate.status, 409)
      assert.equal(duplicate.body.code, 'DUPLICATE_APPLICATION')
      assert.equal(duplicate.body.existingId, app1.id)

      // A different session of the same exam is a different application.
      app2 = await createApplication(
        jarA,
        'JEE_MAIN',
        'jee-main-2027-session-2',
        createdA
      )
      assert.equal(app2.deadline.state, 'NOT_ANNOUNCED')
      assert.equal(app2.deadline.date, null)
      assert.equal(app2.deadline.needsUpdate, true)
    })

    await t.test('lists only this workspace’s applications with derived reminders', async () => {
      const result = await request(jarA, '/api/apply/applications')
      assert.equal(result.status, 200)
      assert.equal(result.body.applications.length, 2)
      assert.deepEqual(
        result.body.applications.map(application => application.id).sort(),
        [app1.id, app2.id].sort()
      )
      assert.ok(Array.isArray(result.body.reminders))
      assert.ok(result.body.reminders.some(reminder => reminder.kind === 'profile'))
      assert.ok(result.body.reminders.some(reminder => reminder.kind === 'document'))
    })

    await t.test('updates status, manual checklist, preferences and notes without claiming submission', async () => {
      const update = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: {
          status: 'FILLING_IN_PROGRESS',
          checklist: { 'jee-manual-bulletin': true },
          preferences: {
            paperPreference: 'Paper 1 (B.E./B.Tech)',
            examCityPreference: 'Patna, Delhi',
          },
          notes: 'Re-check the official bulletin before the final review.',
        },
      })
      assert.equal(update.status, 200, update.text)
      const updated = update.body.application
      assert.equal(updated.status, 'FILLING_IN_PROGRESS')
      assert.equal(updated.checklist['jee-manual-bulletin'].done, true)
      assert.equal(updated.preferences.paperPreference, 'Paper 1 (B.E./B.Tech)')
      assert.equal(updated.notes, 'Re-check the official bulletin before the final review.')
      // The manual bulletin confirmation and the now-filled exam preferences are
      // the only completed items; no profile or documents have been supplied yet.
      assert.equal(updated.evaluation.completeCount, 2)
      assert.equal(
        updated.evaluation.items.find(item => item.id === 'jee-profile-preferences').met,
        true
      )
      assert.equal(updated.evaluation.progressPercent, Math.round((2 / updated.evaluation.applicableCount) * 100))
      assert.equal(updated.submission.studentConfirmedAt, null)
      assert.equal(updated.submission.portalVerification, 'NONE')

      const unknownChecklist = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { checklist: { 'not-a-manual-item': true } },
      })
      assert.equal(unknownChecklist.status, 400)

      const unknownPreference = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { preferences: { notAField: 'value' } },
      })
      assert.equal(unknownPreference.status, 400)

      const genericSubmission = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { status: 'SUBMITTED_STUDENT_CONFIRMED' },
      })
      assert.equal(genericSubmission.status, 400)
      assert.equal(genericSubmission.body.code, 'USE_SUBMISSION_ENDPOINT')
    })

    await t.test('refreshes the deadline snapshot from the verified catalog', async () => {
      const refresh = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { refreshDeadline: true },
      })
      assert.equal(refresh.status, 200, refresh.text)
      assert.equal(refresh.body.application.deadline.date, '2026-11-22')
      assert.equal(refresh.body.application.deadline.state, 'ANNOUNCED')
      assert.equal(refresh.body.application.deadline.catalogUpdated, false)
      assert.equal(refresh.body.application.deadline.needsUpdate, false)
      assert.equal(refresh.body.application.deadline.verifiedAt, '2026-10-31')
    })

    await t.test('derives progress from the saved profile and uploaded documents', async () => {
      const saveProfile = await request(jarA, '/api/apply/profile', {
        method: 'PUT',
        body: COMPLETE_PROFILE,
      })
      assert.equal(saveProfile.status, 200, saveProfile.text)
      assert.deepEqual(saveProfile.body.invalidFields, [])
      assert.equal(saveProfile.body.evaluation.status, 'COMPLETE')

      const afterProfile = await request(jarA, `/api/apply/applications/${app1.id}`)
      assert.equal(afterProfile.status, 200)
      assert.deepEqual(afterProfile.body.application.evaluation.missingProfileLabels, [])
      const countAfterProfile = afterProfile.body.application.evaluation.completeCount
      assert.ok(countAfterProfile >= 5)

      const form = new FormData()
      form.set('documentType', 'PHOTO')
      form.set('file', new File([PNG_BYTES], 'photo.png', { type: 'image/png' }))
      const upload = await request(jarA, '/api/apply/documents', {
        method: 'POST',
        body: form,
      })
      assert.equal(upload.status, 201, upload.text)
      documentsA.push(upload.body.document.id)

      const afterDocument = await request(jarA, `/api/apply/applications/${app1.id}`)
      assert.equal(afterDocument.status, 200)
      const evaluation = afterDocument.body.application.evaluation
      assert.equal(
        evaluation.missingDocumentLabels.includes('Photograph'),
        false,
        'uploaded photograph must satisfy the photograph requirement'
      )
      assert.ok(evaluation.completeCount > countAfterProfile)
      assert.ok(evaluation.missingCount > 0, 'other requirements are still genuinely missing')
    })

    await t.test('isolates applications by workspace for reads and writes', async () => {
      const read = await request(jarB, `/api/apply/applications/${app1.id}`)
      assert.equal(read.status, 404)

      const write = await request(jarB, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { notes: 'cross-workspace write' },
      })
      assert.equal(write.status, 404)

      const remove = await request(jarB, `/api/apply/applications/${app1.id}`, {
        method: 'DELETE',
      })
      assert.equal(remove.status, 404)

      const listB = await request(jarB, '/api/apply/applications')
      assert.equal(listB.status, 200)
      assert.equal(listB.body.applications.length, 0)

      // The unique key is scoped to the workspace, so another workspace can
      // track the same exam session independently.
      const appB = await createApplication(
        jarB,
        'JEE_MAIN',
        'jee-main-2027-session-1',
        createdB
      )
      assert.notEqual(appB.id, app1.id)

      const deleteOwn = await request(jarB, `/api/apply/applications/${appB.id}`, {
        method: 'DELETE',
      })
      assert.equal(deleteOwn.status, 200)
      const gone = await request(jarB, `/api/apply/applications/${appB.id}`)
      assert.equal(gone.status, 404)

      const listBAfter = await request(jarB, '/api/apply/applications')
      assert.equal(listBAfter.body.applications.length, 0)
    })

    await t.test('handles exams with unpublished dates and requirements without inventing data', async () => {
      const bitsat = await createApplication(jarA, 'BITSAT', 'bitsat-2027', createdA)
      assert.equal(bitsat.deadline.state, 'NOT_ANNOUNCED')
      assert.equal(bitsat.deadline.date, null)
      assert.equal(bitsat.evaluation.officialChecklistAvailable, false)
      assert.equal(bitsat.evaluation.progressPercent, null)
      assert.match(bitsat.evaluation.requirementsNote, /has not been published/i)
      assert.equal(bitsat.evaluation.items.length, 0)

      const cuet = await createApplication(jarA, 'CUET_UG', 'cuet-ug-2027', createdA)
      assert.equal(cuet.deadline.state, 'NOT_ANNOUNCED')
      assert.equal(cuet.deadline.date, null)
      assert.equal(cuet.evaluation.progressPercent, null)

      const viteee = await createApplication(jarA, 'VITEEE', 'viteee-2027', createdA)
      assert.equal(viteee.deadline.state, 'TENTATIVE')
      assert.equal(viteee.deadline.date, '2027-03-31')
      assert.equal(viteee.evaluation.officialChecklistAvailable, true)
      assert.ok(viteee.evaluation.items.some(item => item.id === 'viteee-doc-address'))
      assert.equal(viteee.deadline.catalogUpdated, false)
    })

    await t.test('persists values across independent requests', async () => {
      const detail = await request(jarA, `/api/apply/applications/${app1.id}`)
      assert.equal(detail.status, 200)
      const application = detail.body.application
      assert.equal(application.status, 'FILLING_IN_PROGRESS')
      assert.equal(application.notes, 'Re-check the official bulletin before the final review.')
      assert.equal(application.preferences.paperPreference, 'Paper 1 (B.E./B.Tech)')
      assert.equal(application.checklist['jee-manual-bulletin'].done, true)
      assert.equal(application.submission.studentConfirmedAt, null)

      const list = await request(jarA, '/api/apply/applications')
      assert.equal(list.body.applications.length, 5)
      const persisted = list.body.applications.find(item => item.id === app1.id)
      assert.equal(persisted.notes, application.notes)
    })

    await t.test('distinguishes preparation, student-confirmed submission and portal acknowledgement', async () => {
      const review = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { status: 'FILLED_AWAITING_STUDENT_REVIEW' },
      })
      assert.equal(review.status, 200, review.text)
      assert.equal(review.body.application.status, 'FILLED_AWAITING_STUDENT_REVIEW')
      assert.equal(review.body.application.submission.studentConfirmedAt, null)
      assert.equal(review.body.application.submission.portalVerification, 'NONE')

      const unconfirmed = await request(
        jarA,
        `/api/apply/applications/${app1.id}/submission`,
        { method: 'POST', body: { action: 'CONFIRM_STUDENT_SUBMITTED' } }
      )
      assert.equal(unconfirmed.status, 400)

      const confirmed = await request(
        jarA,
        `/api/apply/applications/${app1.id}/submission`,
        {
          method: 'POST',
          body: { action: 'CONFIRM_STUDENT_SUBMITTED', confirmed: true },
        }
      )
      assert.equal(confirmed.status, 200, confirmed.text)
      assert.equal(confirmed.body.application.status, 'SUBMITTED_STUDENT_CONFIRMED')
      assert.ok(confirmed.body.application.submission.studentConfirmedAt)
      assert.equal(confirmed.body.application.submission.portalReference, null)
      assert.equal(confirmed.body.application.submission.portalVerification, 'NONE')

      const prohibitedDowngrade = await request(jarA, `/api/apply/applications/${app1.id}`, {
        method: 'PATCH',
        body: { status: 'PREPARING' },
      })
      assert.equal(prohibitedDowngrade.status, 409)
      assert.equal(prohibitedDowngrade.body.code, 'CLEAR_SUBMISSION_FIRST')

      const missingReference = await request(
        jarA,
        `/api/apply/applications/${app1.id}/submission`,
        {
          method: 'POST',
          body: { action: 'RECORD_PORTAL_CONFIRMATION', confirmed: true },
        }
      )
      assert.equal(missingReference.status, 400)

      const recorded = await request(
        jarA,
        `/api/apply/applications/${app1.id}/submission`,
        {
          method: 'POST',
          body: {
            action: 'RECORD_PORTAL_CONFIRMATION',
            confirmed: true,
            portalReference: 'JEE2027-TEST-0001',
          },
        }
      )
      assert.equal(recorded.status, 200, recorded.text)
      assert.equal(recorded.body.application.status, 'PORTAL_CONFIRMATION_RECORDED')
      assert.equal(
        recorded.body.application.submission.portalReference,
        'JEE2027-TEST-0001'
      )
      assert.equal(
        recorded.body.application.submission.portalVerification,
        'STUDENT_RECORDED'
      )
      assert.ok(recorded.body.application.submission.studentConfirmedAt)

      const cleared = await request(
        jarA,
        `/api/apply/applications/${app1.id}/submission`,
        { method: 'POST', body: { action: 'CLEAR', confirmed: true } }
      )
      assert.equal(cleared.status, 200, cleared.text)
      assert.equal(cleared.body.application.status, 'FILLED_AWAITING_STUDENT_REVIEW')
      assert.equal(cleared.body.application.submission.studentConfirmedAt, null)
      assert.equal(cleared.body.application.submission.portalReferenceRecordedAt, null)
      assert.equal(cleared.body.application.submission.portalReference, null)
      assert.equal(cleared.body.application.submission.portalVerification, 'NONE')
    })

    await t.test('deleting one application leaves other records untouched', async () => {
      const deleteResult = await request(jarA, `/api/apply/applications/${app2.id}`, {
        method: 'DELETE',
      })
      assert.equal(deleteResult.status, 200)

      const deleted = await request(jarA, `/api/apply/applications/${app2.id}`)
      assert.equal(deleted.status, 404)

      const survivor = await request(jarA, `/api/apply/applications/${app1.id}`)
      assert.equal(survivor.status, 200)
      assert.equal(survivor.body.application.id, app1.id)
    })
  } finally {
    for (const id of createdA) {
      await request(jarA, `/api/apply/applications/${id}`, { method: 'DELETE' }).catch(
        () => {}
      )
    }
    for (const id of createdB) {
      await request(jarB, `/api/apply/applications/${id}`, { method: 'DELETE' }).catch(
        () => {}
      )
    }
    for (const id of documentsA) {
      await request(jarA, `/api/apply/documents/${id}`, { method: 'DELETE' }).catch(
        () => {}
      )
    }
  }
})
