/**
 * Phase 6 — AI Task Planner.
 *
 * Uses the existing Phase 5 model adapter to turn a student objective into a
 * validated, ordered plan of registered tool calls. The server independently
 * validates every step: unknown tools, malformed arguments, invented
 * permissions or approval references are rejected.
 *
 * Privacy contract:
 *  - The objective is the only student-supplied text sent to the model.
 *  - No vault values, documents or tokens appear in planning prompts.
 *  - The planner only exposes tool names, descriptions and input schemas.
 */

import { z } from 'zod'
import { callAgentModel, type AgentMessage } from '@/lib/agent/model'
import { listModelToolDefinitions, getToolDefinition } from '@/lib/agent/tools/registry'
import type { TaskPlan, TaskPlanStep } from './types'
import { DEFAULT_TASK_LIMITS } from './limits'
import { parsePlanJson, type ParsedPlanningResponse } from './plan-parser'

function buildPlanningPrompt(objective: string): AgentMessage[] {
  // Task-lifecycle tools are handled by the chat/assist layer, not by plans
  // inside a task, to avoid recursive task creation.
  const EXCLUDED_FROM_PLANS = new Set(['create_agent_task', 'resume_agent_task', 'list_agent_tasks', 'get_agent_task'])
  const tools = listModelToolDefinitions().filter(def => !EXCLUDED_FROM_PLANS.has(def.name))
  const toolDescriptions = tools
    .map(def => {
      const schema = def.inputSchema instanceof z.ZodType ? zodToJsonSchema(def.inputSchema) : { type: 'object' }
      return [
        `- ${def.name}: ${def.description}`,
        `  environment: ${def.environment}`,
        `  permissions: ${def.permissions.join(', ')}`,
        `  input schema: ${JSON.stringify(schema)}`,
      ].join('\n')
    })
    .join('\n\n')

  const system = [
    'You are Formlee, a careful exam-application assistant. The student has given you an objective.',
    'Create a sequential plan using ONLY the registered tools below.',
    '',
    'Registered tools:\n' + toolDescriptions,
    '',
    'Rules:',
    '- Use only tool names listed above. Never invent tools.',
    '- Every step must have a toolName, description and valid args matching the tool input schema.',
    '- Mark requiresStudentApproval: true for any step that reads, writes or verifies the browser page.',
    '- Never plan field approvals, fills or verification. Those operations are initiated from the student review controls only.',
    '- Never include approval references, permission names, workspace ids, user ids, or secrets in args.',
    '- Keep the plan sequential; do not propose parallel steps.',
    '- Respond with JSON only: {"explanation":"...","steps":[{"toolName":"...","description":"...","args":{},"requiresStudentApproval":false}]}',
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: `Objective: ${objective}\n\nReturn a JSON plan.` },
  ]
}

function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  try {
    const anySchema = schema as unknown as { toJSONSchema?: () => unknown }
    if (typeof anySchema.toJSONSchema === 'function') {
      return anySchema.toJSONSchema()
    }
  } catch {
    // fall through
  }
  return { type: 'object' }
}

export interface PlanResult {
  ok: true
  plan: TaskPlan
  nativeToolSupport: boolean
}

export interface PlanError {
  ok: false
  error: string
  code: string
}

/**
 * Ask the model for a plan and validate it against the registry. Retries a
 * bounded number of times if the output is malformed or contains invalid tool
 * references, but reports failure honestly rather than fabricating a plan.
 */
export async function planTask(objective: string, signal?: AbortSignal, sensitiveValues: string[] = []): Promise<PlanResult | PlanError> {
  const messages = buildPlanningPrompt(objective)
  // Hosted completions may incur a charge even when their JSON is malformed.
  // Keep Ollama's existing bounded repair loop, but never make a second
  // OpenRouter request just to repair a response shape.
  const hostedProvider = process.env.NODE_ENV === 'production' || process.env.AGENT_MODEL_PROVIDER?.trim().toLowerCase() === 'openrouter'
  const maxAttempts = hostedProvider ? 1 : DEFAULT_TASK_LIMITS.maxPlanningIterations

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // This planner consumes a JSON plan, not native tool calls. Keep the
    // provider request aligned with that contract instead of implicitly
    // attaching the general agent's tool registry.
    const response = await callAgentModel({
      messages,
      signal,
      sensitiveValues,
      tools: [],
      responseFormat: { type: 'json_object' },
    })
    if (!response.ok) {
      return { ok: false, error: response.error ?? 'Model planning failed.', code: response.errorCode ?? 'MODEL_ERROR' }
    }

    const rawText = response.text
    if (!rawText) {
      if (response.toolCalls.length > 0) {
        return { ok: false, error: 'Model returned tool calls during planning instead of a plan JSON.', code: 'PLAN_MALFORMED' }
      }
      continue
    }

    const parsed = parsePlanJson(rawText, DEFAULT_TASK_LIMITS.maxStepsPerTask)
    if (!parsed.success) {
      if (hostedProvider) {
        return { ok: false, error: 'OpenRouter returned text that was not a valid task plan. Shorten or clarify the task and try again.', code: 'PLAN_MALFORMED' }
      }
      continue
    }

    const validation = validatePlan(parsed.data)
    if (!validation.ok) {
      return validation
    }

    return {
      ok: true,
      plan: validation.plan,
      nativeToolSupport: response.nativeToolSupport,
    }
  }

  return { ok: false, error: 'Could not produce a valid plan after multiple attempts.', code: 'PLAN_FAILED' }
}

function validatePlan(data: ParsedPlanningResponse): PlanResult | PlanError {
  const steps: TaskPlanStep[] = []

  for (let i = 0; i < data.steps.length; i++) {
    const step = data.steps[i]
    if (['request_student_approval', 'execute_approved_field_fills', 'verify_filled_fields'].includes(step.toolName)) {
      return { ok: false, error: `${step.toolName} must be initiated by the student in the Side Panel.`, code: 'STUDENT_ACTION_REQUIRED' }
    }
    const definition = getToolDefinition(step.toolName)
    if (!definition) {
      return { ok: false, error: `Plan references unknown tool: ${step.toolName}`, code: 'UNKNOWN_TOOL_IN_PLAN' }
    }

    const argValidation = definition.inputSchema.safeParse(step.args ?? {})
    if (!argValidation.success) {
      const issues = argValidation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      return { ok: false, error: `Invalid args for ${step.toolName}: ${issues}`, code: 'PLAN_VALIDATION_ERROR' }
    }

    // Browser tools always pause for student involvement in the extension.
    const requiresApproval =
      step.requiresStudentApproval === true ||
      definition.environment === 'browser'

    if (step.dependsOn !== undefined && step.dependsOn >= i) {
      return { ok: false, error: `Step ${i} depends on a later or same step.`, code: 'PLAN_DEPENDENCY_ERROR' }
    }

    steps.push({
      stepIndex: i,
      toolName: step.toolName,
      description: step.description,
      args: argValidation.data as Record<string, unknown>,
      dependsOn: step.dependsOn,
      requiresStudentApproval: requiresApproval,
    })
  }

  return { ok: true, plan: { explanation: data.explanation, steps }, nativeToolSupport: false }
}
