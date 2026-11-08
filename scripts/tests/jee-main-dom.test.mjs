import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Real-Chrome DOM test for the JEE Main fixture + existing content script.
 *
 * This is not a live NTA test. It loads the synthetic local fixture, injects
 * the same shared policy + content script the extension injects, and checks
 * scanning, approved-only filling, read-back verification, unsafe-control
 * refusal and page-change invalidation against real browser DOM behaviour.
 *
 * Skips cleanly when Chrome or the local dev server is unavailable.
 */

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

const PERSONAL_URL = 'http://localhost:3000/apply/agent/jee-main-2027-demo'
const QUALIFICATION_URL = 'http://localhost:3000/apply/agent/jee-main-2027-demo/qualification'

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      const fs = await import('node:fs/promises')
      await fs.access(candidate)
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.waiters = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket open timed out')), 10000)
      this.ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      this.ws.addEventListener('error', event => {
        clearTimeout(timer)
        reject(new Error('CDP websocket error: ' + (event.message || 'unknown')))
      })
    })
    this.ws.addEventListener('message', event => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message || 'CDP command failed'))
        else resolve(message.result)
        return
      }
      if (message.method && this.waiters.has(message.method)) {
        const waiters = this.waiters.get(message.method)
        this.waiters.delete(message.method)
        for (const resolve of waiters) resolve(message.params)
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('CDP command timed out: ' + method))
      }, 20000)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  waitFor(method) {
    return new Promise(resolve => {
      const list = this.waiters.get(method) || []
      list.push(resolve)
      this.waiters.set(method, list)
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // ignore
    }
  }
}

async function launchChrome() {
  const chromePath = await findChrome()
  if (!chromePath) return null
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'formlee-jee-chrome-'))
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--user-data-dir=' + userDataDir,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let stderr = ''
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools endpoint')), 15000)
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error('Chrome exited early (' + code + '): ' + stderr.slice(0, 500)))
    })
  })

  const browserWs = wsUrl.replace(/\/devtools\/browser\/.*/, '')
  const port = new URL(browserWs).port
  return { child, userDataDir, port }
}

async function pageWebSocket(port) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list')
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page) return page.webSocketDebuggerUrl
      }
    } catch {
      // not ready
    }
    await delay(100)
  }
  throw new Error('No Chrome page target became available')
}

async function runInPage() {
  const chrome = await launchChrome()
  if (!chrome) return null

  let cdp = null
  try {
    const wsUrl = await pageWebSocket(chrome.port)
    cdp = new CdpClient(wsUrl)
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails) {
        throw new Error(
          'Page evaluation failed: ' +
            (result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'unknown')
        )
      }
      return result.result.value
    }

    const navigate = async url => {
      const loaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url })
      await loaded
      // Wait for the static DOM and React hydration to settle.
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const ready = await evaluate('document.readyState')
        if (ready === 'complete') break
        await delay(100)
      }
      await delay(300)
    }

    const injectAgent = async () => {
      const core = await readFile('extensions/formlee-apply-agent/shared/agent-core.js', 'utf8')
      const content = await readFile('extensions/formlee-apply-agent/content/agent.js', 'utf8')
      await evaluate(core)
      const wrapped =
        '(() => {' +
        'const chrome = { runtime: { onMessage: { addListener() {} } } };' +
        content +
        '\n;globalThis.__formleeTest = { scanPage, applyFill };' +
        '})()'
      await evaluate(wrapped)
    }

    const scan = async () => evaluate('__formleeTest.scanPage()')
    const applyFill = async (fills, fingerprint) =>
      evaluate(
        '__formleeTest.applyFill(' +
          JSON.stringify(fills) +
          ', ' +
          JSON.stringify(fingerprint) +
          ')'
      )
    const values = async selectors =>
      evaluate(
        '(' +
          JSON.stringify(selectors) +
          ').map(selector => { const el = document.querySelector(selector); return el ? el.value : null })'
      )

    /* ---------------------- Personal Details fixture ---------------------- */
    await navigate(PERSONAL_URL)
    await injectAgent()

    const personal = await scan()
    assert.equal(personal.page.adapter, 'jee-main-2027')
    assert.equal(personal.page.kind, 'personal')
    assert.equal(personal.page.supported, true)
    assert.match(personal.page.fingerprint, /^[0-9a-f]{8}$/)

    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const personalByLabel = new Map(personal.fields.map(field => [normalize(field.label), field]))
    assert.ok(personalByLabel.has(normalize("Candidate's Name")))
    assert.ok(personalByLabel.has(normalize('Gender')))
    assert.ok(personalByLabel.has(normalize('Category')))
    assert.ok(personalByLabel.has(normalize('Confirm Email Address')))
    assert.equal(personal.fields.some(field => field.kind === 'password'), false)
    assert.equal(personal.fields.some(field => /password/i.test(field.label)), false)

    const dayField = personal.fields.find(field => field.label === 'Day')
    const monthField = personal.fields.find(field => field.label === 'Month')
    const yearField = personal.fields.find(field => field.label === 'Year')
    assert.equal(dayField.group, 'Candidate Date of Birth')
    assert.equal(monthField.group, 'Candidate Date of Birth')
    assert.equal(yearField.group, 'Candidate Date of Birth')

    // Scanning must not write anything.
    const previewValues = await values(['#fixture-candidate-name', '#fixture-email', '#fixture-confirm-email'])
    assert.deepEqual(previewValues, ['', '', ''])

    const nameField = personalByLabel.get(normalize("Candidate's Name"))
    const genderField = personalByLabel.get(normalize('Gender'))
    const categoryField = personalByLabel.get(normalize('Category'))
    const emailField = personalByLabel.get(normalize('Email Address'))

    const filled = await applyFill(
      [
        { index: nameField.index, value: 'Aarav Sharma' },
        { index: dayField.index, value: '15' },
        { index: genderField.index, value: 'Male' },
        { index: categoryField.index, value: 'GENERAL' },
        { index: emailField.index, value: 'aarav@example.test' },
      ],
      personal.page.fingerprint
    )
    assert.equal(filled.ok, true)
    assert.deepEqual(
      filled.results.map(result => result.status),
      ['filled', 'filled', 'filled', 'filled', 'filled']
    )

    const afterFill = await values([
      '#fixture-candidate-name',
      '#fixture-dob-day',
      '#fixture-gender',
      '#fixture-category',
      '#fixture-email',
      '#fixture-confirm-email',
      '#fixture-father-name',
      '#fixture-captcha',
    ])
    assert.deepEqual(afterFill, [
      'Aarav Sharma',
      '15',
      'M',
      'GENERAL',
      'aarav@example.test',
      '',
      '',
      '',
    ])
    const declarationChecked = await evaluate('document.querySelector("input[name=declaration]").checked')
    assert.equal(declarationChecked, false)

    // A page-controlled update that wins after our write must be reported as
    // unverified, never as success.
    await evaluate(
      '(() => {' +
        'const el = document.querySelector("#fixture-email");' +
        'el.value = "";' +
        'el.addEventListener("input", () => { el.value = ""; }, { once: true });' +
        '})()'
    )
    const unverified = await applyFill(
      [{ index: emailField.index, value: 'aarav@example.test' }],
      personal.page.fingerprint
    )
    assert.equal(unverified.ok, true)
    assert.equal(unverified.results[0].status, 'unverified')

    // The file input is detected but must always be refused.
    const photoField = personal.fields.find(field => field.label === 'Upload Photograph')
    assert.ok(photoField)
    const fileAttempt = await applyFill([{ index: photoField.index, value: '/tmp/fake.jpg' }], personal.page.fingerprint)
    assert.equal(fileAttempt.ok, true)
    assert.equal(fileAttempt.results[0].status, 'refused')

    // The declaration checkbox is never ticked.
    const declarationField = personal.fields.find(field => field.label.includes('I agree to the declaration'))
    assert.ok(declarationField)
    const declarationAttempt = await applyFill(
      [{ index: declarationField.index, value: true }],
      personal.page.fingerprint
    )
    assert.equal(declarationAttempt.ok, true)
    assert.equal(declarationAttempt.results[0].status, 'refused')

    // Any structural change invalidates the approved fingerprint.
    await evaluate(
      'document.querySelector(\'label[for="fixture-candidate-name"]\').textContent = "Candidate Full Name"'
    )
    const changed = await applyFill([{ index: nameField.index, value: 'Aarav Sharma' }], personal.page.fingerprint)
    assert.equal(changed.ok, false)
    assert.equal(changed.code, 'PAGE_CHANGED')

    /* ---------------------- Qualification fixture ---------------------- */
    await navigate(QUALIFICATION_URL)
    await injectAgent()

    // Navigating away invalidates the previous page's approved fingerprint.
    const navigated = await applyFill([{ index: nameField.index, value: 'Aarav Sharma' }], personal.page.fingerprint)
    assert.equal(navigated.ok, false)
    assert.equal(navigated.code, 'PAGE_CHANGED')

    const qualification = await scan()
    assert.equal(qualification.page.adapter, 'jee-main-2027')
    assert.equal(qualification.page.kind, 'qualification')
    assert.equal(qualification.page.supported, true)

    const qualByLabel = new Map()
    for (const field of qualification.fields) {
      if (!qualByLabel.has(field.label)) qualByLabel.set(field.label, [])
      qualByLabel.get(field.label).push(field)
    }

    const boards = qualByLabel.get('School Board')
    assert.equal(boards.length, 2)
    assert.equal(boards[0].group, 'Class 10 or Equivalent')
    assert.equal(boards[1].group, 'Class 12 or Equivalent')

    const years = qualByLabel.get('Year of Passing/Appearing')
    assert.equal(years.length, 2)
    const rolls = qualByLabel.get('Registration No./Enrollment No./Roll No.')
    assert.equal(rolls.length, 2)

    const qualFilled = await applyFill(
      [
        { index: boards[0].index, value: 'CBSE' },
        { index: boards[1].index, value: 'CBSE' },
        { index: years[0].index, value: '2023' },
        { index: years[1].index, value: '2025' },
        { index: rolls[0].index, value: 'C10234' },
        { index: rolls[1].index, value: 'C12234' },
      ],
      qualification.page.fingerprint
    )
    assert.equal(qualFilled.ok, true)
    assert.deepEqual(
      qualFilled.results.map(result => result.status),
      ['filled', 'filled', 'filled', 'filled', 'filled', 'filled']
    )

    const qualificationValues = await values([
      '#fixture-class10-board',
      '#fixture-class12-board',
      '#fixture-class10-year',
      '#fixture-class12-year',
      '#fixture-class10-roll',
      '#fixture-class12-roll',
      '#fixture-class10-result-mode',
      '#fixture-class10-certificate',
    ])
    assert.deepEqual(qualificationValues, ['CBSE', 'CBSE', '2023', '2025', 'C10234', 'C12234', '', ''])

    // A saved value that does not match any portal option must be reported,
    // never invented or force-selected.
    const noOption = await applyFill(
      [{ index: boards[0].index, value: 'Not A Real Board' }],
      qualification.page.fingerprint
    )
    assert.equal(noOption.ok, true)
    assert.equal(noOption.results[0].status, 'no-option')
    assert.equal((await values(['#fixture-class10-board']))[0], 'CBSE')

    const pwdChecked = await evaluate('document.querySelector("input[name=pwdStatus]").checked')
    assert.equal(pwdChecked, false)

    const certificate = qualification.fields.find(field => field.label === 'Upload Class 10 Certificate/Marksheet')
    assert.ok(certificate)
    const certificateAttempt = await applyFill(
      [{ index: certificate.index, value: 'C:\\fake\\certificate.pdf' }],
      qualification.page.fingerprint
    )
    assert.equal(certificateAttempt.results[0].status, 'refused')
  } finally {
    if (cdp) cdp.close()
    try {
      chrome.child.kill()
    } catch {
      // ignore
    }
    await delay(300)
    try {
      await rm(chrome.userDataDir, { recursive: true, force: true })
    } catch {
      // Chrome may still hold a lock on Windows; the OS temp cleaner handles it.
    }
  }
}

test('real Chrome: JEE fixture scans, previews without writing, fills only approved fields, verifies and invalidates changes', { timeout: 120000 }, async t => {
  const chrome = await findChrome()
  if (!chrome) {
    t.skip('Chrome/Edge is not installed on this machine.')
    return
  }
  let serverReady = false
  try {
    const response = await fetch(PERSONAL_URL)
    serverReady = response.ok
  } catch {
    serverReady = false
  }
  if (!serverReady) {
    t.skip('The local dev server is not running at http://localhost:3000.')
    return
  }

  await runInPage()
})

/* Keep readFile referenced for Node versions that tree-shake the import in the
 * helper above. */
void readFile
