/**
 * Agent Tool Registry — central definitions.
 *
 * Each entry binds a human-readable tool name to its Zod input/output schemas,
 * required permissions, timeout and handler. The registry itself is dumb: all
 * enforcement (validation, authz, audit, timeouts) lives in the executor.
 */

import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolResult } from './types'
import {
  AGENT_PERMISSIONS,
  isStudentActionTool,
  type AgentPermission,
} from './permissions'
import * as handlers from './handlers'
import {
  emptyInputSchema,
  getStudentProfileSectionInputSchema,
  applicationIdInputSchema,
  optionalApplicationIdInputSchema,
  detectSupportedExamInputSchema,
  scanSupportedApplicationPageInputSchema,
  mapApplicationFieldsInputSchema,
  generateFieldPreviewInputSchema,
  getFieldMappingConflictsInputSchema,
  requestStudentApprovalInputSchema,
  executeApprovedFieldFillsInputSchema,
  verifyFilledFieldsInputSchema,
  tabRefInputSchema,
  listAgentTasksInputSchema,
  getAgentTaskInputSchema,
  createAgentTaskInputSchema,
  resumeAgentTaskInputSchema,
} from './schemas'

const okResultSchema = z.object({
  ok: z.literal(true),
  data: z.any().optional(),
  browserAction: z.any().optional(),
})

function tool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny = typeof okResultSchema>(def: {
  name: string
  description: string
  environment: 'server' | 'browser'
  permissions: AgentPermission[]
  inputSchema: TInput
  outputSchema?: TOutput
  timeoutMs?: number
  handler: (context: ToolContext, args: z.infer<TInput>) => Promise<ToolResult> | ToolResult
}): ToolDefinition<TInput, TOutput> {
  return {
    ...def,
    timeoutMs: def.timeoutMs ?? 15000,
    outputSchema: def.outputSchema ?? (okResultSchema as unknown as TOutput),
  } as ToolDefinition<TInput, TOutput>
}

export const AGENT_TOOL_REGISTRY = new Map<string, ToolDefinition>([
  // Student Vault
  [
    'get_student_profile_summary',
    tool({
      name: 'get_student_profile_summary',
      description: 'Redacted summary of the saved Student Information Vault (completion status, missing labels, document count). No raw values.',
      environment: 'server',
      permissions: ['READ_PROFILE'],
      inputSchema: emptyInputSchema,
      handler: handlers.getStudentProfileSummary,
    }),
  ],
  [
    'get_student_profile_section',
    tool({
      name: 'get_student_profile_section',
      description: 'Presence status for each field in one profile section (personal, family, address, class10, class12, category, preferences).',
      environment: 'server',
      permissions: ['READ_PROFILE'],
      inputSchema: getStudentProfileSectionInputSchema,
      handler: handlers.getStudentProfileSection,
    }),
  ],
  [
    'list_uploaded_documents',
    tool({
      name: 'list_uploaded_documents',
      description: 'List uploaded document metadata (type, label, MIME type, size) without contents or certificate numbers.',
      environment: 'server',
      permissions: ['READ_DOCUMENT_METADATA'],
      inputSchema: emptyInputSchema,
      handler: handlers.listUploadedDocuments,
    }),
  ],

  // Application Hub
  [
    'get_application_details',
    tool({
      name: 'get_application_details',
      description: 'Read one tracked application row and its catalog-derived DTO, scoped to the workspace.',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: applicationIdInputSchema,
      handler: handlers.getApplicationDetails,
    }),
  ],
  [
    'get_application_readiness',
    tool({
      name: 'get_application_readiness',
      description: 'Readiness evaluation for one or all tracked applications (missing profile/document labels, next action).',
      environment: 'server',
      permissions: ['READ_APPLICATION', 'READ_DEADLINES'],
      inputSchema: optionalApplicationIdInputSchema,
      handler: handlers.getApplicationReadiness,
    }),
  ],
  [
    'get_application_checklist',
    tool({
      name: 'get_application_checklist',
      description: 'Return the manual checklist for one tracked application.',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: applicationIdInputSchema,
      handler: handlers.getApplicationChecklist,
    }),
  ],
  [
    'get_application_deadlines',
    tool({
      name: 'get_application_deadlines',
      description: 'Return deadline snapshots for one or all tracked applications.',
      environment: 'server',
      permissions: ['READ_APPLICATION', 'READ_DEADLINES'],
      inputSchema: optionalApplicationIdInputSchema,
      handler: handlers.getApplicationDeadlines,
    }),
  ],

  // Examination assistant
  [
    'get_active_tab_context',
    tool({
      name: 'get_active_tab_context',
      description: 'Ask the Chrome extension to report the active browser tab URL and title. Server cannot read tabs.',
      environment: 'browser',
      permissions: ['SCAN_SUPPORTED_PAGE'],
      inputSchema: tabRefInputSchema,
      handler: handlers.getActiveTabContext,
    }),
  ],
  [
    'detect_supported_exam',
    tool({
      name: 'detect_supported_exam',
      description: 'Classify a URL against registered examination adapters and report support status.',
      environment: 'server',
      permissions: ['SCAN_SUPPORTED_PAGE'],
      inputSchema: detectSupportedExamInputSchema,
      handler: handlers.detectSupportedExam,
    }),
  ],
  [
    'scan_supported_application_page',
    tool({
      name: 'scan_supported_application_page',
      description: 'Ask the Chrome extension to scan the active supported page and return detected form fields. Server cannot touch the DOM.',
      environment: 'browser',
      permissions: ['SCAN_SUPPORTED_PAGE'],
      inputSchema: scanSupportedApplicationPageInputSchema,
      handler: handlers.scanSupportedApplicationPage,
    }),
  ],
  [
    'get_detected_form_fields',
    tool({
      name: 'get_detected_form_fields',
      description: 'Return the last redacted fill plan persisted for this workspace (labels and mapping decisions only).',
      environment: 'server',
      permissions: ['MAP_FIELDS'],
      inputSchema: emptyInputSchema,
      handler: handlers.getDetectedFormFields,
    }),
  ],

  // Mapping and review
  [
    'map_application_fields',
    tool({
      name: 'map_application_fields',
      description: 'Build a redacted fill plan from field descriptors using deterministic rules and the optional local model.',
      environment: 'server',
      permissions: ['MAP_FIELDS'],
      inputSchema: mapApplicationFieldsInputSchema,
      handler: handlers.mapApplicationFields,
    }),
  ],
  [
    'generate_field_preview',
    tool({
      name: 'generate_field_preview',
      description: 'Return the concrete saved values for an approved list of canonical fields, plus any missing values.',
      environment: 'server',
      permissions: ['READ_PROFILE', 'CREATE_PREVIEW'],
      inputSchema: generateFieldPreviewInputSchema,
      handler: handlers.generateFieldPreview,
    }),
  ],
  [
    'get_field_mapping_conflicts',
    tool({
      name: 'get_field_mapping_conflicts',
      description: 'Return fields flagged for review or ambiguous mappings, and any application-level mapping drift.',
      environment: 'server',
      permissions: ['MAP_FIELDS', 'READ_APPLICATION'],
      inputSchema: getFieldMappingConflictsInputSchema,
      handler: handlers.getFieldMappingConflicts,
    }),
  ],
  [
    'request_student_approval',
    tool({
      name: 'request_student_approval',
      description: 'Create a durable server-side approval record for a set of proposed field fills. Requires explicit student action.',
      environment: 'server',
      permissions: ['REQUEST_APPROVAL'],
      inputSchema: requestStudentApprovalInputSchema,
      handler: handlers.requestStudentApproval,
    }),
  ],

  // Task orchestrator
  [
    'list_agent_tasks',
    tool({
      name: 'list_agent_tasks',
      description: 'List durable agent tasks for the workspace. Use to answer "resume my previous task" or check task history.',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: listAgentTasksInputSchema,
      handler: handlers.listAgentTasksHandler,
    }),
  ],
  [
    'get_agent_task',
    tool({
      name: 'get_agent_task',
      description: 'Get the current status of one durable agent task by its reference.',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: getAgentTaskInputSchema,
      handler: handlers.getAgentTaskHandler,
    }),
  ],
  [
    'create_agent_task',
    tool({
      name: 'create_agent_task',
      description: 'Create and plan a durable multi-step agent task from a student objective. Use for requests like "prepare my JEE Main application" or "help me fill this form".',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: createAgentTaskInputSchema,
      handler: handlers.createAgentTaskHandler,
    }),
  ],
  [
    'resume_agent_task',
    tool({
      name: 'resume_agent_task',
      description: 'Resume a paused or waiting durable agent task by its reference.',
      environment: 'server',
      permissions: ['READ_APPLICATION'],
      inputSchema: resumeAgentTaskInputSchema,
      handler: handlers.resumeAgentTaskHandler,
    }),
  ],

  // Approved execution
  [
    'execute_approved_field_fills',
    tool({
      name: 'execute_approved_field_fills',
      description: 'Validate a server-side approval, reserve one credit, and return a browser-action envelope the extension uses to fill the approved fields.',
      environment: 'server',
      permissions: ['EXECUTE_APPROVED_FILL'],
      inputSchema: executeApprovedFieldFillsInputSchema,
      handler: handlers.executeApprovedFieldFills,
    }),
  ],
  [
    'verify_filled_fields',
    tool({
      name: 'verify_filled_fields',
      description: 'Ask the Chrome extension to verify filled fields on the page, or record verification results supplied by the extension.',
      environment: 'browser',
      permissions: ['VERIFY_FILL'],
      inputSchema: verifyFilledFieldsInputSchema,
      handler: handlers.verifyFilledFields,
    }),
  ],
])

export function getToolDefinition(name: string): ToolDefinition<z.ZodTypeAny, z.ZodTypeAny> | undefined {
  return AGENT_TOOL_REGISTRY.get(name)
}

export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(AGENT_TOOL_REGISTRY.values())
}

/** Tools visible to the model. Student approval, execution and verification
 * remain registered for explicit Side Panel actions, but are never callable
 * by the model or task planner. */
export function listModelToolDefinitions(): ToolDefinition[] {
  return listToolDefinitions().filter(definition => !isStudentActionTool(definition.name))
}

export { AGENT_PERMISSIONS }
export type { AgentPermission, ToolDefinition }
