import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireWorkspaceId } from '@/lib/apply-ai/workspace'
import { documentRowToDTO } from '@/lib/apply-ai/server-data'

/**
 * Authorized version history for one document. Older files remain in private
 * storage after a replacement and can be inspected by the owner only. The
 * response contains metadata — never file bytes — and other workspaces always
 * receive the same 404 as an unknown id.
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
  const row = await prisma.uploadedDocument.findUnique({ where: { id } })
  if (!row || row.workspaceId !== workspaceId || row.deletedAt) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const chain = [row]
  let cursor = row.supersedesId
  let guard = 0
  while (cursor && guard < 25) {
    const previous = await prisma.uploadedDocument.findUnique({ where: { id: cursor } })
    if (!previous || previous.workspaceId !== workspaceId || previous.deletedAt) break
    chain.push(previous)
    cursor = previous.supersedesId
    guard += 1
  }

  return NextResponse.json({
    documents: chain.map((item, index) =>
      documentRowToDTO(item, item.supersedesId !== null || index > 0)
    ),
  })
}
