/**
 * Agent Tool handlers.
 *
 * Every handler receives a trusted ToolContext and already-validated args.
 * Handlers reuse existing services (profile/application/document/mapper) and
 * never trust workspace/user ids from the model. Browser-only tools return a
 * browserAction envelope because the server cannot access Chrome tabs or DOM.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadWorkspaceVault, loadWorkspaceVaultWithDimensions, profileRowToDTO } from '@/lib/apply-ai/server-data'
import { evaluateProfile } from '@/lib/apply-ai/requirements'
import { PROFILE_SECTION_BY_ID } from '@/lib/apply-ai/profile'
import { withEvaluation, toApplicationDTO, normalizeChecklist, deadlineSnapshot } from '@/lib/apply-ai/applications'
import { EXAM_BY_ID } from '@/lib/apply-ai/exams'
import { buildAgentFillPlan, persistAgentPlan } from '@/lib/agent/mapper'
import { classifyUrl } from '@/lib/agent/registry'
import {
  createAgentTask,
  planTask,
  startTask,
  resumeAgentTask,
  listAgentTasks,
  getTask,
} from '@/lib/agent/tasks/orchestrator'
import { resolveAgentValues } from '@/lib/agent/values'
import { collectWorkspaceSensitiveValues } from '@/lib/agent/privacy'
import { detectFieldMappingConflicts } from '@/lib/agent/recognition/conflicts'
import type { FieldRecognitionResult } from '@/lib/agent/recognition/types'
import { isSanitizedPageUrl } from '@/lib/agent/jee-main'
import { requireFillCreditAuth } from '@/lib/billing/auth'
import * as approvalService from '@/lib/agent/approval'
import type { ToolContext, ToolResult } from './types'
import type {
  CreateApprovalInput,
  ApprovalVerificationInput,
} from '@/lib/agent/approval'
import type { AgentFieldDescriptor, AgentPageContext } from '@/lib/agent/mapper'

function forbidden(message: string, code = 'FORBIDDEN'): ToolResult {
  return { ok: false, error: message, code }
}

function serverError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message, code: 'EXECUTION_ERROR' }
}

// ---------------------------------------------------------------------------
// Student Vault
// ---------------------------------------------------------------------------

export async function getStudentProfileSummary(_ctx: ToolContext, _args: unknown): Promise<ToolResult> {
  const { profile, documents } = await loadWorkspaceVault(_ctx.workspaceId)
  const evaluation = evaluateProfile(profile)
  return {
    ok: true,
    data: {
      status: evaluation.status,
      completedSections: evaluation.completedSections,
      totalSections: evaluation.totalSections,
      missingLabels: evaluation.missingLabels,
      needsConfirmationLabels: evaluation.needsConfirmationLabels,
      awaitingResultsLabels: evaluation.awaitingResultsLabels,
      documentsUploaded: documents.length,
    },
  }
}

export async function getStudentProfileSection(_ctx: ToolContext, args: { sectionId: string }): Promise<ToolResult> {
  const { profile } = await loadWorkspaceVault(_ctx.workspaceId)
  const section = PROFILE_SECTION_BY_ID[args.sectionId as keyof typeof PROFILE_SECTION_BY_ID]
  if (!section) return { ok: false, error: 'Unknown section.', code: 'UNKNOWN_SECTION' }
  const record = (profile ?? {}) as Record<string, unknown>
  const fields = section.fields.map(field => {
    const value = record[field.id]
    const present = value !== null && value !== undefined && value !== '' && value !== false
    return {
      fieldId: field.id,
      label: field.label,
      present,
      type: field.type,
      required: field.required,
    }
  })
  return { ok: true, data: { sectionId: section.id, title: section.title, fields } }
}

export async function listUploadedDocuments(_ctx: ToolContext, _args: unknown): Promise<ToolResult> {
  const { documents } = await loadWorkspaceVault(_ctx.workspaceId)
  return {
    ok: true,
    data: {
      documents: documents.map(doc => ({
        id: doc.id,
        documentType: doc.documentType,
        displayLabel: doc.displayLabel,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        isCurrent: doc.isCurrent,
        versions: doc.versions,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// Application Hub
// ---------------------------------------------------------------------------

async function loadApplication(workspaceId: string, applicationId: string) {
  const row = await prisma.examApplication.findFirst({
    where: { id: applicationId, workspaceId },
  })
  if (!row) return null
  const exam = EXAM_BY_ID[row.examId as keyof typeof EXAM_BY_ID]
  if (!exam) return null
  return { row, exam }
}

export async function getApplicationDetails(_ctx: ToolContext, args: { applicationId: string }): Promise<ToolResult> {
  const loaded = await loadApplication(_ctx.workspaceId, args.applicationId)
  if (!loaded) return { ok: false, error: 'Application not found.', code: 'NOT_FOUND' }
  return { ok: true, data: { application: toApplicationDTO(loaded.row, loaded.exam) } }
}

export async function getApplicationReadiness(_ctx: ToolContext, args: { applicationId?: string }): Promise<ToolResult> {
  const vault = await loadWorkspaceVaultWithDimensions(_ctx.workspaceId)
  if (args.applicationId) {
    const loaded = await loadApplication(_ctx.workspaceId, args.applicationId)
    if (!loaded) return { ok: false, error: 'Application not found.', code: 'NOT_FOUND' }
    const evaluated = withEvaluation(loaded.row, vault.profile, vault.documents, vault.documentDimensions)
    return { ok: true, data: { applications: [evaluated] } }
  }
  const rows = await prisma.examApplication.findMany({
    where: { workspaceId: _ctx.workspaceId },
    orderBy: [{ updatedAt: 'desc' }],
  })
  const applications = rows.map(row => withEvaluation(row, vault.profile, vault.documents, vault.documentDimensions))
  return { ok: true, data: { applications } }
}

export async function getApplicationChecklist(_ctx: ToolContext, args: { applicationId: string }): Promise<ToolResult> {
  const loaded = await loadApplication(_ctx.workspaceId, args.applicationId)
  if (!loaded) return { ok: false, error: 'Application not found.', code: 'NOT_FOUND' }
  const checklist = normalizeChecklist(loaded.row.checklist)
  return { ok: true, data: { checklist } }
}

export async function getApplicationDeadlines(_ctx: ToolContext, args: { applicationId?: string }): Promise<ToolResult> {
  if (args.applicationId) {
    const loaded = await loadApplication(_ctx.workspaceId, args.applicationId)
    if (!loaded) return { ok: false, error: 'Application not found.', code: 'NOT_FOUND' }
    return { ok: true, data: { deadlines: [deadlineSnapshot(loaded.row, loaded.exam)] } }
  }
  const rows = await prisma.examApplication.findMany({
    where: { workspaceId: _ctx.workspaceId },
    orderBy: [{ updatedAt: 'desc' }],
  })
  const deadlines = rows
    .map(row => {
      const exam = EXAM_BY_ID[row.examId as keyof typeof EXAM_BY_ID]
      if (!exam) return null
      return deadlineSnapshot(row, exam)
    })
    .filter(Boolean)
  return { ok: true, data: { deadlines } }
}

// ---------------------------------------------------------------------------
// Examination assistant
// ---------------------------------------------------------------------------

export async function getActiveTabContext(_ctx: ToolContext, args: { tabId?: number }): Promise<ToolResult> {
  return {
    ok: true,
    browserAction: {
      type: 'GET_TAB_CONTEXT' as const,
      payload: { tabId: args.tabId },
    },
  }
}

export async function detectSupportedExam(_ctx: ToolContext, args: { url: string }): Promise<ToolResult> {
  const result = classifyUrl(args.url)
  const classification = result.classification
  return {
    ok: true,
    data: {
      adapterId: classification.adapter,
      adapterLabel: result.adapter?.name ?? null,
      adapterStatus: result.adapter?.statusLabel ?? null,
      supported: classification.adapter !== 'none' && result.adapter !== null,
      official: classification.official,
      fixture: classification.fixture,
      reason: classification.reason,
    },
  }
}

export async function scanSupportedApplicationPage(_ctx: ToolContext, args: { page?: AgentPageContext }): Promise<ToolResult> {
  return {
    ok: true,
    browserAction: {
      type: 'SCAN_PAGE' as const,
      payload: args.page ? { page: args.page } : {},
    },
  }
}

export async function getDetectedFormFields(_ctx: ToolContext, _args: unknown): Promise<ToolResult> {
  const session = await prisma.agentSession.findFirst({
    where: { workspaceId: _ctx.workspaceId, planAt: { not: null } },
    orderBy: [{ planAt: 'desc' }, { createdAt: 'desc' }],
  })
  return { ok: true, data: { plan: (session?.plan as Prisma.JsonValue | null) ?? null } }
}

// ---------------------------------------------------------------------------
// Mapping and review
// ---------------------------------------------------------------------------

export async function mapApplicationFields(_ctx: ToolContext, args: { fields: AgentFieldDescriptor[]; page?: AgentPageContext }): Promise<ToolResult> {
  if (args.page && !isSanitizedPageUrl(args.page.url)) {
    return { ok: false, error: 'Page URL must contain only origin and pathname.', code: 'UNSANITIZED_PAGE_URL' }
  }
  const registryResult = args.page ? classifyUrl(args.page.url) : null
  if (args.page && (!registryResult || registryResult.classification.adapter === 'none' || !registryResult.adapter)) {
    return { ok: false, error: 'Unsupported or unrecognised examination page.', code: 'UNSUPPORTED_PAGE' }
  }
  const plan = await buildAgentFillPlan(args.fields, {
    page: args.page,
    sensitiveValues: await collectWorkspaceSensitiveValues(_ctx.workspaceId),
  })
  await persistAgentPlan(_ctx.workspaceId, plan)
  return { ok: true, data: { plan } }
}

export async function generateFieldPreview(_ctx: ToolContext, args: { fields: string[] }): Promise<ToolResult> {
  const result = await resolveAgentValues(_ctx.workspaceId, args.fields)
  return { ok: true, data: result }
}

export async function getFieldMappingConflicts(_ctx: ToolContext, args: { applicationId?: string }): Promise<ToolResult> {
  const session = await prisma.agentSession.findFirst({
    where: { workspaceId: _ctx.workspaceId, planAt: { not: null } },
    orderBy: [{ planAt: 'desc' }],
  })
  const plan = session?.plan as Record<string, unknown> | null
  const items = plan && Array.isArray((plan as { items?: unknown[] }).items) ? ((plan as { items: unknown[] }).items as Record<string, unknown>[]) : []

  const mappedCanonicals = items
    .filter(item => item.status === 'mapped' && typeof item.canonical === 'string')
    .map(item => item.canonical as string)
  const values = await resolveAgentValues(_ctx.workspaceId, mappedCanonicals)

  // The stored plan items are a superset of the recognition result fields the
  // conflict detector expects; this is safe because it only reads known keys.
  const conflicts = detectFieldMappingConflicts(items as unknown as FieldRecognitionResult[], values)

  if (args.applicationId) {
    const app = await prisma.examApplication.findFirst({
      where: { id: args.applicationId, workspaceId: _ctx.workspaceId },
      select: { mappingChangedFields: true, mappingReviewRequired: true },
    })
    if (app) {
      return {
        ok: true,
        data: {
          conflicts,
          mappingReviewRequired: app.mappingReviewRequired,
          mappingChangedFields: Array.isArray(app.mappingChangedFields) ? app.mappingChangedFields : [],
        },
      }
    }
  }
  return { ok: true, data: { conflicts } }
}

export async function requestStudentApproval(
  _ctx: ToolContext,
  args: {
    adapterId: string
    pageUrl: string
    pageFingerprint: string
    origin: string
    tabRef?: string
    proposedMapping: { index: number; canonical: string; label: string }[]
    approvedFieldIds: string[]
    expiresInMinutes?: number
  }
): Promise<ToolResult> {
  if (!_ctx.agentSessionId || !isSanitizedPageUrl(args.pageUrl)) {
    return forbidden('A current paired session and a sanitized supported page are required.', 'APPROVAL_CONTEXT_INVALID')
  }

  const classified = classifyUrl(args.pageUrl)
  if (!classified.adapter || classified.classification.adapter !== args.adapterId || classified.classification.sanitizedUrl !== args.pageUrl) {
    return forbidden('The page does not match a registered examination adapter.', 'ADAPTER_MISMATCH')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(args.pageUrl)
  } catch {
    return forbidden('The page URL is invalid.', 'APPROVAL_CONTEXT_INVALID')
  }
  if (parsedUrl.origin !== args.origin) {
    return forbidden('The approval origin does not match the page URL.', 'APPROVAL_CONTEXT_INVALID')
  }

  const session = await prisma.agentSession.findFirst({
    where: {
      id: _ctx.agentSessionId,
      workspaceId: _ctx.workspaceId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { plan: true },
  })
  const currentPlan = session?.plan as {
    adapter?: string
    page?: { url?: string; fingerprint?: string | null }
    items?: { index?: number; label?: string; status?: string; canonical?: string | null }[]
  } | null
  if (
    !currentPlan?.page ||
    currentPlan.adapter !== args.adapterId ||
    currentPlan.page.url !== args.pageUrl ||
    currentPlan.page.fingerprint !== args.pageFingerprint ||
    !Array.isArray(currentPlan.items)
  ) {
    return forbidden('The approval no longer matches the latest inspected page. Scan the page again.', 'PAGE_CHANGED')
  }

  const plannedByIndex = new Map(currentPlan.items.map(item => [item.index, item]))
  const seenIndexes = new Set<number>()
  for (const item of args.proposedMapping) {
    const planned = plannedByIndex.get(item.index)
    if (
      seenIndexes.has(item.index) ||
      !planned ||
      planned.status !== 'mapped' ||
      planned.canonical !== item.canonical ||
      planned.label !== item.label
    ) {
      return forbidden('The reviewed mapping does not match the latest scan.', 'MAPPING_CHANGED')
    }
    seenIndexes.add(item.index)
  }

  const selectedCanonicals = [...new Set(args.proposedMapping.map(item => item.canonical))].sort()
  const approvedCanonicals = [...new Set(args.approvedFieldIds)].sort()
  if (selectedCanonicals.length === 0 || JSON.stringify(selectedCanonicals) !== JSON.stringify(approvedCanonicals)) {
    return forbidden('The approved fields do not match the reviewed mappings.', 'MAPPING_CHANGED')
  }

  // Hash the current Vault values on the server. The extension does not need
  // to send concrete values or fingerprints as approval claims.
  const currentValues = await resolveAgentValues(_ctx.workspaceId, selectedCanonicals)
  const valueFingerprint = selectedCanonicals.map(canonical => ({
    canonical,
    hash: approvalService.hashSingleValue(currentValues.values[canonical]),
  }))

  const createInput: CreateApprovalInput = {
    ...args,
    valueFingerprint,
    workspaceId: _ctx.workspaceId,
    userId: _ctx.userId,
    agentSessionId: _ctx.agentSessionId,
  }
  const result = await approvalService.createApproval(createInput)
  if (!result.ok) return { ok: false, error: result.error, code: 'APPROVAL_CREATE_FAILED' }
  return { ok: true, data: { approvalRef: result.approvalRef } }
}

// ---------------------------------------------------------------------------
// Approved execution
// ---------------------------------------------------------------------------

export async function executeApprovedFieldFills(_ctx: ToolContext, args: { approvalRef: string; approved: { index: number; canonical: string }[] }): Promise<ToolResult> {
  const approval = await approvalService.findApprovalByRef(args.approvalRef)
  if (!approval) return { ok: false, error: 'Approval not found.', code: 'APPROVAL_NOT_FOUND' }
  if (
    !_ctx.agentSessionId ||
    approval.workspaceId !== _ctx.workspaceId ||
    approval.userId !== _ctx.userId ||
    approval.agentSessionId !== _ctx.agentSessionId
  ) return forbidden('Approval is not bound to this workspace and AgentSession.', 'SESSION_MISMATCH')

  const canonicals = [...new Set(args.approved.map(item => item.canonical))]
  const valueResult = await resolveAgentValues(_ctx.workspaceId, canonicals)
  const valueFingerprint = canonicals.map(canonical => ({
    canonical,
    hash: approvalService.hashSingleValue(valueResult.values[canonical]),
  }))

  const verifyInput: ApprovalVerificationInput = {
    approvalRef: args.approvalRef,
    workspaceId: _ctx.workspaceId,
    agentSessionId: _ctx.agentSessionId,
    adapterId: approval.adapterId,
    pageUrl: approval.pageUrl,
    pageFingerprint: approval.pageFingerprint,
    approved: args.approved,
    valueFingerprint,
  }
  const verified = await approvalService.verifyApproval(verifyInput)
  if (!verified.ok) {
    const pending = _ctx.agentSessionId && await prisma.creditReservation.findFirst({
      where: {
        workspaceId: _ctx.workspaceId,
        account: { userId: _ctx.userId },
        status: 'PENDING',
        OR: [
          { idempotencyKey: args.approvalRef, agentSessionId: _ctx.agentSessionId },
          { legacyAgentSessionOrIdempotencyKey: args.approvalRef, agentSessionId: null },
        ],
      },
      select: { id: true },
    })
    if (pending) {
      const { releaseCredit } = await import('@/lib/billing/credits')
      await releaseCredit({ reservationId: pending.id, userId: _ctx.userId, workspaceId: _ctx.workspaceId, agentSessionId: _ctx.agentSessionId })
    }
    return { ok: false, error: verified.error ?? 'Approval verification failed.', code: verified.code ?? 'APPROVAL_INVALID' }
  }

  // Credit reservation is the existing wallet boundary; it requires either a
  // Better Auth session or the scoped agent session.
  const creditAuth = await requireFillCreditAuth()
  if (
    !creditAuth ||
    creditAuth.kind !== 'agent' ||
    creditAuth.agentToken !== _ctx.agentSessionId ||
    creditAuth.workspaceId !== _ctx.workspaceId ||
    creditAuth.userId !== _ctx.userId
  ) {
    return { ok: false, error: 'Could not authorize a credit for this fill.', code: 'CREDIT_AUTH_REQUIRED' }
  }

  const marked = await approvalService.markApprovalFillRequested({
    approvalRef: args.approvalRef,
    workspaceId: _ctx.workspaceId,
    userId: _ctx.userId,
    agentSessionId: _ctx.agentSessionId,
  })
  if (!marked) return { ok: false, error: 'Approval is no longer available for a fill.', code: 'APPROVAL_INVALID' }

  const { reserveCredit } = await import('@/lib/billing/credits')
  try {
    const reservation = await reserveCredit({
      userId: creditAuth.userId,
      workspaceId: _ctx.workspaceId,
      agentSessionId: _ctx.agentSessionId,
      idempotencyKey: args.approvalRef,
    })
    if (reservation.status !== 'PENDING') {
      return { ok: false, error: 'This approval no longer has an active credit reservation. Review the fields and approve again.', code: 'RESERVATION_NOT_PENDING' }
    }

    return {
      ok: true,
      data: {
        approvalRef: args.approvalRef,
        reservationId: reservation.id,
        approvedFields: args.approved,
      },
      browserAction: {
        type: 'FILL' as const,
        payload: {
          approvalRef: args.approvalRef,
          reservationId: reservation.id,
          approved: args.approved,
        },
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'INSUFFICIENT_CREDITS') {
      await approvalService.restoreApprovalAfterInsufficientCredits({
        approvalRef: args.approvalRef,
        workspaceId: _ctx.workspaceId,
        agentSessionId: _ctx.agentSessionId,
      })
      return {
        ok: false,
        error: 'No application credits are available. Buy a package in Formlee Billing, then retry this still-valid approval.',
        code: 'INSUFFICIENT_CREDITS',
      }
    }
    return { ok: false, error: 'Credit reservation failed.', code: 'CREDIT_RESERVE_FAILED' }
  }
}

export async function verifyFilledFields(_ctx: ToolContext, args: {
  approvalRef: string
  adapterId?: string
  pageUrl?: string
  pageFingerprint?: string
  results?: { index: number; canonical: string; status: string; valueHash?: string }[]
}): Promise<ToolResult> {
  if (Array.isArray(args.results)) {
    if (!_ctx.agentSessionId || !args.adapterId || !args.pageUrl || !args.pageFingerprint) {
      return { ok: false, error: 'The AgentSession and approved page/form context are required to record verification.', code: 'APPROVAL_INVALID' }
    }
    const recorded = await approvalService.recordVerificationReport({
      approvalRef: args.approvalRef,
      workspaceId: _ctx.workspaceId,
      userId: _ctx.userId,
      agentSessionId: _ctx.agentSessionId,
      adapterId: args.adapterId,
      pageUrl: args.pageUrl,
      pageFingerprint: args.pageFingerprint,
      results: args.results,
    })
    const reservation = await prisma.creditReservation.findFirst({
      where: {
        workspaceId: _ctx.workspaceId,
        account: { userId: _ctx.userId },
        OR: [
          { idempotencyKey: args.approvalRef, agentSessionId: _ctx.agentSessionId },
          { legacyAgentSessionOrIdempotencyKey: args.approvalRef, agentSessionId: null },
        ],
      },
      select: { id: true, status: true },
    })
    if (!recorded.ok) {
      if (reservation?.status === 'PENDING') {
        const { releaseCredit } = await import('@/lib/billing/credits')
        await releaseCredit({ reservationId: reservation.id, userId: _ctx.userId, workspaceId: _ctx.workspaceId, agentSessionId: _ctx.agentSessionId })
      }
      return { ok: false, error: recorded.error, code: recorded.code }
    }
    if (recorded.releaseRequired && reservation?.status === 'PENDING') {
      const { releaseCredit } = await import('@/lib/billing/credits')
      await releaseCredit({ reservationId: reservation.id, userId: _ctx.userId, workspaceId: _ctx.workspaceId, agentSessionId: _ctx.agentSessionId })
    }
    return {
      ok: true,
      data: {
        approvalRef: args.approvalRef,
        verifiedCount: recorded.verifiedCount,
        unverifiedCount: recorded.unverifiedCount,
        receiptStored: recorded.verifiedCount > 0,
        verificationSource: 'authenticated-extension-readback-report',
      },
    }
  }

  // Otherwise ask the extension to read the current values back from the page.
  return {
    ok: true,
    browserAction: {
      type: 'VERIFY' as const,
      payload: {
        approvalRef: args.approvalRef,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Task orchestrator
// ---------------------------------------------------------------------------

function requestFromContext(_ctx: ToolContext): Request {
  return new Request('http://localhost/api/agent/internal', {
    headers: { 'x-formlee-agent-session': _ctx.agentSessionId ?? '' },
  })
}

export async function listAgentTasksHandler(_ctx: ToolContext, args: { status?: string }): Promise<ToolResult> {
  const tasks = await listAgentTasks(requestFromContext(_ctx), { status: args.status })
  return {
    ok: true,
    data: {
      tasks: tasks.map(t => ({
        ref: t.ref,
        objective: t.objective,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    },
  }
}

export async function getAgentTaskHandler(_ctx: ToolContext, args: { taskRef: string }): Promise<ToolResult> {
  const task = await getTask(args.taskRef, requestFromContext(_ctx))
  if (!task) return { ok: false, error: 'Task not found.', code: 'TASK_NOT_FOUND' }
  return {
    ok: true,
    data: {
      task: {
        ref: task.ref,
        objective: task.objective,
        status: task.status,
        currentStepIndex: task.currentStepIndex,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    },
  }
}

export async function createAgentTaskHandler(_ctx: ToolContext, args: { objective: string; applicationId?: string }): Promise<ToolResult> {
  const request = requestFromContext(_ctx)
  const created = await createAgentTask({ request, objective: args.objective, applicationId: args.applicationId })
  if (!created.ok || !created.taskRef) {
    return { ok: false, error: created.message || 'Could not create task.', code: created.errorCode || 'TASK_CREATE_FAILED' }
  }
  const planned = await planTask(created.taskRef, request)
  if (!planned.ok) {
    return { ok: true, data: { taskRef: created.taskRef, status: created.status, warning: 'Task created but planning failed: ' + (planned.message || '') } }
  }
  // Start execution immediately so the student sees progress; the orchestrator
  // stops on the first browser action, missing value or approval boundary.
  const started = await startTask(created.taskRef, request)
  return { ok: true, data: { ...started, taskRef: created.taskRef } }
}

export async function resumeAgentTaskHandler(_ctx: ToolContext, args: { taskRef: string }): Promise<ToolResult> {
  const resumed = await resumeAgentTask(args.taskRef, requestFromContext(_ctx))
  return { ok: resumed.ok, data: resumed, error: resumed.message, code: resumed.errorCode }
}

// Re-export for internal use by the background fill path.
export { approvalService }
