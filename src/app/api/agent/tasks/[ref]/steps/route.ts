import { NextRequest, NextResponse } from 'next/server'
import { getTaskSteps } from '@/lib/agent/tasks/orchestrator'

export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const steps = await getTaskSteps(ref, request)
  return NextResponse.json({ steps })
}
