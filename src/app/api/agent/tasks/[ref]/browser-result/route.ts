import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { submitTaskBrowserResult } from '@/lib/agent/tasks/orchestrator'

const resultSchema = z.object({
  actionId: z.string().min(1),
  result: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    code: z.string().optional(),
    data: z.unknown().optional(),
  }),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const body = (await request.json().catch(() => null)) as unknown
  const parsed = resultSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid browser result body.', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const result = await submitTaskBrowserResult(ref, parsed.data.actionId, parsed.data.result, request)
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.errorCode)
  return NextResponse.json(result, { status })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'TASK_NOT_FOUND':
      return 404
    case 'STALE_ACTION':
      return 409
    default:
      return 500
  }
}
