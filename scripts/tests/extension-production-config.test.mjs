import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildExtension, normalizeProductionOrigin, PRODUCTION_ORIGIN_PLACEHOLDER } from '../build-extension.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXT = path.join(ROOT, 'extensions', 'rankora-apply-agent')
const readSource = (...parts) => readFile(path.join(EXT, ...parts), 'utf8')
const { default: AgentCore } = await import(pathToFileURL(path.join(EXT, 'shared', 'agent-core.js')).href)
const { default: ExtensionPolicy } = await import(pathToFileURL(path.join(EXT, 'shared', 'extension-policy.js')).href)

test('production origins require a confirmed public HTTPS origin and reject local endpoints', () => {
  assert.equal(normalizeProductionOrigin(undefined), PRODUCTION_ORIGIN_PLACEHOLDER)
  assert.equal(normalizeProductionOrigin('https://app.formlee.example/'), 'https://app.formlee.example')
  for (const origin of [
    'http://app.formlee.example',
    'https://localhost:3000',
    'https://127.0.0.1:3000',
    'https://[::1]:3000',
    'https://dev.localhost',
    'https://app.formlee.example/path',
    'https://user:secret@app.formlee.example',
    'https://temporary.invalid',
    'not a url',
  ]) assert.throws(() => normalizeProductionOrigin(origin), undefined, origin)
})

test('development API origin remains the Formlee localhost workflow', async () => {
  const config = (await import(pathToFileURL(path.join(EXT, 'shared', 'formlee-config.js')).href + `?dev=${Date.now()}`)).default
  assert.equal(config.isDevelopmentBuild(), true)
  assert.equal(await config.getBaseUrl(), 'http://localhost:3000')
})

test('production package fixes its API origin and fails closed on the deployment placeholder', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'formlee-extension-package-'))
  t.after(() => rm(temp, { recursive: true, force: true }))

  const placeholder = await buildExtension({ mode: 'production', outputDir: path.join(temp, 'production-placeholder') })
  const configSource = await readFile(path.join(placeholder.outputDir, 'shared', 'formlee-config.js'), 'utf8')
  const configModulePath = pathToFileURL(path.join(placeholder.outputDir, 'shared', 'formlee-config.js')).href
  const { default: config } = await import(configModulePath + `?test=${Date.now()}`)
  const manifest = JSON.parse(await readFile(path.join(placeholder.outputDir, 'manifest.json'), 'utf8'))

  assert.equal(placeholder.configured, false)
  assert.equal(placeholder.apiOrigin, PRODUCTION_ORIGIN_PLACEHOLDER)
  assert.equal(await config.getBaseUrl(), null)
  assert.match(config.getConfigurationError(), /FORMLEE_PRODUCTION_API_ORIGIN/)
  assert.match(configSource, /const BUILD_MODE = "production"/)
  assert.ok(!manifest.host_permissions.some(pattern => /^http:\/\/(localhost|127\.0\.0\.1)/.test(pattern)))
  assert.ok(!manifest.content_scripts.some(script => script.matches.some(pattern => /^http:\/\/(localhost|127\.0\.0\.1)/.test(pattern))))
  assert.ok(manifest.host_permissions.includes(new URL(PRODUCTION_ORIGIN_PLACEHOLDER).origin + '/*'))
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self';")
  assert.equal(manifest.externally_connectable, undefined)
  assert.equal(manifest.web_accessible_resources, undefined)

  const corePath = path.join(placeholder.outputDir, 'shared', 'agent-core.js')
  const { default: productionCore } = await import(pathToFileURL(corePath).href + `?test=${Date.now() + 1}`)
  assert.equal(productionCore.BUILD_MODE, 'production')
  assert.equal(productionCore.classifyUrl('http://localhost:3000/apply/agent/demo-form').adapter, 'none')
  assert.equal(productionCore.classifyUrl('https://examinationservices.nic.in/JeeMaink2027/').adapter, 'jee-main-2027')
})

test('configured production package grants only the exact HTTPS application origin and contains loadable assets', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'formlee-extension-package-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const origin = 'https://app.formlee.example'
  const result = await buildExtension({ mode: 'production', apiOrigin: origin, outputDir: path.join(temp, 'production') })
  const manifest = JSON.parse(await readFile(path.join(result.outputDir, 'manifest.json'), 'utf8'))
  assert.equal(result.configured, true)
  assert.ok(manifest.host_permissions.includes(origin + '/*'))
  assert.ok(!manifest.host_permissions.includes('https://*/*'))
  assert.ok(!manifest.permissions.includes('tabs'))
  assert.ok(!manifest.permissions.includes('webNavigation'))
  assert.ok(!manifest.permissions.includes('notifications'))
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage'])
  assert.equal(manifest.minimum_chrome_version, '114')

  const manifestAssetPaths = [
    manifest.side_panel.default_path,
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => script.js),
  ]
  for (const relativePath of manifestAssetPaths) {
    await stat(path.join(result.outputDir, relativePath))
  }
  const filePaths = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(fullPath)
      else filePaths.push(path.relative(result.outputDir, fullPath).split(path.sep).join('/'))
    }
  }
  await walk(result.outputDir)
  assert.ok(filePaths.every(file => !file.endsWith('.map') && !file.startsWith('.env')))
  assert.ok(!filePaths.includes('README.md'))
  assert.ok(filePaths.includes('shared/extension-policy.js'))
})

test('manifest keeps a narrow MV3 permission and host allowlist', async () => {
  const manifest = JSON.parse(await readSource('manifest.json'))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html')
  assert.ok(manifest.permissions.includes('sidePanel'))
  assert.ok(!manifest.permissions.includes('tabs'))
  assert.ok(!manifest.permissions.includes('webNavigation'))
  assert.ok(!manifest.permissions.includes('notifications'))
  assert.equal(manifest.externally_connectable, undefined)
  assert.equal(manifest.web_accessible_resources, undefined)
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"))
  assert.ok(manifest.host_permissions.every(pattern => !pattern.includes('*://*/*') && !pattern.includes('https://*/*')))
})

test('runtime messages require a known extension page or the supported top-level content script', () => {
  const classify = AgentCore.classifyUrl
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
  const extensionSender = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel.html` }
  assert.equal(ExtensionPolicy.isAllowedMessageSender(extensionSender, extensionId, { type: 'PAIR' }, classify, false), true)
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ ...extensionSender, url: `chrome-extension://${extensionId}/unexpected.html` }, extensionId, { type: 'PAIR' }, classify, false), false)
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ ...extensionSender, id: 'other-extension' }, extensionId, { type: 'PAIR' }, classify, false), false)

  const pageUrl = 'https://examinationservices.nic.in/JeeMaink2027/form'
  const contentSender = { id: extensionId, url: pageUrl, tab: { id: 4, url: pageUrl }, frameId: 0 }
  assert.equal(ExtensionPolicy.isAllowedMessageSender(contentSender, extensionId, { type: 'FILL' }, classify, false), true)
  assert.equal(ExtensionPolicy.isAllowedMessageSender(contentSender, extensionId, { type: 'PAIR' }, classify, false), false)
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ ...contentSender, frameId: 2 }, extensionId, { type: 'SCAN' }, classify, false), false)
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ ...contentSender, tab: { id: 4, url: 'https://example.com/' } }, extensionId, { type: 'SCAN' }, classify, false), false)

  const localDemo = 'http://localhost:3000/apply/agent/demo-form'
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ id: extensionId, url: localDemo, tab: { id: 4, url: localDemo }, frameId: 0 }, extensionId, { type: 'SCAN' }, classify, true), true)
  assert.equal(ExtensionPolicy.isAllowedMessageSender({ id: extensionId, url: localDemo, tab: { id: 4, url: localDemo }, frameId: 0 }, extensionId, { type: 'SCAN' }, classify, false), false)
})

test('expired or malformed agent sessions fail closed', () => {
  const now = Date.parse('2026-11-07T00:00:00.000Z')
  assert.equal(ExtensionPolicy.isSessionExpired('2026-11-07T00:00:01.000Z', now), false)
  assert.equal(ExtensionPolicy.isSessionExpired('2026-11-06T23:59:59.000Z', now), true)
  assert.equal(ExtensionPolicy.isSessionExpired('not-a-date', now), true)
  assert.equal(ExtensionPolicy.isSessionExpired('', now), true)
})

test('disconnect revokes the specific agent token and clears content-script caches', async () => {
  const route = await readFile(path.join(ROOT, 'src', 'app', 'api', 'agent', 'session', 'route.ts'), 'utf8')
  const session = await readFile(path.join(ROOT, 'src', 'lib', 'agent', 'session.ts'), 'utf8')
  const background = await readSource('background.js')
  const pet = await readSource('content', 'pet.js')
  assert.match(route, /export async function POST/)
  assert.match(route, /revokeAgentSession\(session\.token\)/)
  assert.match(session, /where: \{ id: token, revokedAt: null, expiresAt: \{ gt: new Date\(\) \} \}/)
  assert.match(background, /case 'DISCONNECT':[\s\S]*?agentApi\('\/api\/agent\/session', \{ method: 'POST' \}\)/)
  assert.match(background, /await clearLocalAgentSession\(\)/)
  for (const field of ['state.values = {}', 'state.plan = null', 'state.profileStatus = null', 'state.documents = null']) {
    assert.ok(pet.includes(field), `disconnect must clear ${field}`)
  }
  assert.match(background, /Disconnect the current Formlee workspace before pairing a different account/)
})

test('Formlee web sign-out revokes the signed-in workspace agent sessions before switching accounts', async () => {
  const route = await readFile(path.join(ROOT, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'), 'utf8')
  assert.match(route, /pathname\.endsWith\('\/sign-out'\)/)
  assert.match(route, /workspaceId = await requireWorkspaceId\(\)/)
  assert.match(route, /const response = await handleAuthRequest\(request\)[\s\S]*?revokeAgentSessions\(workspaceId\)/)
  assert.match(route, /sign-out must remain available/i)
})

test('server session context is workspace scoped and exposes no workspace identifier to the extension', async () => {
  const session = await readFile(path.join(ROOT, 'src', 'lib', 'agent', 'session.ts'), 'utf8')
  const endpoint = await readFile(path.join(ROOT, 'src', 'app', 'api', 'agent', 'session', 'route.ts'), 'utf8')
  assert.match(session, /return \{ workspaceId: session\.workspaceId, token: session\.id \}/)
  assert.match(endpoint, /Deliberately minimal: no workspace id, no profile data/)
  assert.match(endpoint, /NextResponse\.json\(\{ valid: true \}\)/)
})

test('fill remains review-gated and unsafe fields and automatic submission stay excluded', async () => {
  const background = await readSource('background.js')
  const agent = await readSource('content', 'agent.js')
  const manifest = JSON.parse(await readSource('manifest.json'))
  assert.match(background, /function approvedAgainstPlan\(approved, plan\)/)
  assert.match(background, /function fillActiveTab[\s\S]*approvalRef is required/)
  assert.match(background, /code: 'APPROVAL_REQUIRED'/)
  assert.match(background, /\/api\/agent\/approvals\/verify/)
  assert.match(agent, /captcha/i)
  assert.ok(agent.includes('one[\\s-]?time'))
  assert.match(agent, /declaration/i)
  assert.doesNotMatch(agent, /\.submit\s*\(/)
  assert.doesNotMatch(agent, /requestSubmit\s*\(/)
  assert.equal(manifest.externally_connectable, undefined)
})

test('development and production packages never include remote executable dependencies', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'formlee-extension-package-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const development = await buildExtension({ mode: 'development', outputDir: path.join(temp, 'development') })
  const production = await buildExtension({ mode: 'production', apiOrigin: 'https://app.formlee.example', outputDir: path.join(temp, 'production') })
  for (const packageDir of [development.outputDir, production.outputDir]) {
    const html = await readFile(path.join(packageDir, 'sidepanel.html'), 'utf8')
    assert.doesNotMatch(html, /https?:\/\/[^'" ]+\.js/)
    const background = await readFile(path.join(packageDir, 'background.js'), 'utf8')
    assert.doesNotMatch(background, /\beval\s*\(/)
    assert.doesNotMatch(background, /new Function\s*\(/)
  }
})
