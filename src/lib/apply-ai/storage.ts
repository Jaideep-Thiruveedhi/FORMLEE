import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import path from 'node:path'

/**
 * Private local document-storage implementation.
 *
 * Files are stored OUTSIDE the `public/` web directory (default
 * `<project>/storage/uploads`), are never listed by any public path, and are
 * served only through an authorized route handler. The provider abstraction
 * in storage-provider.ts uses these functions locally or sends the same
 * validated bytes to the private R2 bucket in production.
 */

export function getStorageRoot(): string {
  return process.env.RANKORA_STORAGE_DIR ?? path.join(process.cwd(), 'storage', 'uploads')
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
}

export const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS)

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB, generous workspace limit

/**
 * Detects the real file type from magic bytes. Multipart "Content-Type" is
 * declared by the client and cannot be trusted, so acceptance is decided from
 * the bytes themselves (JPEG / PNG / PDF only).
 */
export function sniffMimeFromBytes(bytes: Buffer): string | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const hasIhdr = bytes.subarray(12, 16).toString('latin1') === 'IHDR'
    const hasIend = bytes.includes(Buffer.from('IEND'))
    if (hasIhdr && hasIend && imageDimensionsFromBytes(bytes)) return 'image/png'
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (bytes.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 0 && imageDimensionsFromBytes(bytes)) {
      return 'image/jpeg'
    }
  }
  if (
    bytes.length >= 10 &&
    bytes.subarray(0, 5).toString('latin1') === '%PDF-' &&
    bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1').includes('%%EOF')
  ) {
    return 'application/pdf'
  }
  return null
}

/** Confirms the declared type, byte signature and server-side byte limit agree. */
export function validateDocumentUploadBytes(declaredMimeType: string, bytes: Buffer): string | null {
  const normalizedDeclared = declaredMimeType.toLowerCase().split(';')[0].trim()
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null
  if (!ALLOWED_MIME_TYPES.includes(normalizedDeclared)) return null
  const detected = sniffMimeFromBytes(bytes)
  return detected === normalizedDeclared ? detected : null
}

function sanitizePathSegment(value: string): string {
  // Strip any path separators / traversal characters defensively.
  return path.basename(value.replace(/\\/g, '/'))
}

export function extensionForMime(mimeType: string): string | null {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? null
}

/** Saves bytes under a random filename inside the private storage root. */
export async function saveDocumentBytes(
  workspaceId: string,
  mimeType: string,
  bytes: Buffer
): Promise<string> {
  const ext = extensionForMime(mimeType)
  const storedName = sanitizePathSegment(`${randomUUID()}${ext ?? ''}`)
  const workspaceDir = path.join(/*turbopackIgnore: true*/ getStorageRoot(), sanitizePathSegment(workspaceId))
  await mkdir(workspaceDir, { recursive: true })
  const abs = resolveStoredPath(workspaceId, storedName)
  await writeFile(abs, bytes)
  return storedName
}

/** Resolves a stored filename to an absolute path strictly inside the root. */
export function resolveStoredPath(workspaceId: string, storedName: string): string {
  // The storage root is intentionally dynamic (RANKORA_STORAGE_DIR support);
  // opt out of Turbopack's whole-project tracing for this call.
  const root = path.resolve(/*turbopackIgnore: true*/ getStorageRoot())
  const abs = path.resolve(root, sanitizePathSegment(workspaceId), sanitizePathSegment(storedName))
  if (!abs.startsWith(root + path.sep)) {
    throw new Error('Invalid storage path')
  }
  return abs
}

/**
 * Reports whether the backing file still exists. Row metadata can outlive the
 * file (manual cleanup, lost volume); callers must answer 404 instead of
 * streaming a path that no longer exists.
 */
export async function storedFileExists(workspaceId: string, storedName: string): Promise<boolean> {
  try {
    return (await stat(resolveStoredPath(workspaceId, storedName))).isFile()
  } catch {
    return false
  }
}

/** Opens a stored file as a web ReadableStream for response streaming. */
export function openStoredFileAsStream(workspaceId: string, storedName: string): ReadableStream {
  const nodeStream = createReadStream(resolveStoredPath(workspaceId, storedName))
  return Readable.toWeb(nodeStream) as unknown as ReadableStream
}

export async function deleteStoredFile(workspaceId: string, storedName: string): Promise<void> {
  await unlink(resolveStoredPath(workspaceId, storedName)).catch(() => {
    // Missing files are not an error for cleanup purposes.
  })
}

/** Reads a stored file into memory. Caller must authorize access first. */
export async function readStoredFileBytes(workspaceId: string, storedName: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveStoredPath(workspaceId, storedName))
  } catch {
    return null
  }
}

export function readStoredFileBytesSync(workspaceId: string, storedName: string): Buffer | null {
  try {
    return readFileSync(resolveStoredPath(workspaceId, storedName))
  } catch {
    return null
  }
}

/**
 * Parses image dimensions from PNG or JPEG bytes without external dependencies.
 * Returns null for other formats or on failure.
 */
export function imageDimensionsFromBytes(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // PNG: IHDR width/height are at offset 16 (big-endian).
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width > 0 && height > 0 && width < 100_000 && height < 100_000) {
      return { width, height }
    }
    return null
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // JPEG: scan markers for SOF0 (0xc0), SOF1 (0xc1), SOF2 (0xc2).
    let offset = 2
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = bytes[offset + 1]
      if (marker === 0xd9 || marker === 0xda) break // EOI or SOS
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = bytes.readUInt16BE(offset + 5)
        const width = bytes.readUInt16BE(offset + 7)
        if (width > 0 && height > 0 && width < 100_000 && height < 100_000) {
          return { width, height }
        }
        return null
      }
      const segmentLength = bytes.readUInt16BE(offset + 2)
      offset += 2 + segmentLength
    }
    return null
  }

  return null
}

export async function imageDimensionsForDocument(
  workspaceId: string,
  storedName: string
): Promise<{ width: number; height: number } | null> {
  const bytes = await readStoredFileBytes(workspaceId, storedName)
  if (!bytes) return null
  return imageDimensionsFromBytes(bytes)
}
