import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildExtension, PRODUCTION_ORIGIN_PLACEHOLDER } from '../build-extension.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXT = path.join(ROOT, 'extensions', 'formlee-apply-agent')
const read = (...parts) => readFile(path.join(EXT, ...parts), 'utf8')
const coreSource = await read('shared', 'agent-core.js')

test('classic-script AgentCore aliases share one API, including the legacy Rankora name', () => {
  const context = { URL }
  runInNewContext(coreSource, context)

  assert.ok(context.AgentCore)
  assert.strictEqual(context.AgentCore, context.FormleeAgentCore)
  assert.strictEqual(context.AgentCore, context.RankoraAgentCore)
  assert.equal(typeof context.AgentCore.classifyUrl, 'function')
  assert.equal(typeof context.AgentCore.isFillablePageKind, 'function')
  assert.equal(context.AgentCore.classifyUrl('https://viteee.vit.ac.in/form').adapter, 'viteee-2027')
  assert.equal(context.AgentCore.isFillablePageKind('personal'), true)
})

test('CommonJS exports the same API as canonical and compatibility globals', () => {
  const commonJsModule = { exports: {} }
  const context = { URL, module: commonJsModule }
  runInNewContext(coreSource, context)

  assert.strictEqual(commonJsModule.exports, context.AgentCore)
  assert.strictEqual(commonJsModule.exports, context.FormleeAgentCore)
  assert.strictEqual(commonJsModule.exports, context.RankoraAgentCore)
  assert.equal(typeof commonJsModule.exports.classifyUrl, 'function')
  assert.equal(typeof commonJsModule.exports.isFillablePageKind, 'function')
})

test('every extension context loads AgentCore before its consumers', async () => {
  const background = await read('background.js')
  const injection = background.match(/files:\s*\[([^\]]+)\]/)?.[1] ?? ''
  const manifest = JSON.parse(await read('manifest.json'))
  const popup = await read('popup.html')
  const sidepanel = await read('sidepanel.html')
  const contentAgent = await read('content', 'agent.js')
  const contentPet = await read('content', 'pet.js')

  const importCall = background.match(/importScripts\(([^)]*)\)/)?.[1] ?? ''
  const imports = importCall.match(/'[^']+'/g)?.map(value => value.slice(1, -1)) ?? []
  assert.deepEqual(imports, [
    'shared/formlee-config.js',
    'shared/agent-core.js',
    'shared/extension-policy.js',
    'credits.js',
    'shared/message-response.js',
  ])
  assert.ok(background.indexOf('importScripts(') < background.indexOf('const AgentCore = globalThis.AgentCore'))
  assert.ok(background.indexOf('shared/agent-core.js') < background.indexOf('AgentCore.classifyUrl'))
  assert.ok(injection.indexOf('shared/agent-core.js') < injection.indexOf('content/agent.js'))

  const contentScripts = manifest.content_scripts[0].js
  assert.ok(contentScripts.indexOf('shared/agent-core.js') < contentScripts.indexOf('content/pet.js'))
  assert.ok(popup.indexOf('shared/agent-core.js') < popup.indexOf('popup.js'))
  assert.ok(sidepanel.indexOf('shared/agent-core.js') < sidepanel.indexOf('sidepanel.js'))
  assert.match(contentAgent, /globalThis\.AgentCore \|\| globalThis\.FormleeAgentCore \|\| globalThis\.RankoraAgentCore/)
  assert.match(contentPet, /globalThis\.AgentCore \|\| globalThis\.FormleeAgentCore \|\| globalThis\.RankoraAgentCore/)
  assert.match(contentAgent, /FORMLEE_SCAN.*RANKORA_SCAN/)
  assert.match(contentAgent, /FORMLEE_FILL.*RANKORA_FILL/)
  assert.match(contentPet, /FORMLEE_SHOW_PET.*RANKORA_SHOW_PET/)
})

test('background fails immediately with a clear error when AgentCore exports are missing', async () => {
  const background = await read('background.js')
  assert.match(background, /const AgentCore = globalThis\.AgentCore/)
  assert.match(background, /globalThis\.FormleeAgentCore !== AgentCore/)
  assert.match(background, /globalThis\.RankoraAgentCore !== AgentCore/)
  assert.match(background, /typeof AgentCore\.classifyUrl !== 'function'/)
  assert.match(background, /typeof AgentCore\.isFillablePageKind !== 'function'/)
  assert.match(background, /Formlee Apply Agent initialization failed: shared AgentCore is unavailable/)
})

test('production build retains canonical and compatibility globals, CommonJS and the service-worker guard', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'formlee-agent-core-package-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const result = await buildExtension({ mode: 'production', outputDir: path.join(temp, 'production') })
  const builtCore = await readFile(path.join(result.outputDir, 'shared', 'agent-core.js'), 'utf8')
  const builtBackground = await readFile(path.join(result.outputDir, 'background.js'), 'utf8')
  const manifest = JSON.parse(await readFile(path.join(result.outputDir, 'manifest.json'), 'utf8'))

  assert.match(builtCore, /module\.exports\s*=\s*api/)
  assert.match(builtCore, /root\.AgentCore\s*=\s*api/)
  assert.match(builtCore, /root\.FormleeAgentCore\s*=\s*api/)
  assert.match(builtCore, /root\.RankoraAgentCore\s*=\s*api/)
  assert.match(builtBackground, /const AgentCore = globalThis\.AgentCore/)
  assert.match(builtBackground, /Formlee Apply Agent initialization failed/)
  assert.equal(result.apiOrigin, PRODUCTION_ORIGIN_PLACEHOLDER)
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html')
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage'])
})
