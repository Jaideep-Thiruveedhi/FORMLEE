import test from 'node:test'
import assert from 'node:assert/strict'

import {
  JEE_MAIN_ADAPTER,
  JEE_MAIN_PORTAL_ORIGIN,
  JEE_MAIN_PORTAL_PATH_PREFIX,
  classifyAgentPage,
  mapJeeMainField,
} from '../../src/lib/agent/jee-main.ts'
import {
  VITEEE_ADAPTER,
  VITEEE_OFFICIAL_ORIGIN,
  VITEEE_FIXTURE_PATH,
  classifyViteeePage,
  mapViteeeField,
} from '../../src/lib/agent/viteee.ts'
import { classifyUrl, getAdapterById, listAdapters, mapFieldWithAdapter } from '../../src/lib/agent/registry.ts'
import AgentCore from '../../extensions/formlee-apply-agent/shared/agent-core.js'

function descriptor(label, kind = 'text', extra = {}) {
  return { label, kind, group: '', inputName: '', inputId: '', options: [], ...extra }
}

function option(text, value = '') {
  return { text, value }
}

function days() {
  return Array.from({ length: 31 }, (_, i) => String(i + 1))
}

/* --------------------------------------------------------------------------- */
/* Registry metadata                                                           */
/* --------------------------------------------------------------------------- */

test('registry lists adapters in priority order', () => {
  const adapters = listAdapters()
  assert.deepEqual(
    adapters.map(a => a.id),
    ['jee-main-2027', 'viteee-2027']
  )
  assert.ok(adapters.every(a => a.name && a.version && a.status && a.verifiedOn))
})

test('getAdapterById returns the correct adapter or null', () => {
  const jee = getAdapterById('jee-main-2027')
  assert.ok(jee)
  assert.equal(jee.id, 'jee-main-2027')

  const vit = getAdapterById('viteee-2027')
  assert.ok(vit)
  assert.equal(vit.id, 'viteee-2027')

  assert.equal(getAdapterById('generic'), null)
  assert.equal(getAdapterById('none'), null)
})

/* --------------------------------------------------------------------------- */
/* URL classification — JEE Main                                               */
/* --------------------------------------------------------------------------- */

test('registry selects JEE Main for official origin and exact path prefix', () => {
  const { adapter, classification } = classifyUrl(
    'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx?enc=token'
  )
  assert.ok(adapter)
  assert.equal(adapter.id, 'jee-main-2027')
  assert.equal(classification.adapter, 'jee-main-2027')
  assert.equal(classification.official, true)
  assert.equal(classification.fixture, false)
  assert.equal(classification.sanitizedUrl, 'https://examinationservices.nic.in/JeeMaink2027/root/Home.aspx')
})

test('registry selects JEE Main for the local synthetic fixture', () => {
  const { adapter, classification } = classifyUrl('http://localhost:3000/apply/agent/jee-main-2027-demo')
  assert.ok(adapter)
  assert.equal(adapter.id, 'jee-main-2027')
  assert.equal(classification.fixture, true)
})

/* --------------------------------------------------------------------------- */
/* URL classification — VITEEE                                                 */
/* --------------------------------------------------------------------------- */

test('registry selects VITEEE for the public information origin', () => {
  const { adapter, classification } = classifyUrl('https://viteee.vit.ac.in/important-dates')
  assert.ok(adapter)
  assert.equal(adapter.id, 'viteee-2027')
  assert.equal(classification.official, true)
  assert.equal(classification.fixture, false)
})

test('registry selects VITEEE for the local synthetic fixture', () => {
  const { adapter, classification } = classifyUrl('http://localhost:3000/apply/agent/viteee-2027-demo')
  assert.ok(adapter)
  assert.equal(adapter.id, 'viteee-2027')
  assert.equal(classification.fixture, true)
})

/* --------------------------------------------------------------------------- */
/* Unsupported origin refusal + ambiguity prevention                           */
/* --------------------------------------------------------------------------- */

test('registry refuses unsupported origins', () => {
  const unsupported = [
    'https://example.com/JeeMaink2027/',
    'https://examinationservices.nic.in/JeeMain2026/',
    'https://jeemain.nta.nic.in/',
    'https://viteee.vit.ac.in.evil.com/',
    'http://localhost:3000/apply/agent/unknown-exam',
    'file:///etc/passwd',
    'not-a-url',
  ]
  for (const raw of unsupported) {
    const { adapter, classification } = classifyUrl(raw)
    assert.equal(adapter, null, raw)
    assert.equal(classification.adapter, 'none', raw)
    assert.equal(classification.reason, 'UNSUPPORTED_ORIGIN', raw)
  }
})

test('adapters do not claim each other\'s official origins', () => {
  const jeeOnVit = classifyViteeePage('https://examinationservices.nic.in/JeeMaink2027/')
  assert.equal(jeeOnVit.adapter, 'none')

  const vitOnJee = classifyAgentPage('https://viteee.vit.ac.in/')
  assert.equal(vitOnJee.adapter, 'none')
})

/* --------------------------------------------------------------------------- */
/* Extension-side policy parity                                                */
/* --------------------------------------------------------------------------- */

test('extension agent-core classifies JEE and VITEEE fixtures and refuses unsupported domains', () => {
  const jee = AgentCore.classifyUrl('http://localhost:3000/apply/agent/jee-main-2027-demo')
  assert.equal(jee.adapter, 'jee-main-2027')

  const vit = AgentCore.classifyUrl('http://localhost:3000/apply/agent/viteee-2027-demo')
  assert.equal(vit.adapter, 'viteee-2027')

  const evil = AgentCore.classifyUrl('https://examinationservices.nic.in.evil.com/JeeMaink2027/')
  assert.equal(evil.adapter, 'none')
})

/* --------------------------------------------------------------------------- */
/* Field alias mapping — JEE Main regression                                   */
/* --------------------------------------------------------------------------- */

test('JEE Main personal-details mapping is preserved', () => {
  const name = mapJeeMainField(descriptor('Candidate’s Name'), 'personal')
  assert.equal(name.status, 'mapped')
  assert.equal(name.canonical, 'fullName')

  const gender = mapJeeMainField(descriptor('Gender', 'select'), 'personal')
  assert.equal(gender.status, 'mapped')
  assert.equal(gender.canonical, 'gender')

  const dobDay = mapJeeMainField(
    descriptor('Day', 'select', { group: 'Date of Birth', options: days().slice(0, 5).map(d => option(d)) }),
    'personal'
  )
  assert.equal(dobDay.status, 'mapped')
  assert.equal(dobDay.canonical, 'dateOfBirthDay')
})

test('JEE Main qualification-details mapping is preserved', () => {
  const board = mapJeeMainField(
    descriptor('School Board', 'text', { group: 'Class 10' }),
    'qualification'
  )
  assert.equal(board.status, 'mapped')
  assert.equal(board.canonical, 'class10Board')
})

test('JEE Main refuses unsafe fields', () => {
  const password = mapJeeMainField(descriptor('Password', 'password'), 'personal')
  assert.equal(password.status, 'unsafe')

  const aadhaar = mapJeeMainField(descriptor('Aadhaar Number', 'text'), 'personal')
  assert.equal(aadhaar.status, 'unsafe')
})

/* --------------------------------------------------------------------------- */
/* Field alias mapping — VITEEE new adapter                                    */
/* --------------------------------------------------------------------------- */

test('VITEEE maps common personal-details labels', () => {
  const name = mapViteeeField(descriptor('Candidate\'s Name'), 'personal')
  assert.equal(name.status, 'mapped')
  assert.equal(name.canonical, 'fullName')

  const email = mapViteeeField(descriptor('Email Address', 'email'), 'personal')
  assert.equal(email.status, 'mapped')
  assert.equal(email.canonical, 'email')

  const mobile = mapViteeeField(descriptor('Mobile Number', 'tel'), 'personal')
  assert.equal(mobile.status, 'mapped')
  assert.equal(mobile.canonical, 'mobileNumber')

  const gender = mapViteeeField(descriptor('Gender', 'select'), 'personal')
  assert.equal(gender.status, 'mapped')
  assert.equal(gender.canonical, 'gender')
})

test('VITEEE maps nationality and category conservatively', () => {
  const nationality = mapViteeeField(descriptor('Nationality', 'select'), 'personal')
  assert.equal(nationality.status, 'mapped')
  assert.equal(nationality.canonical, 'nationality')

  const category = mapViteeeField(descriptor('Category', 'select'), 'personal')
  assert.equal(category.status, 'mapped')
  assert.equal(category.canonical, 'category')
})

test('VITEEE maps date-of-birth parts', () => {
  const day = mapViteeeField(
    descriptor('Day', 'select', { group: 'Date of Birth', options: days().map(d => option(d)) }),
    'personal'
  )
  assert.equal(day.status, 'mapped')
  assert.equal(day.canonical, 'dateOfBirthDay')
})

test('VITEEE maps qualification details with class disambiguation', () => {
  const board10 = mapViteeeField(descriptor('School Board', 'text', { group: 'Class 10' }), 'qualification')
  assert.equal(board10.status, 'mapped')
  assert.equal(board10.canonical, 'class10Board')

  const board12 = mapViteeeField(descriptor('School Board', 'text', { group: 'Class 12' }), 'qualification')
  assert.equal(board12.status, 'mapped')
  assert.equal(board12.canonical, 'class12Board')

  const ambiguous = mapViteeeField(descriptor('School Board', 'text'), 'qualification')
  assert.equal(ambiguous.status, 'ambiguous')
  assert.deepEqual(ambiguous.ambiguous.sort(), ['class10Board', 'class12Board'].sort())
})

test('VITEEE refuses unsafe fields and leaves manual items untouched', () => {
  const upload = mapViteeeField(descriptor('Photograph Upload', 'file'), 'personal')
  assert.equal(upload.status, 'unsafe')

  const father = mapViteeeField(descriptor('Father\'s Name'), 'personal')
  assert.equal(father.status, 'manual')
})

/* --------------------------------------------------------------------------- */
/* Registry mapFieldWithAdapter cross-adapter isolation                        */
/* --------------------------------------------------------------------------- */

test('mapFieldWithAdapter routes to the correct adapter and respects page kind', () => {
  const jeeAdapter = getAdapterById('jee-main-2027')
  const vitAdapter = getAdapterById('viteee-2027')

  const jeeName = mapFieldWithAdapter(jeeAdapter, descriptor('Candidate’s Name'), 'personal')
  assert.equal(jeeName.status, 'mapped')
  assert.equal(jeeName.canonical, 'fullName')

  const vitName = mapFieldWithAdapter(vitAdapter, descriptor('Candidate\'s Name'), 'personal')
  assert.equal(vitName.status, 'mapped')
  assert.equal(vitName.canonical, 'fullName')

  const unsupportedKind = mapFieldWithAdapter(jeeAdapter, descriptor('Candidate’s Name'), 'exam')
  assert.equal(unsupportedKind.status, 'manual')
  assert.ok(unsupportedKind.reason.includes('exam'))
})

/* --------------------------------------------------------------------------- */
/* Adapter statuses are evidence-based                                         */
/* --------------------------------------------------------------------------- */

test('JEE Main and VITEEE adapters claim only documentation-backed status', () => {
  const jee = getAdapterById('jee-main-2027')
  assert.equal(jee.status, 'DOCUMENTATION_BACKED')
  assert.ok(!jee.statusLabel.toLowerCase().includes('fully tested'))

  const vit = getAdapterById('viteee-2027')
  assert.equal(vit.status, 'DOCUMENTATION_BACKED')
  assert.ok(vit.statusLabel.toLowerCase().includes('demo'))
})
