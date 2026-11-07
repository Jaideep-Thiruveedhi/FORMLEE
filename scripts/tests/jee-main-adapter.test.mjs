import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  JEE_MAIN_ADAPTER,
  JEE_MAIN_DOCUMENT_SPECS,
  JEE_MAIN_FILLABLE_CANONICALS,
  JEE_MAIN_PORTAL_PATH_PREFIX,
  JEE_MAIN_SOURCES,
  classifyAgentPage,
  isSanitizedPageUrl,
  isSupportedJeePageKind,
  jeePageNotice,
  jeeUploadGuidance,
  mapJeeMainField,
  sanitizePageUrl,
} from '../../src/lib/agent/jee-main.ts'
import { derivedDobParts, valueFromProfileRow } from '../../src/lib/agent/value-source.ts'
import AgentCore from '../../extensions/rankora-apply-agent/shared/agent-core.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function descriptor(label, kind = 'text', extra = {}) {
  return { label, kind, group: '', inputName: '', inputId: '', options: [], ...extra }
}

function option(text, value = '') {
  return { text, value }
}

/* --------------------------------------------------------------------------- */
/* Official origin recognition + lookalike rejection                           */
/* --------------------------------------------------------------------------- */

test('official JEE Main application origin + path is recognised and the one-time query is stripped', () => {
  const result = classifyAgentPage(
    'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx?enc=one-time-token#fragment'
  )
  assert.equal(result.adapter, JEE_MAIN_ADAPTER)
  assert.equal(result.official, true)
  assert.equal(result.fixture, false)
  assert.equal(result.reason, 'OFFICIAL_JEE_MAIN_2027')
  assert.equal(result.sanitizedUrl, 'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx')
  assert.ok(!result.sanitizedUrl.includes('enc='))
  assert.equal(
    sanitizePageUrl('https://examinationservices.nic.in/JeeMaink2027/a?b=1'),
    'https://examinationservices.nic.in/JeeMaink2027/a'
  )
})

test('official origin requires https, the exact host, the default port and the exact path prefix', () => {
  const rejected = [
    'http://examinationservices.nic.in/JeeMaink2027/root/Home.aspx',
    'https://examinationservices.nic.in:444/JeeMaink2027/root/Home.aspx',
    'https://examinationservices.nic.in/JeeMaink2027evil/root/Home.aspx',
    'https://examinationservices.nic.in/other/Home.aspx',
    'https://examinationservices.nic.in/',
    'https://examinationservices.nic.in.evil.example/JeeMaink2027/root/Home.aspx',
    'https://examinationservices.nic.in@evil.example/JeeMaink2027/root/Home.aspx',
    'https://evil-examinationservices.nic.in/JeeMaink2027/root/Home.aspx',
    'https://jeemain.nta.nic.in/',
    'https://nta.ac.in/JeeMaink2027/root/Home.aspx',
  ]
  for (const url of rejected) {
    const result = classifyAgentPage(url)
    assert.equal(result.adapter, 'none', url)
    assert.equal(result.official, false, url)
  }
})

test('only the exact local synthetic fixture and generic demo are accepted on port 3000', () => {
  const jeeFixture = classifyAgentPage('http://localhost:3000/apply/agent/jee-main-2027-demo')
  assert.equal(jeeFixture.adapter, JEE_MAIN_ADAPTER)
  assert.equal(jeeFixture.fixture, true)
  assert.equal(jeeFixture.official, false)

  const qualification = classifyAgentPage('http://127.0.0.1:3000/apply/agent/jee-main-2027-demo/qualification')
  assert.equal(qualification.adapter, JEE_MAIN_ADAPTER)
  assert.equal(qualification.fixture, true)

  const generic = classifyAgentPage('http://localhost:3000/apply/agent/demo-form')
  assert.equal(generic.adapter, 'generic')
  assert.equal(generic.fixture, true)

  assert.equal(classifyAgentPage('http://localhost:3001/apply/agent/jee-main-2027-demo').adapter, 'none')
  assert.equal(classifyAgentPage('https://localhost:3000/apply/agent/jee-main-2027-demo').adapter, 'none')
  assert.equal(classifyAgentPage('http://localhost:3000/apply/agent/jee-main-2027-demo-evil').adapter, 'none')
})

test('page URLs containing a query or fragment are not accepted as pre-sanitised context', () => {
  assert.equal(isSanitizedPageUrl('https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx'), true)
  assert.equal(isSanitizedPageUrl('https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx?enc=x'), false)
  assert.equal(isSanitizedPageUrl('https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx#x'), false)
  assert.equal(isSanitizedPageUrl('not a url'), false)
  assert.equal(sanitizePageUrl('javascript:alert(1)'), null)
  assert.equal(sanitizePageUrl('https://user:pass@example.com/x'), null)
})

test('only Personal Details and Qualification Details are fillable JEE page kinds', () => {
  assert.equal(isSupportedJeePageKind('personal'), true)
  assert.equal(isSupportedJeePageKind('qualification'), true)
  for (const kind of ['exam', 'documents', 'declaration', 'login', 'unknown', 'generic']) {
    assert.equal(isSupportedJeePageKind(kind), false, kind)
  }
})

test('page notices state the manual boundaries without claiming portal verification', () => {
  assert.match(jeePageNotice('login'), /log in yourself/i)
  assert.match(jeePageNotice('documents'), /never automated/i)
  assert.match(jeePageNotice('documents'), /10–200 kB/)
  assert.match(jeePageNotice('documents'), /10–100 kB/)
  assert.match(jeePageNotice('documents'), /50–300 kB/)
  assert.match(jeePageNotice('declaration'), /never ticks declarations or submits/i)
  assert.match(jeePageNotice('unknown'), /not one of the documented autofill sections/i)
})

/* --------------------------------------------------------------------------- */
/* Strict personal-details mapping                                             */
/* --------------------------------------------------------------------------- */

test('verified personal labels map to the narrow canonical allowlist', () => {
  assert.deepEqual(
    mapJeeMainField(descriptor("Candidate's Name"), 'personal').canonical,
    'fullName'
  )
  assert.equal(mapJeeMainField(descriptor('Email Address', 'email'), 'personal').canonical, 'email')
  assert.equal(mapJeeMainField(descriptor('Mobile Number', 'tel'), 'personal').canonical, 'mobileNumber')
  assert.equal(
    mapJeeMainField(
      descriptor('Gender', 'select', { options: [option('Male', 'M'), option('Female', 'F')] }),
      'personal'
    ).canonical,
    'gender'
  )
  assert.equal(
    mapJeeMainField(
      descriptor('Gender', 'radio', { options: [option('Male', 'M'), option('Female', 'F')] }),
      'personal'
    ).canonical,
    'gender'
  )
  assert.equal(
    mapJeeMainField(
      descriptor('Category', 'select', { options: [option('General', 'GENERAL')] }),
      'personal'
    ).canonical,
    'category'
  )
})

test('date-of-birth selects are mapped only from a verified date-of-birth context', () => {
  const group = 'Candidate Date of Birth'
  assert.equal(
    mapJeeMainField(descriptor('Day', 'select', { group, options: Array.from({ length: 31 }, (_, i) => option(String(i + 1))) }), 'personal')
      .canonical,
    'dateOfBirthDay'
  )
  assert.equal(
    mapJeeMainField(
      descriptor('Month', 'select', { group, options: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => option(m)) }),
      'personal'
    ).canonical,
    'dateOfBirthMonth'
  )
  assert.equal(
    mapJeeMainField(descriptor('Year', 'select', { group, options: Array.from({ length: 20 }, (_, i) => option(String(2005 + i))) }), 'personal')
      .canonical,
    'dateOfBirthYear'
  )
  assert.equal(
    mapJeeMainField(descriptor('Candidate Date of Birth', 'date'), 'personal').canonical,
    'dateOfBirth'
  )
})

test('unidentifiable date-of-birth controls stay manual instead of being guessed', () => {
  const result = mapJeeMainField(
    descriptor('Select', 'select', { group: 'Candidate Date of Birth', options: [option('A'), option('B'), option('C')] }),
    'personal'
  )
  assert.equal(result.status, 'manual')
  assert.equal(result.canonical, null)
})

test('confirmation, parent, nationality, eligibility-state and address fields stay manual', () => {
  const labels = [
    'Confirm Category',
    'Confirm Email Address',
    'Confirm Mobile Number',
    'Alternate Contact No. (Optional)',
    'Nationality',
    'Father/Guardian Name',
    'Mother/Guardian Name',
    'State/UT from where 12th/Equivalent Passed/Appearing',
    'Premises No.',
    'Sub-locality',
    'Locality',
    'Country',
    'State',
    'District',
    'Pin code',
  ]
  for (const label of labels) {
    const result = mapJeeMainField(
      descriptor(label, label.includes('Confirm') || label === 'Nationality' || label.includes('State/UT') ? 'select' : 'text'),
      'personal'
    )
    assert.equal(result.status, 'manual', label)
    assert.equal(result.canonical, null, label)
  }

  const eligibility = mapJeeMainField(
    descriptor('State/UT from where 12th/Equivalent Passed/Appearing', 'select'),
    'personal'
  )
  assert.match(eligibility.reason, /State of Eligibility/i)
  assert.match(eligibility.reason, /not your home state/i)
})

test('control compatibility is enforced instead of writing a value into the wrong widget', () => {
  assert.equal(mapJeeMainField(descriptor('Gender'), 'personal').status, 'manual')
  assert.equal(
    mapJeeMainField(descriptor('Email Address', 'select', { options: [option('a@example.com')] }), 'personal').status,
    'manual'
  )
  assert.equal(
    mapJeeMainField(descriptor("Candidate's Name", 'radio', { options: [option('A')] }), 'personal').status,
    'manual'
  )
})

test('password, identity documents, payments, declarations and uploads are refused as unsafe', () => {
  const cases = [
    descriptor('Password', 'text', { inputName: 'password' }),
    descriptor('CAPTCHA', 'text'),
    descriptor('Aadhaar Number', 'text'),
    descriptor('Card Number', 'text'),
    descriptor('Upload Photograph', 'file'),
    descriptor('Signature', 'file'),
    descriptor('Declaration', 'checkbox'),
    descriptor('I agree to the undertaking', 'checkbox'),
  ]
  for (const item of cases) {
    const result = mapJeeMainField(item, 'personal')
    assert.equal(result.status, 'unsafe', item.label)
    assert.equal(result.canonical, null, item.label)
  }
})

/* --------------------------------------------------------------------------- */
/* Strict qualification-details mapping                                       */
/* --------------------------------------------------------------------------- */

test('Class 10 and Class 12 board/passing-year/roll labels map from accessible group context', () => {
  assert.deepEqual(
    mapJeeMainField(
      descriptor('School Board', 'select', { group: 'Class 10 or Equivalent', options: [option('CBSE')] }),
      'qualification'
    ),
    {
      status: 'mapped',
      canonical: 'class10Board',
      ambiguous: [],
      needsReview: false,
      reason: 'Documented Class 10 School Board label matched your saved board.',
    }
  )
  assert.equal(
    mapJeeMainField(
      descriptor('School Board', 'select', { group: 'Class 12 or Equivalent', options: [option('CBSE')] }),
      'qualification'
    ).canonical,
    'class12Board'
  )
  assert.equal(
    mapJeeMainField(
      descriptor('Year of Passing/Appearing', 'select', { group: 'Class 10 or Equivalent', options: [option('2023')] }),
      'qualification'
    ).canonical,
    'class10PassingYear'
  )
  assert.equal(
    mapJeeMainField(
      descriptor('Year of Passing/Appearing', 'select', { group: 'Class 12 or Equivalent', options: [option('2025')] }),
      'qualification'
    ).canonical,
    'class12PassingYear'
  )
  const roll = mapJeeMainField(
    descriptor('Registration No./Enrollment No./Roll No.', 'text', { group: 'Class 12 or Equivalent' }),
    'qualification'
  )
  assert.equal(roll.status, 'mapped')
  assert.equal(roll.canonical, 'class12RollNumber')
  assert.equal(roll.needsReview, true)
})

test('unclassified or shared class context is ambiguous, never silently assigned', () => {
  const ungrouped = mapJeeMainField(descriptor('School Board', 'select'), 'qualification')
  assert.equal(ungrouped.status, 'ambiguous')
  assert.deepEqual(ungrouped.ambiguous, ['class10Board', 'class12Board'])

  const both = mapJeeMainField(
    descriptor('Year of Passing/Appearing', 'select', { group: 'Class 10 and Class 12 details' }),
    'qualification'
  )
  assert.equal(both.status, 'ambiguous')
  assert.deepEqual(both.ambiguous, ['class10PassingYear', 'class12PassingYear'])
})

test('other qualification fields and non-documented pages stay manual', () => {
  for (const label of [
    'Result Mode',
    'School/College Name & Address',
    'School/College Address PIN code',
    'Qualifying Examination',
    'Qualifying Examination State',
    'Qualifying Examination District',
    'Type of School/College',
    'Place of School',
  ]) {
    const result = mapJeeMainField(descriptor(label, 'select', { group: 'Class 10 or Equivalent' }), 'qualification')
    assert.equal(result.status, 'manual', label)
  }

  for (const section of ['exam', 'documents', 'declaration', 'login', 'unknown', 'generic']) {
    assert.equal(mapJeeMainField(descriptor("Candidate's Name"), section).status, 'manual', section)
  }
})

/* --------------------------------------------------------------------------- */
/* Value provenance — never invent profile data                               */
/* --------------------------------------------------------------------------- */

test('date-of-birth parts are derived only from a valid ISO saved date', () => {
  assert.deepEqual(derivedDobParts('2007-08-15'), { day: '15', month: 'August', year: '2007' })
  assert.equal(derivedDobParts(null), null)
  assert.equal(derivedDobParts('15-08-2007'), null)
  assert.equal(derivedDobParts('2007-13-15'), null)
})

test('profile values are returned only when the student has saved them', () => {
  const profile = {
    fullName: '  Test Candidate  ',
    dateOfBirth: '2007-08-15',
    class10PassingYear: 2023,
    pwdStatus: false,
    preferredExamCities: ['Delhi', ' Noida ', ''],
  }
  assert.equal(valueFromProfileRow(profile, 'fullName'), 'Test Candidate')
  assert.equal(valueFromProfileRow(profile, 'dateOfBirthDay'), '15')
  assert.equal(valueFromProfileRow(profile, 'dateOfBirthMonth'), 'August')
  assert.equal(valueFromProfileRow(profile, 'dateOfBirthYear'), '2007')
  assert.equal(valueFromProfileRow(profile, 'class10PassingYear'), '2023')
  assert.equal(valueFromProfileRow(profile, 'pwdStatus'), null)
  assert.equal(valueFromProfileRow(profile, 'preferredExamCities'), 'Delhi, Noida')
  assert.equal(valueFromProfileRow(profile, 'email'), null)
  assert.equal(valueFromProfileRow(profile, 'homeState'), null)
  assert.equal(valueFromProfileRow(profile, 'unknownField'), null)
})

test('a checked PwD status becomes a boolean only after explicit confirmation', () => {
  // Vault policy: PwD is never inferred or reused until the student confirms
  // the answer themselves, so an unchecked/unconfirmed value stays missing.
  assert.equal(valueFromProfileRow({ pwdStatus: true }, 'pwdStatus'), null)
  assert.equal(valueFromProfileRow({ pwdStatus: true, pwdStatusConfirmed: false }, 'pwdStatus'), null)
  assert.equal(valueFromProfileRow({ pwdStatus: true, pwdStatusConfirmed: true }, 'pwdStatus'), true)
  assert.equal(valueFromProfileRow({ pwdStatus: false, pwdStatusConfirmed: true }, 'pwdStatus'), null)
  assert.equal(valueFromProfileRow({}, 'dateOfBirthDay'), null)
  assert.equal(valueFromProfileRow({ fullName: '   ' }, 'fullName'), null)
})

/* --------------------------------------------------------------------------- */
/* Shared extension policy                                                    */
/* --------------------------------------------------------------------------- */

test('extension policy mirrors the exact official allowlist and rejects lookalikes', () => {
  const official = AgentCore.classifyUrl(
    'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx?enc=secret'
  )
  assert.equal(official.adapter, JEE_MAIN_ADAPTER)
  assert.equal(official.official, true)
  assert.equal(official.sanitizedUrl, 'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx')

  for (const url of [
    'https://examinationservices.nic.in.evil.example/JeeMaink2027/x',
    'https://examinationservices.nic.in@evil.example/JeeMaink2027/x',
    'http://examinationservices.nic.in/JeeMaink2027/x',
    'https://examinationservices.nic.in:444/JeeMaink2027/x',
    'https://jeemain.nta.nic.in/',
  ]) {
    assert.equal(AgentCore.classifyUrl(url).adapter, 'none', url)
  }

  assert.equal(AgentCore.classifyUrl('http://localhost:3000/apply/agent/jee-main-2027-demo').adapter, JEE_MAIN_ADAPTER)
  assert.equal(AgentCore.classifyUrl('http://localhost:3000/apply/agent/demo-form').adapter, 'generic')
  assert.equal(AgentCore.classifyUrl('http://localhost:3000/elsewhere').adapter, 'none')
})

test('page-kind classification uses headings and authentic form labels, not the URL alone', () => {
  assert.equal(
    AgentCore.classifyPageKind({
      adapter: JEE_MAIN_ADAPTER,
      headings: ['Personal Details'],
      labels: ["Candidate's Name", 'Candidate Date of Birth', 'Gender'],
    }),
    'personal'
  )
  assert.equal(
    AgentCore.classifyPageKind({
      adapter: JEE_MAIN_ADAPTER,
      headings: ['Educational Qualification Details'],
      labels: ['School Board', 'Year of Passing/Appearing', 'Registration No./Enrollment No./Roll No.'],
    }),
    'qualification'
  )
  assert.equal(
    AgentCore.classifyPageKind({
      adapter: JEE_MAIN_ADAPTER,
      headings: ['JEE Main 2027'],
      labels: ['Application No', 'CAPTCHA'],
      hasPasswordField: true,
    }),
    'login'
  )
  assert.equal(
    AgentCore.classifyPageKind({
      adapter: JEE_MAIN_ADAPTER,
      headings: ['Personal Details'],
      labels: ["Candidate's Name", 'Candidate Date of Birth', 'Password'],
      hasPasswordField: true,
    }),
    'personal'
  )
  assert.equal(
    AgentCore.classifyPageKind({
      adapter: JEE_MAIN_ADAPTER,
      headings: ['Candidate Login'],
      labels: ['Application No', 'Password'],
      hasPasswordField: true,
    }),
    'login'
  )
  assert.equal(
    AgentCore.classifyPageKind({ adapter: JEE_MAIN_ADAPTER, headings: ['Welcome'], labels: ['Help'] }),
    'unknown'
  )
  assert.equal(
    AgentCore.classifyPageKind({ adapter: 'generic', headings: ['Demo form'], labels: ['Full name'] }),
    'generic'
  )
})

test('fingerprints are stable, structural and change when the page structure changes', () => {
  const fields = [
    { kind: 'text', label: 'Email Address', group: 'Contact', required: true, options: [] },
    { kind: 'select', label: 'Category', group: 'Personal Details', required: false, options: [{}, {}] },
  ]
  const first = AgentCore.computeFingerprint(fields)
  assert.match(first, /^[0-9a-f]{8}$/)
  assert.equal(first, AgentCore.computeFingerprint(fields))

  assert.notEqual(first, AgentCore.computeFingerprint([{ ...fields[0], label: 'Mobile Number' }, fields[1]]))
  assert.notEqual(first, AgentCore.computeFingerprint([fields[0], { ...fields[1], group: 'Other' }]))
  assert.notEqual(first, AgentCore.computeFingerprint([fields[0], { ...fields[1], options: [{}] }]))
  assert.notEqual(first, AgentCore.computeFingerprint([fields[0], { ...fields[1], required: true }]))
})

test('plan context matching requires the same tab, sanitised URL and fingerprint', () => {
  const base = { tabId: 7, url: 'https://examinationservices.nic.in/JeeMaink2027/x', fingerprint: 'abc12345' }
  assert.equal(AgentCore.isSamePageContext(base, { ...base }), true)
  assert.equal(AgentCore.isSamePageContext(base, { ...base, tabId: 8 }), false)
  assert.equal(AgentCore.isSamePageContext(base, { ...base, url: base.url + '2' }), false)
  assert.equal(AgentCore.isSamePageContext(base, { ...base, fingerprint: 'deadbeef' }), false)
  assert.equal(AgentCore.isSamePageContext(null, base), false)
})

test('plans expire and completed fills cannot be replayed', () => {
  const now = 1_000_000
  assert.equal(AgentCore.isPlanFresh({ createdAt: now - 1000 }, now, 10_000), true)
  assert.equal(AgentCore.isPlanFresh({ createdAt: now - 10_000 }, now, 10_000), false)
  assert.equal(AgentCore.isPlanFresh({ createdAt: now + 5000 }, now, 10_000), false)
  assert.equal(AgentCore.isPlanFresh(null, now), false)

  const plan = {
    items: [
      { index: 0, status: 'mapped', canonical: 'fullName' },
      { index: 1, status: 'mapped', canonical: 'email' },
      { index: 2, status: 'manual', canonical: null },
    ],
  }
  const approved = AgentCore.approvedPlanItems(plan, new Set([0, 1, 2]), null)
  assert.deepEqual(approved.map(item => item.index), [0, 1])
  assert.deepEqual(AgentCore.approvedPlanItems(plan, new Set([0, 1]), 'done'), [])
  assert.deepEqual(AgentCore.approvedPlanItems(plan, new Set(), null), [])
})

test('post-fill verification checks the actual control state without exposing values', () => {
  assert.equal(AgentCore.verifyWrite('text', 'Aarav', 'Aarav'), true)
  assert.equal(AgentCore.verifyWrite('text', 'Aarav', 'Aarav '), false)
  assert.equal(AgentCore.verifyWrite('date', '2007-08-15', '2007-08-15'), true)
  assert.equal(AgentCore.verifyWrite('radio', true, true), true)
  assert.equal(AgentCore.verifyWrite('radio', true, false), false)
  assert.equal(AgentCore.verifyWrite('checkbox', true, true), true)
  assert.equal(AgentCore.verifyWrite('checkbox', 'true', true), false)
})

/* --------------------------------------------------------------------------- */
/* Manifest, safety boundaries and visible product wiring                     */
/* --------------------------------------------------------------------------- */

test('manifest keeps a minimal explicit host allowlist for every registered adapter', () => {
  const manifest = JSON.parse(readRepo('extensions/rankora-apply-agent/manifest.json'))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, '1.2.0')
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage'])
  assert.equal(manifest.host_permissions.includes('https://examinationservices.nic.in/JeeMaink2027/*'), true)
  assert.equal(manifest.host_permissions.includes('https://viteee.vit.ac.in/*'), true)
  assert.deepEqual(
    [...manifest.host_permissions].sort(),
    [
      'http://127.0.0.1:3000/*',
      'http://localhost:3000/*',
      'https://examinationservices.nic.in/JeeMaink2027/*',
      'https://viteee.vit.ac.in/*',
    ].sort()
  )
  assert.equal(manifest.host_permissions.some(pattern => pattern.includes('<all_urls>') || pattern === '*://*/*'), false)
  assert.equal(manifest.host_permissions.some(pattern => pattern.includes('jeemain.nta.nic.in')), false)
  // The floating pet is injected only on the same narrow allowlist (local demos + official adapter paths).
  assert.equal(Array.isArray(manifest.content_scripts), true)
  const csMatches = manifest.content_scripts.flatMap(entry => entry.matches || [])
  assert.equal(csMatches.some(pattern => pattern.includes('<all_urls>') || pattern === '*://*/*'), false)
  assert.equal(csMatches.includes('https://examinationservices.nic.in/JeeMaink2027/*'), true)
  assert.equal(csMatches.includes('https://viteee.vit.ac.in/*'), true)
  assert.equal(csMatches.includes('http://localhost:3000/apply/agent/demo-form*'), true)
})

test('a cancelled or cleared approval set cannot fill any field', () => {
  const plan = {
    items: [
      { index: 0, status: 'mapped', canonical: 'fullName' },
      { index: 3, status: 'mapped', canonical: 'email' },
    ],
  }
  assert.deepEqual(AgentCore.approvedPlanItems(plan, new Set(), null), [])
  assert.deepEqual(AgentCore.approvedPlanItems(plan, new Set([0, 3]), 'cancelled'), [])
})

test('the JEE integration does not add a second agent or claim official affiliation', () => {
  const popup = readRepo('extensions/rankora-apply-agent/popup.html')
  const content = readRepo('extensions/rankora-apply-agent/content/agent.js')
  const background = readRepo('extensions/rankora-apply-agent/background.js')
  const page = readRepo('src/app/apply/agent/page.tsx')
  const manifest = JSON.parse(readRepo('extensions/rankora-apply-agent/manifest.json'))

  assert.match(popup, /id="adapter-banner"/)
  assert.match(popup, /documentation-backed/)
  assert.match(content, /RANKORA_PAGE/)
  assert.match(content, /expectedFingerprint/)
  assert.match(content, /unverified/)
  assert.match(background, /importScripts\('shared\/agent-core\.js'[^)]*\)/)
  assert.match(background, /PAGE_CHANGED/)
  assert.match(background, /clearPlanContext/)
  assert.match(page, /\/apply\/agent\/jee-main-2027-demo/)
  assert.match(page, /live portal not verified/i)
  assert.match(page, /advisory check/i)
  assert.match(page, /does not verify documents/i)
  assert.doesNotMatch(manifest.description, /official partnership|affiliated with NTA/i)
})

test('official source list and document specifications are complete and dated', () => {
  assert.ok(JEE_MAIN_SOURCES.length >= 4)
  const urls = JEE_MAIN_SOURCES.map(source => source.url)
  assert.ok(urls.includes('https://jeemain.nta.nic.in/'))
  assert.ok(urls.includes('https://jeemain.nta.nic.in/online-application-form-for-jee-main-2027-session-1/'))
  assert.ok(urls.some(url => url.endsWith('.pdf')))
  assert.equal(new Set(urls).size, urls.length)

  const specs = JEE_MAIN_DOCUMENT_SPECS.map(doc => doc.label + ': ' + doc.spec).join('\n')
  assert.match(specs, /Photograph: JPG\/JPEG, 10–200 kB/)
  assert.match(specs, /Signature: JPG\/JPEG, 10–100 kB/)
  assert.match(specs, /Class 10 certificate \/ marksheet: PDF, 50–300 kB/)
  assert.equal(JEE_MAIN_PORTAL_PATH_PREFIX, '/JeeMaink2027/')
})

test('private document guidance is advisory and checks only the published format/size limits', () => {
  assert.equal(jeeUploadGuidance('PHOTO', null).status, 'missing')
  assert.equal(
    jeeUploadGuidance('PHOTO', { documentType: 'PHOTO', mimeType: 'image/png', sizeBytes: 50_000 }).status,
    'outside-guidance'
  )
  assert.equal(
    jeeUploadGuidance('PHOTO', { documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 5_000 }).status,
    'outside-guidance'
  )
  assert.equal(
    jeeUploadGuidance('PHOTO', { documentType: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 50_000 }).status,
    'ok'
  )
  assert.equal(
    jeeUploadGuidance('SIGNATURE', { documentType: 'SIGNATURE', mimeType: 'image/jpeg', sizeBytes: 150_000 }).status,
    'outside-guidance'
  )
  assert.equal(
    jeeUploadGuidance('CLASS10_MARKSHEET', {
      documentType: 'CLASS10_MARKSHEET',
      mimeType: 'application/pdf',
      sizeBytes: 100_000,
    }).status,
    'ok'
  )
  assert.equal(
    jeeUploadGuidance('PWD_CERTIFICATE', {
      documentType: 'PWD_CERTIFICATE',
      mimeType: 'image/jpeg',
      sizeBytes: 100_000,
    }).status,
    'outside-guidance'
  )
  assert.match(jeeUploadGuidance('PHOTO', null).message, /private Formly documents/i)
})

test('the strict JEE canonical allowlist never widens to state, address, parents or declarations', () => {
  const allowed = new Set(JEE_MAIN_FILLABLE_CANONICALS)
  for (const field of [
    'fullName',
    'gender',
    'dateOfBirth',
    'email',
    'mobileNumber',
    'category',
    'class10Board',
    'class12Board',
    'class10PassingYear',
    'class12PassingYear',
    'class10RollNumber',
    'class12RollNumber',
  ]) {
    assert.equal(allowed.has(field), true, field)
  }
  for (const field of [
    'homeState',
    'state',
    'addressLine',
    'pinCode',
    'pwdStatus',
    'preferredExamCities',
    'class10Marks',
    'class12Marks',
  ]) {
    assert.equal(allowed.has(field), false, field)
  }
})
