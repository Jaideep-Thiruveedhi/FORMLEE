import { NextRequest, NextResponse } from 'next/server'
import { getTask } from '@/lib/agent/tasks/orchestrator'

export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const task = await getTask(ref, request)
  if (!task) {
    return NextResponse.json({ error: 'Task not found.', code: 'TASK_NOT_FOUND' }, { status: 404 })
  }
  return NextResponse.json({ task })
}
