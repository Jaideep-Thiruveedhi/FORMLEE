import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAgentTask, listAgentTasks } from '@/lib/agent/tasks/orchestrator'

const createSchema = z.object({
  objective: z.string().min(1).max(500),
  applicationId: z.string().max(64).optional(),
  expiresInMinutes: z.number().int().min(1).max(24 * 60).optional(),
})

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as unknown
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const result = await createAgentTask({
    request,
    objective: parsed.data.objective,
    applicationId: parsed.data.applicationId,
    expiresInMinutes: parsed.data.expiresInMinutes,
  })
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.errorCode)
  return NextResponse.json(result, { status })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? undefined
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 50)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)
  const tasks = await listAgentTasks(request, { status, limit, offset })
  return NextResponse.json({ tasks })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'PERMISSION_DENIED':
      return 403
    default:
      return 500
  }
}
