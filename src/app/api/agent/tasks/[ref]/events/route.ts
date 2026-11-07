import { NextRequest, NextResponse } from 'next/server'
import { getTaskEvents } from '@/lib/agent/tasks/orchestrator'

export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const events = await getTaskEvents(ref, request)
  return NextResponse.json({ events })
}
