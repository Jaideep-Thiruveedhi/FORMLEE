import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { sniffMimeFromBytes } from '@/lib/apply-ai/storage'
import { getStorageProvider } from '@/lib/apply-ai/storage-provider'
import { logInternalApiError } from '@/lib/api-errors'

/**
 * Returns a stored document for its owner only (resolved workspace must match).
 *
 * Both local and R2 providers are read through this authorized handler. The
 * browser never receives bucket credentials, object keys, or signed URLs.
 *
 * Privacy properties:
 *  - files live outside /public and are reachable ONLY through this handler
 *  - the randomized object filename is never exposed; ids are used instead
 *  - responses are `private, no-store` so intermediaries do not cache them
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await requireWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace not initialised' }, { status: 401 })
  }

  const { id } = await params
  const row = await prisma.uploadedDocument.findUnique({ where: { id: id } })
  if (!row || row.workspaceId !== workspaceId || row.deletedAt) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  let bytes: Buffer | null
  try {
    bytes = await getStorageProvider().readObject(workspaceId, row.storedName)
  } catch (error) {
    return NextResponse.json(logInternalApiError('document storage download', error), { status: 503 })
  }
  if (!bytes || bytes.length !== row.sizeBytes || sniffMimeFromBytes(bytes) !== row.mimeType) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="document-${encodeURIComponent(row.id)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
