import { NextRequest, NextResponse } from 'next/server'
import { planTask } from '@/lib/agent/tasks/orchestrator'

export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const result = await planTask(ref, request)
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.errorCode)
  return NextResponse.json(result, { status })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
      return 401
    case 'TASK_NOT_FOUND':
      return 404
    case 'TASK_NOT_PLANNABLE':
      return 409
    case 'PLAN_FAILED':
    case 'UNKNOWN_TOOL_IN_PLAN':
    case 'PLAN_VALIDATION_ERROR':
    case 'PLAN_DEPENDENCY_ERROR':
    case 'PLAN_DUPLICATE_FILL':
    case 'PLAN_APPROVAL_ORDER':
      return 422
    default:
      return 500
  }
}
