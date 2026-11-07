import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = file => readFileSync(path.join(ROOT, file), 'utf8')
const home = read('src/app/page.tsx')
const auth = read('src/app/login/page.tsx')
const styles = read('src/app/globals.css')
const hero = read('src/components/marketing/hero-demo.tsx')
const exams = read('src/lib/apply-ai/exams.ts')

test('landing page includes all product-story sections and the safety boundary', () => {
  for (const section of ['how-it-works', 'vault', 'exams', 'privacy', 'application-hub', 'side-panel']) {
    assert.ok(home.includes(`id='${section}'`), `missing section anchor: ${section}`)
  }
  for (const phrase of ['CAPTCHA', 'OTP', 'Payments', 'Declarations', 'Final submission']) assert.ok(home.includes(phrase))
  assert.match(hero, /No live examination portal connected/)
  assert.match(hero, /fictional student/)
})

test('exam support is described with the project’s documented readiness levels', () => {
  assert.match(home, /Documentation-backed beta/)
  assert.match(home, /Demonstration · docs-backed/)
  assert.match(home, /BITSAT, MET and CUET are catalog entries/)
  for (const id of ['JEE_MAIN', 'VITEEE', 'BITSAT', 'MET', 'CUET_UG']) assert.ok(exams.includes(`id: '${id}'`))
})

test('primary signup and sign-in CTAs use the existing authentication route', () => {
  assert.match(home, /href='\/login\?mode=sign-up'/)
  assert.match(home, /href='\/login'/)
  assert.match(auth, /get\('mode'\) === 'sign-up'/)
  assert.match(auth, /authClient\.signUp\.email/)
  assert.match(auth, /authClient\.signIn\.email/)
})

test('every in-page navigation target exists on the landing page', () => {
  const ids = new Set([...home.matchAll(/\bid='([^']+)'/g)].map(match => match[1]))
  const targets = [...home.matchAll(/href='#([^']+)'/g)].map(match => match[1])
  assert.ok(targets.length > 0)
  for (const target of targets) assert.ok(ids.has(target), `broken landing-page anchor: #${target}`)
})

test('hero provides keyboard-operable step controls and respects reduced motion', () => {
  assert.match(hero, /aria-pressed=\{step === index\}/)
  assert.match(hero, /prefers-reduced-motion: reduce/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /@media \(max-width: 720px\)/)
  assert.match(styles, /@media \(max-width: 380px\)/)
  assert.match(styles, /:focus-visible/)
})

test('public theme stays local-font-only and avoids heavy decorative runtimes', () => {
  assert.doesNotMatch(home, /next\/font\/google|fonts\.googleapis/)
  assert.doesNotMatch(hero, /three\.js|gsap|framer-motion/i)
})
