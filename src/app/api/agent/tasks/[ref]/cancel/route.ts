import { NextRequest, NextResponse } from 'next/server'
import { cancelAgentTask } from '@/lib/agent/tasks/orchestrator'

export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const result = await cancelAgentTask(ref, request)
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.errorCode)
  return NextResponse.json(result, { status })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'TASK_NOT_FOUND':
      return 404
    default:
      return 500
  }
}
