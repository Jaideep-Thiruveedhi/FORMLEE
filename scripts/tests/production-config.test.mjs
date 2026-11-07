import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { validateProductionEnvironment } from '../../src/lib/server-env.mjs'

const ollamaSource = readFileSync(resolve('src/lib/agent/ollama.ts'), 'utf8')
const layoutSource = readFileSync(resolve('src/app/layout.tsx'), 'utf8')
const cssSource = readFileSync(resolve('src/app/globals.css'), 'utf8')
const recognitionAiSource = readFileSync(resolve('src/lib/agent/recognition/ai.ts'), 'utf8')
// Deliberately inspect only the committed example template. Never load .env here.
const environmentExample = readFileSync(resolve('.env.example'), 'utf8')

function parseExampleAssignments(source) {
  return new Map(source.split(/\r?\n/)
    .filter(line => !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=')
      const name = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
      return [name, value]
    }))
}

function validProduction(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app:secret@db.example.invalid:5432/formlee?sslmode=require',
    DIRECT_DATABASE_URL: 'postgresql://app:secret@db.example.invalid:5432/formlee?sslmode=require',
    BETTER_AUTH_SECRET: 'x'.repeat(48),
    BETTER_AUTH_URL: 'https://formlee.example.invalid',
    DOCUMENT_STORAGE_PROVIDER: 'local',
    AGENT_MODEL_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-provider-key',
    OPENROUTER_MODEL: 'example/test-model',
    RANKORA_STORAGE_DIR: '/var/lib/formlee/uploads',
    ...overrides,
  }
}

test('development validation does not require production-only secrets', () => {
  assert.doesNotThrow(() => validateProductionEnvironment({ NODE_ENV: 'development' }))
})

test('environment example documents required production settings with placeholders only', () => {
  const values = parseExampleAssignments(environmentExample)
  const required = [
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'DOCUMENT_STORAGE_PROVIDER',
    'AGENT_MODEL_PROVIDER',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODEL',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ]
  for (const name of required) assert.ok(values.has(name), 'example is missing a required production variable')

  for (const name of [
    'DATABASE_URL', 'DIRECT_DATABASE_URL', 'BETTER_AUTH_SECRET', 'OPENROUTER_API_KEY',
    'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  ]) {
    assert.match(values.get(name), /^REPLACE_WITH_[A-Z0-9_]+$/, 'credential field must use an unmistakable placeholder')
  }
  for (const [name, value] of values) {
    if (/(?:DATABASE_URL|SECRET|TOKEN|API_KEY|ACCESS_KEY)/i.test(name)) {
      assert.match(value, /^REPLACE_WITH_[A-Z0-9_]+$/, 'credential-shaped fields must use unmistakable placeholders')
    }
  }
  assert.equal(values.get('BETTER_AUTH_URL'), 'https://formlee.example.invalid')
  assert.equal(values.get('DOCUMENT_STORAGE_PROVIDER'), 'r2')
  assert.equal(values.get('AGENT_MODEL_PROVIDER'), 'openrouter')
  assert.match(values.get('OPENROUTER_MODEL'), /^REPLACE_WITH_[A-Z0-9_]+\/[A-Z0-9_]+$/)

  const optionalPaymentNames = [
    'NEXT_PUBLIC_RAZORPAY_KEY_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  ]
  for (const name of optionalPaymentNames) {
    assert.match(environmentExample, new RegExp(`^# ${name}=REPLACE_WITH_[A-Z0-9_]+$`, 'm'), 'optional payment fields must be commented placeholders')
    assert.ok(!values.has(name), 'optional payment credentials must be absent by default')
  }

  assert.doesNotMatch(environmentExample, /FORMLEE_STAGING_|CLERK_|UPSTASH_|OLLAMA_/i)
  assert.doesNotMatch(environmentExample, /postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b/i)
})

test('production agent does not silently call the developer-loopback Ollama default', () => {
  assert.match(ollamaSource, /NODE_ENV === 'production' && !configured\) return ''/)
})

test('application typography has no build-time Google Fonts dependency', () => {
  assert.doesNotMatch(layoutSource, /next\/font\/google|fonts\.googleapis/)
  assert.match(cssSource, /--font-sans: ui-sans-serif, system-ui/)
})

test('agent model is loaded on demand to avoid the mapper and tool registry import cycle', () => {
  assert.doesNotMatch(recognitionAiSource, /^import\s+.*callAgentModel.*from\s+['"]@\/lib\/agent\/model['"]/m)
  assert.match(recognitionAiSource, /await import\(['"]@\/lib\/agent\/model['"]\)/)
})

test('production validation identifies missing variable names without echoing values', () => {
  assert.throws(
    () => validateProductionEnvironment({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'private-value' }),
    error => error.message.includes('DATABASE_URL') && !error.message.includes('private-value')
  )
})

test('valid remote TLS production configuration is accepted', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(validProduction()))
  assert.throws(() => validateProductionEnvironment(validProduction({ AGENT_MODEL_PROVIDER: '' })), /AGENT_MODEL_PROVIDER/)
})

test('production database URLs cannot silently target local development databases', () => {
  assert.throws(
    () => validateProductionEnvironment(validProduction({
      DATABASE_URL: 'postgresql://app:secret@localhost:5432/rankora?sslmode=require',
    })),
    /DATABASE_URL must point to the configured remote production database/
  )
})

test('production auth requires a long secret and an HTTPS public origin', () => {
  assert.throws(() => validateProductionEnvironment(validProduction({ BETTER_AUTH_SECRET: 'short' })), /at least 32 characters/)
  assert.throws(() => validateProductionEnvironment(validProduction({ BETTER_AUTH_URL: 'http://formlee.example.invalid' })), /must use https/)
})

test('local document storage must be explicit and configured with a storage path', () => {
  assert.throws(
    () => validateProductionEnvironment(validProduction({ RANKORA_STORAGE_DIR: '' })),
    /RANKORA_STORAGE_DIR must be explicitly set/
  )
})

test('R2 configuration requires its complete server-only credential set', () => {
  assert.throws(
    () => validateProductionEnvironment(validProduction({ DOCUMENT_STORAGE_PROVIDER: 'r2' })),
    /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME/
  )
  assert.doesNotThrow(() => validateProductionEnvironment(validProduction({
    DOCUMENT_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET_NAME: 'formlee-private-test',
  })))
  assert.throws(() => validateProductionEnvironment(validProduction({
    DOCUMENT_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'invalid-account',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET_NAME: 'formlee-private-test',
  })), /32-character Cloudflare account ID/)
  assert.throws(() => validateProductionEnvironment(validProduction({
    DOCUMENT_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET_NAME: 'Invalid Bucket',
  })), /valid lowercase R2 bucket name/)
})

test('Razorpay is either fully disabled or configured consistently', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(validProduction()))
  assert.throws(
    () => validateProductionEnvironment(validProduction({ RAZORPAY_KEY_ID: 'key' })),
    /Razorpay configuration is incomplete/
  )
  assert.throws(
    () => validateProductionEnvironment(validProduction({
      RAZORPAY_KEY_ID: 'server-key',
      RAZORPAY_KEY_SECRET: 'server-secret',
      RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'different-key',
    })),
    /must match the server-side/
  )
})
