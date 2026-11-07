import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'extensions', 'rankora-apply-agent')
export const PRODUCTION_ORIGIN_PLACEHOLDER = 'https://replace-with-confirmed-formlee-origin.invalid'

const PACKAGE_FILES = [
  'background.js',
  'credits.js',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
]
const PACKAGE_DIRS = ['content', 'icons', 'shared']

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127\./.test(host)
}

export function normalizeProductionOrigin(raw) {
  if (raw == null || String(raw).trim() === '') return PRODUCTION_ORIGIN_PLACEHOLDER
  let parsed
  try {
    parsed = new URL(String(raw).trim())
  } catch {
    throw new Error('FORMLEE_PRODUCTION_API_ORIGIN must be a valid HTTPS origin.')
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || isLoopback(parsed.hostname) || parsed.hostname.endsWith('.invalid')) {
    throw new Error('FORMLEE_PRODUCTION_API_ORIGIN must be a confirmed, public HTTPS origin; localhost and placeholders are forbidden as overrides.')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('FORMLEE_PRODUCTION_API_ORIGIN must contain only the HTTPS origin, without credentials, a path, query, or fragment.')
  }
  return parsed.origin
}

function renderManifest(sourceManifest, mode, apiOrigin) {
  const manifest = structuredClone(sourceManifest)
  if (mode === 'production') {
    manifest.host_permissions = manifest.host_permissions.filter(pattern => !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(pattern))
    manifest.content_scripts = manifest.content_scripts.map(script => ({
      ...script,
      matches: script.matches.filter(pattern => !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(pattern)),
    }))
    const apiHostPattern = apiOrigin + '/*'
    if (!manifest.host_permissions.includes(apiHostPattern)) manifest.host_permissions.push(apiHostPattern)
  }
  return manifest
}

function renderConfigSource(source, mode, apiOrigin) {
  const modeNeedle = "const BUILD_MODE = 'development'"
  const apiNeedle = "const DEFAULT_BASE_URL = 'http://localhost:3000'"
  if (!source.includes(modeNeedle) || !source.includes(apiNeedle)) {
    throw new Error('Extension API configuration template changed; update the production build renderer before packaging.')
  }
  return source
    .replace(modeNeedle, `const BUILD_MODE = ${JSON.stringify(mode)}`)
    .replace(apiNeedle, `const DEFAULT_BASE_URL = ${JSON.stringify(apiOrigin)}`)
}

function renderAgentCoreSource(source, mode) {
  const needle = "const BUILD_MODE = 'development'"
  if (!source.includes(needle)) throw new Error('Agent core build-mode marker is missing.')
  if (!/module\.exports\s*=\s*api/.test(source) || !/root\.AgentCore\s*=\s*api/.test(source) || !/root\.RankoraAgentCore\s*=\s*api/.test(source)) {
    throw new Error('Agent core export contract is missing: CommonJS, AgentCore, and RankoraAgentCore exports are required.')
  }
  return source.replace(needle, `const BUILD_MODE = ${JSON.stringify(mode)}`)
}

function validateBuiltAgentCore(coreSource, backgroundSource) {
  if (!/module\.exports\s*=\s*api/.test(coreSource) || !/root\.AgentCore\s*=\s*api/.test(coreSource) || !/root\.RankoraAgentCore\s*=\s*api/.test(coreSource)) {
    throw new Error('Built extension is missing a required shared AgentCore export.')
  }
  const importCall = backgroundSource.match(/importScripts\(([^)]*)\)/)
  const dependencies = importCall?.[1]?.match(/'[^']+'/g)?.map(value => value.slice(1, -1)) ?? []
  const requiredOrder = ['shared/formlee-config.js', 'shared/agent-core.js', 'shared/extension-policy.js', 'credits.js']
  if (requiredOrder.some((dependency, index) => dependencies[index] !== dependency)) {
    throw new Error('Built service worker has an invalid importScripts dependency order; shared/agent-core.js must load before its consumers.')
  }
  if (!/const AgentCore = globalThis\.AgentCore/.test(backgroundSource) || !/Formlee Apply Agent initialization failed: shared AgentCore is unavailable/.test(backgroundSource)) {
    throw new Error('Built service worker is missing the AgentCore initialization check.')
  }
}

function defaultOutputDir(mode) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')
  return path.join(ROOT, 'dist', `formlee-apply-agent-${mode}-${stamp}`)
}

export async function buildExtension({ mode, apiOrigin, outputDir }) {
  if (mode !== 'development' && mode !== 'production') throw new Error('Build mode must be development or production.')
  const normalizedOrigin = mode === 'production'
    ? normalizeProductionOrigin(apiOrigin)
    : 'http://localhost:3000'
  const destination = path.resolve(outputDir || defaultOutputDir(mode))
  if (destination === SOURCE || destination.startsWith(SOURCE + path.sep)) {
    throw new Error('Build output must stay outside the extension source directory.')
  }

  await mkdir(path.dirname(destination), { recursive: true })
  await mkdir(destination)
  for (const name of PACKAGE_FILES) await cp(path.join(SOURCE, name), path.join(destination, name))
  for (const name of PACKAGE_DIRS) await cp(path.join(SOURCE, name), path.join(destination, name), { recursive: true })

  const manifest = renderManifest(JSON.parse(await readFile(path.join(SOURCE, 'manifest.json'), 'utf8')), mode, normalizedOrigin)
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const configPath = path.join(destination, 'shared', 'formlee-config.js')
  const agentCorePath = path.join(destination, 'shared', 'agent-core.js')
  await writeFile(configPath, renderConfigSource(await readFile(configPath, 'utf8'), mode, normalizedOrigin))
  await writeFile(agentCorePath, renderAgentCoreSource(await readFile(agentCorePath, 'utf8'), mode))
  validateBuiltAgentCore(
    await readFile(agentCorePath, 'utf8'),
    await readFile(path.join(destination, 'background.js'), 'utf8')
  )

  const entries = await readdir(destination, { withFileTypes: true })
  return {
    mode,
    apiOrigin: normalizedOrigin,
    configured: mode !== 'production' || normalizedOrigin !== PRODUCTION_ORIGIN_PLACEHOLDER,
    outputDir: destination,
    entries: entries.map(entry => entry.name).sort(),
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode !== 'development' && mode !== 'production') {
    throw new Error('Usage: node scripts/build-extension.mjs <development|production> [output-directory]')
  }
  const outputDir = process.argv[3]
  const result = await buildExtension({
    mode,
    apiOrigin: mode === 'production' ? process.env.FORMLEE_PRODUCTION_API_ORIGIN : undefined,
    outputDir,
  })
  console.log(`Built ${result.mode} extension at ${result.outputDir}`)
  console.log(`API origin: ${result.configured ? result.apiOrigin : `${result.apiOrigin} (deployment placeholder; package fails closed)`}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
