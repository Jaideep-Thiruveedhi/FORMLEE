import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

register(pathToFileURL(path.resolve('scripts/tests/support/ts-extension-loader.mjs')).href, import.meta.url)

const { createR2StorageProvider, getStorageProvider, getStorageProviderId } = await import(
  pathToFileURL(path.resolve('src/lib/apply-ai/storage-provider.ts')).href
)
const { MAX_UPLOAD_BYTES, sniffMimeFromBytes, validateDocumentUploadBytes } = await import(
  pathToFileURL(path.resolve('src/lib/apply-ai/storage.ts')).href
)

const WORKSPACE_ID = 'a'.repeat(64)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xuoAAAAASUVORK5CYII=',
  'base64'
)
const R2_ENV = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET_NAME: 'formlee-private-test',
}

function mockedR2(env = R2_ENV) {
  const state = { configuration: null, commands: [], bytes: PNG, failPut: null, failDelete: null }
  const provider = createR2StorageProvider(env, configuration => {
    state.configuration = configuration
    return {
      async send(command) {
        state.commands.push(command)
        const name = command.constructor.name
        if (name === 'PutObjectCommand') {
          if (state.failPut) throw state.failPut
          state.bytes = Buffer.from(command.input.Body)
          return { ETag: '"private-test"' }
        }
        if (name === 'GetObjectCommand') {
          if (state.readError) throw state.readError
          return { Body: { transformToByteArray: async () => Uint8Array.from(state.bytes) } }
        }
        if (name === 'DeleteObjectCommand') {
          if (state.failDelete) throw state.failDelete
          state.bytes = null
          return {}
        }
        throw new Error(`Unexpected command ${name}`)
      },
    }
  })
  return { provider, state }
}

test('R2 client uses the account endpoint, auto region, path style and no public endpoint', async () => {
  const { provider, state } = mockedR2()
  assert.equal(provider.id, 'r2')
  assert.equal(state.configuration.region, 'auto')
  assert.equal(state.configuration.endpoint, `https://${R2_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
  assert.equal(state.configuration.forcePathStyle, true)
  assert.deepEqual(state.configuration.credentials, {
    accessKeyId: R2_ENV.R2_ACCESS_KEY_ID,
    secretAccessKey: R2_ENV.R2_SECRET_ACCESS_KEY,
  })
})

test('R2 upload generates an opaque workspace-scoped key and stores private content metadata', async () => {
  const { provider, state } = mockedR2()
  const storedName = await provider.saveObject(WORKSPACE_ID, 'image/png', PNG)
  const command = state.commands[0]
  assert.equal(command.constructor.name, 'PutObjectCommand')
  assert.equal(command.input.Bucket, R2_ENV.R2_BUCKET_NAME)
  assert.equal(command.input.Key, `workspaces/${WORKSPACE_ID}/${storedName}`)
  assert.match(storedName, /^[a-f0-9-]{36}\.png$/)
  assert.equal(command.input.ContentType, 'image/png')
  assert.equal(command.input.ContentLength, PNG.length)
  assert.equal(command.input.CacheControl, 'private, no-store')
  assert.deepEqual(command.input.Body, PNG)
})

test('the same object filename resolves to different keys for different workspaces', async () => {
  const { provider, state } = mockedR2()
  const storedName = await provider.saveObject(WORKSPACE_ID, 'image/png', PNG)
  await provider.readObject('b'.repeat(64), storedName)
  const reads = state.commands.filter(command => command.constructor.name === 'GetObjectCommand')
  assert.equal(reads.length, 1)
  assert.equal(reads[0].input.Key, `workspaces/${'b'.repeat(64)}/${storedName}`)
  assert.notEqual(reads[0].input.Key, state.commands[0].input.Key)
})

test('R2 retrieval returns bytes and private deletion is retry-safe', async () => {
  const { provider, state } = mockedR2()
  const storedName = await provider.saveObject(WORKSPACE_ID, 'image/png', PNG)
  assert.deepEqual(await provider.readObject(WORKSPACE_ID, storedName), PNG)

  await provider.deleteObject(WORKSPACE_ID, storedName)
  await provider.deleteObject(WORKSPACE_ID, storedName)
  assert.deepEqual(state.commands.slice(-2).map(command => command.constructor.name), [
    'DeleteObjectCommand',
    'DeleteObjectCommand',
  ])
})

test('failed R2 deletion can be retried with the exact same validated object key', async () => {
  const { provider, state } = mockedR2()
  const storedName = await provider.saveObject(WORKSPACE_ID, 'image/png', PNG)
  state.failDelete = Object.assign(new Error('temporary outage'), { code: 'ECONNRESET' })
  await assert.rejects(provider.deleteObject(WORKSPACE_ID, storedName), /temporary outage/)
  state.failDelete = null
  await provider.deleteObject(WORKSPACE_ID, storedName)
  const deletes = state.commands.filter(command => command.constructor.name === 'DeleteObjectCommand')
  assert.equal(deletes.length, 2)
  assert.equal(deletes[0].input.Key, deletes[1].input.Key)
})

test('missing R2 objects return null while other read failures are surfaced', async () => {
  const { provider, state } = mockedR2()
  state.readError = Object.assign(new Error('gone'), { name: 'NoSuchKey' })
  assert.equal(await provider.readObject(WORKSPACE_ID, `${'b'.repeat(8)}-${'c'.repeat(4)}-4${'d'.repeat(3)}-8${'e'.repeat(3)}-${'f'.repeat(12)}.png`), null)

  state.readError = Object.assign(new Error('unavailable'), { code: 'ECONNRESET' })
  await assert.rejects(
    provider.readObject(WORKSPACE_ID, `${'b'.repeat(8)}-${'c'.repeat(4)}-4${'d'.repeat(3)}-8${'e'.repeat(3)}-${'f'.repeat(12)}.png`),
    /unavailable/
  )
})

test('R2 configuration rejects missing credentials, invalid account ids and invalid bucket names', () => {
  assert.throws(() => createR2StorageProvider({}), /R2_ACCOUNT_ID/)
  assert.throws(() => createR2StorageProvider({ ...R2_ENV, R2_ACCOUNT_ID: 'not-an-account' }), /32-character Cloudflare account ID/)
  assert.throws(() => createR2StorageProvider({ ...R2_ENV, R2_BUCKET_NAME: 'Invalid Bucket' }), /valid lowercase R2 bucket name/)
  assert.throws(() => createR2StorageProvider({ ...R2_ENV, R2_SECRET_ACCESS_KEY: '' }), /R2_SECRET_ACCESS_KEY/)
})

test('R2 refuses path traversal, foreign-shaped workspace ids and unsupported content types', async () => {
  const { provider, state } = mockedR2()
  await assert.rejects(provider.readObject(WORKSPACE_ID, '../outside.png'), /Invalid document object key/)
  await assert.rejects(provider.readObject('student@example.com', '00000000-0000-4000-8000-000000000000.png'), /Invalid document workspace identifier/)
  await assert.rejects(provider.saveObject(WORKSPACE_ID, 'text/html', Buffer.from('<html>')),
    /Unsupported document content type/)
  assert.equal(state.commands.length, 0)
})

test('document upload validation enforces real signatures, matching MIME and the 5 MB limit', () => {
  assert.equal(sniffMimeFromBytes(PNG), 'image/png')
  assert.equal(validateDocumentUploadBytes('image/png', PNG), 'image/png')
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x01, 0x11, 0x00, 0xff, 0xd9,
  ])
  assert.equal(validateDocumentUploadBytes('image/jpeg', jpeg), 'image/jpeg')
  assert.equal(validateDocumentUploadBytes('application/pdf', Buffer.from('%PDF-1.7\nbody\n%%EOF')), 'application/pdf')
  assert.equal(validateDocumentUploadBytes('application/pdf', PNG), null)
  assert.equal(validateDocumentUploadBytes('image/png', Buffer.from('<html>')), null)
  assert.equal(validateDocumentUploadBytes('image/png', Buffer.alloc(MAX_UPLOAD_BYTES + 1)), null)
})

test('interrupted R2 writes propagate failure and do not return an object key', async () => {
  const { provider, state } = mockedR2()
  state.failPut = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
  await assert.rejects(provider.saveObject(WORKSPACE_ID, 'image/png', PNG), /socket closed/)
  assert.equal(state.commands.filter(command => command.constructor.name === 'PutObjectCommand').length, 1)
})

test('local development storage remains available without R2 credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'formlee-storage-test-'))
  const previous = {
    provider: process.env.DOCUMENT_STORAGE_PROVIDER,
    storageRoot: process.env.RANKORA_STORAGE_DIR,
    nodeEnv: process.env.NODE_ENV,
    r2: Object.fromEntries(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
      .map(name => [name, process.env[name]])),
  }
  t.after(async () => {
    if (previous.provider === undefined) delete process.env.DOCUMENT_STORAGE_PROVIDER
    else process.env.DOCUMENT_STORAGE_PROVIDER = previous.provider
    if (previous.storageRoot === undefined) delete process.env.RANKORA_STORAGE_DIR
    else process.env.RANKORA_STORAGE_DIR = previous.storageRoot
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
    for (const [name, value] of Object.entries(previous.r2)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(root, { recursive: true, force: true })
  })

  process.env.NODE_ENV = 'development'
  process.env.DOCUMENT_STORAGE_PROVIDER = 'local'
  process.env.RANKORA_STORAGE_DIR = root
  delete process.env.R2_ACCOUNT_ID
  delete process.env.R2_ACCESS_KEY_ID
  delete process.env.R2_SECRET_ACCESS_KEY
  delete process.env.R2_BUCKET_NAME

  assert.equal(getStorageProviderId(), 'local')
  const provider = getStorageProvider()
  const storedName = await provider.saveObject(WORKSPACE_ID, 'image/png', PNG)
  assert.deepEqual(await provider.readObject(WORKSPACE_ID, storedName), PNG)
  await provider.deleteObject(WORKSPACE_ID, storedName)
  assert.equal(await provider.readObject(WORKSPACE_ID, storedName), null)
})

test('R2 provider and SDK client are reused across requests in the process', t => {
  const names = ['DOCUMENT_STORAGE_PROVIDER', 'NODE_ENV', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  process.env.NODE_ENV = 'development'
  process.env.DOCUMENT_STORAGE_PROVIDER = 'r2'
  for (const [name, value] of Object.entries(R2_ENV)) process.env[name] = value
  const first = getStorageProvider()
  assert.equal(first, getStorageProvider())
  assert.equal(first.id, 'r2')
})

test('storage provider defaults locally only in development and rejects unknown values', () => {
  const previous = { provider: process.env.DOCUMENT_STORAGE_PROVIDER, nodeEnv: process.env.NODE_ENV }
  try {
    process.env.NODE_ENV = 'development'
    delete process.env.DOCUMENT_STORAGE_PROVIDER
    assert.equal(getStorageProviderId(), 'local')
    process.env.DOCUMENT_STORAGE_PROVIDER = 'minio'
    assert.throws(() => getStorageProviderId(), /must be either local or r2/)
    process.env.NODE_ENV = 'production'
    delete process.env.DOCUMENT_STORAGE_PROVIDER
    assert.throws(() => getStorageProviderId(), /must be explicitly set in production/)
  } finally {
    if (previous.provider === undefined) delete process.env.DOCUMENT_STORAGE_PROVIDER
    else process.env.DOCUMENT_STORAGE_PROVIDER = previous.provider
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.nodeEnv
  }
})

test('private file routes authorize workspace ownership before storage reads and legacy finalization is disabled', async () => {
  const fileRoute = await readFile(path.resolve('src/app/api/apply/documents/[id]/file/route.ts'), 'utf8')
  const deleteRoute = await readFile(path.resolve('src/app/api/apply/documents/[id]/route.ts'), 'utf8')
  const uploadRoute = await readFile(path.resolve('src/app/api/apply/documents/route.ts'), 'utf8')
  const finalizeRoute = await readFile(path.resolve('src/app/api/apply/documents/finalize/route.ts'), 'utf8')

  assert.ok(fileRoute.indexOf('requireWorkspaceId()') < fileRoute.indexOf('findUnique'))
  assert.match(fileRoute, /row\.workspaceId !== workspaceId/)
  assert.match(fileRoute, /readObject\(workspaceId, row\.storedName\)/)
  assert.doesNotMatch(fileRoute, /generateDownloadUrl|NextResponse\.redirect/)
  assert.match(fileRoute, /Content-Disposition': `attachment/)
  assert.match(deleteRoute, /row\.deletedAt/)
  assert.match(deleteRoute, /document deletion retry/)
  assert.match(deleteRoute, /storage\.deleteObject\(workspaceId, row\.storedName\)/)
  assert.match(uploadRoute, /validateDocumentUploadBytes\(mimeType, bytes\)/)
  assert.match(uploadRoute, /saveObject\(workspaceId, sniffedMime, bytes\)/)
  assert.match(finalizeRoute, /status: 410/)
})
