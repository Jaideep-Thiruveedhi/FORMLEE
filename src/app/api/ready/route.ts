import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json(
      { status: 'ready' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    const rawName = error instanceof Error ? error.name : ''
    const name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(rawName) ? rawName : 'UnknownError'
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined
    console.error('[readiness] database dependency check failed', { name, code })
    return Response.json(
      { status: 'not_ready', dependency: 'database' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
