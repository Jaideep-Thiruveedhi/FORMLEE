import { NextRequest, NextResponse } from 'next/server'
import { startTask, resumeAgentTask } from '@/lib/agent/tasks/orchestrator'

export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const body = (await request.json().catch(() => ({}))) as { resume?: boolean }
  const runner = body.resume === true ? resumeAgentTask : startTask
  const result = await runner(ref, request)
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.errorCode)
  return NextResponse.json(result, { status })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'TASK_NOT_FOUND':
      return 404
    case 'TASK_NOT_EXECUTABLE':
    case 'TASK_NOT_RESUMABLE':
    case 'TASK_EXPIRED':
    case 'STALE_ACTION':
      return 409
    case 'TOOL_CALL_LIMIT':
    case 'NO_STEPS':
      return 422
    default:
      return 500
  }
}
