import { z } from 'zod'

export interface ParsedPlanningResponse {
  explanation: string
  steps: Array<{
    toolName: string
    description: string
    args?: Record<string, unknown>
    dependsOn?: number
    requiresStudentApproval?: boolean
  }>
}

function planningResponseSchema(maxSteps: number) {
  return z.object({
    explanation: z.string().min(1).max(2000),
    steps: z.array(
      z.object({
        toolName: z.string().min(1).max(80),
        description: z.string().min(1).max(500),
        args: z.record(z.string(), z.unknown()).optional(),
        dependsOn: z.number().int().min(0).optional(),
        requiresStudentApproval: z.boolean().optional(),
      })
    ).max(maxSteps),
  })
}

export function parsePlanJson(
  raw: string,
  maxSteps = 20
): { success: true; data: ParsedPlanningResponse } | { success: false } {
  const cleaned = raw.trim()
  if (!cleaned) return { success: false }

  const codeFence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(cleaned)
  const text = codeFence ? codeFence[1].trim() : cleaned

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = /\{[\s\S]*\}/.exec(text)
    if (!match) return { success: false }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return { success: false }
    }
  }

  const result = planningResponseSchema(maxSteps).safeParse(parsed)
  if (!result.success) return { success: false }
  return { success: true, data: result.data }
}
