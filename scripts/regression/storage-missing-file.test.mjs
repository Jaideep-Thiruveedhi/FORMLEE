import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resolveStoredPath,
  saveDocumentBytes,
  storedFileExists,
} from '../../src/lib/apply-ai/storage.ts'

/**
 * Regression: document rows can outlive their private files. The download
 * route must be able to detect this before streaming, so a missing file is a
 * controlled 404 instead of an unhandled read-stream failure.
 */
test('storedFileExists distinguishes present from missing private files', async () => {
  const previousRoot = process.env.RANKORA_STORAGE_DIR
  const root = await mkdtemp(path.join(os.tmpdir(), 'formly-storage-test-'))
  process.env.RANKORA_STORAGE_DIR = root
  const workspaceId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  try {
    const storedName = await saveDocumentBytes(
      workspaceId,
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )

    assert.equal(await storedFileExists(workspaceId, storedName), true)
    assert.equal(await storedFileExists(workspaceId, 'missing-file.pdf'), false)

    await rm(resolveStoredPath(workspaceId, storedName))
    assert.equal(await storedFileExists(workspaceId, storedName), false)
  } finally {
    if (previousRoot === undefined) delete process.env.RANKORA_STORAGE_DIR
    else process.env.RANKORA_STORAGE_DIR = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
