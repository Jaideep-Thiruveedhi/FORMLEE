import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  type AgentTargetStatus,
} from './fields'
import { classifyUrl } from './registry'
import type { AgentAdapterId, AgentPageContext, AgentPageKind } from './adapter-types'
import { recognizeFields } from './recognition/pipeline'
import type { FieldRecognitionResult, RecognitionSource, RecognitionConfidence } from './recognition/types'
import { prisma } from '@/lib/prisma'

/**
 * Apply Agent V1 — fill-plan builder.
 *
 * Tier 1 is the pure deterministic alias engine (fields.ts). Tier 2 consults
 * the configured local Ollama model ONLY for descriptors the deterministic
 * engine left unmapped, passing labels/option labels + the canonical allowlist
 * — never student data, never field values. Model output is validated against
 * the allowlist and can only approve pre-approved canonical names, so model
 * output can never broaden what the agent is allowed to fill.
 */

export const agentFieldDescriptorSchema = z.object({
  index: z.number().int().min(0).max(150),
  label: z.string().max(240).default(''),
  kind: z.enum(['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number', 'email', 'tel', 'file']),
  inputName: z.string().max(150).default(''),
  inputId: z.string().max(150).default(''),
  required: z.boolean().default(false),
  inputType: z.string().max(20).optional(),
  autocomplete: z.string().max(20).optional(),
  /** Nearest fieldset legend / accessible group label (JEE adapter needs it
   * to distinguish Class 10 from Class 12 and date-of-birth parts). */
  group: z.string().max(240).default(''),
  options: z
    .array(
      z.object({
        text: z.string().max(150),
        value: z.string().max(150).default(''),
      })
    )
    .max(80)
    .default([]),
})

export type AgentFieldDescriptor = z.infer<typeof agentFieldDescriptorSchema>
export type { AgentPageContext } from './adapter-types'

export const agentPageContextSchema = z.object({
  /** Origin + pathname only. Query strings can contain one-time portal
   * tokens and are rejected by the route. */
  url: z.string().min(1).max(2048),
  kind: z.enum([
    'generic',
    'personal',
    'qualification',
    'exam',
    'documents',
    'declaration',
    'login',
    'unknown',
  ]),
  fingerprint: z.string().regex(/^[0-9a-f]{8,32}$/).optional(),
})

export const agentMapRequestSchema = z.object({
  fields: z.array(agentFieldDescriptorSchema).min(1).max(120),
  page: agentPageContextSchema.optional(),
})

export interface AgentPlanItem {
  index: number
  label: string
  kind: string
  required: boolean
  status: AgentTargetStatus
  canonical: string | null
  ambiguous: string[]
  needsReview: boolean
  reason: string
  firedByAi: boolean
  group: string
  source?: RecognitionSource
  confidence?: RecognitionConfidence
  warnings?: string[]
  optionMappingSuggestion?: Record<string, string>
  options?: { text: string; value: string }[]
}

export interface AgentFillPlanPage {
  url: string
  kind: AgentPageKind
  fingerprint: string | null
  supported: boolean
}

export interface AgentFillPlan {
  createdAt: string
  adapter: AgentAdapterId
  adapterLabel: string | null
  adapterStatus: string | null
  adapterNote: string | null
  page: AgentFillPlanPage | null
  aiUsed: boolean
  aiNote: string | null
  counts: {
    detected: number
    mapped: number
    ambiguous: number
    manual: number
    unsafe: number
    unmapped: number
  }
  items: AgentPlanItem[]
}

/**
 * Builds the redacted fill plan for one detection round. Identifiers
 * (inputName/inputId) are kept OUT of the stored plan: the page preview shows
 * labels/status only, and the plan never contains student values.
 *
 * When `page` matches a registered examination adapter, the generic alias
 * engine AND the local model are bypassed. Only that adapter's strict,
 * documentation-backed rules may produce `mapped` items.
 */
export async function buildAgentFillPlan(
  descriptors: AgentFieldDescriptor[],
  options: { page?: AgentPageContext; sensitiveValues?: string[] } = {}
): Promise<AgentFillPlan> {
  const page = options.page
  const registryResult = page ? classifyUrl(page.url) : null
  const adapter = registryResult?.adapter ?? null
  const classification = registryResult?.classification ?? null
  const blockedPage = !!page && (classification?.adapter === 'none' || adapter === null)
  const pageKind: AgentPageKind = page?.kind ?? 'unknown'
  const adapterSupported = adapter !== null && adapter.isSupportedPageKind(pageKind)

  let items: AgentPlanItem[]
  let aiUsed = false
  let aiNote: string | null = null

  if (blockedPage) {
    items = descriptors.map(descriptor => ({
      index: descriptor.index,
      label: descriptor.label || '(no label detected)',
      kind: descriptor.kind,
      required: descriptor.required,
      status: 'manual',
      canonical: null,
      ambiguous: [],
      needsReview: false,
      reason: 'This page is not an approved Formlee target; nothing will be filled.',
      firedByAi: false,
      group: descriptor.group,
      source: 'UNRESOLVED',
    }))
  } else {
    const { results, summary } = await recognizeFields(descriptors, {
      adapterId: adapter?.id,
      pageKind,
      useHistory: false,
      sensitiveValues: options.sensitiveValues,
    })
    aiUsed = summary.aiUsed
    aiNote = summary.aiNote
    const descriptorByIndex = new Map(descriptors.map(d => [d.index, d]))
    items = results.map(result => recognitionResultToPlanItem(result, descriptorByIndex.get(result.index)!))
  }

  // Fields with no readable label cannot be safely interpreted.
  for (const item of items) {
    if (item.status === 'unmapped' && item.label.trim().length === 0) {
      item.status = 'manual'
      item.reason = 'No readable label detected'
    }
  }

  const counts = {
    detected: items.length,
    mapped: items.filter(i => i.status === 'mapped').length,
    ambiguous: items.filter(i => i.status === 'ambiguous').length,
    manual: items.filter(i => i.status === 'manual').length,
    unsafe: items.filter(i => i.status === 'unsafe').length,
    unmapped: items.filter(i => i.status === 'unmapped').length,
  }

  const pagePlan: AgentFillPlanPage | null = page
    ? {
        url: classification?.sanitizedUrl ?? page.url,
        kind: page.kind,
        fingerprint: page.fingerprint ?? null,
        supported: blockedPage ? false : adapterSupported,
      }
    : null

  const adapterNote = adapter
    ? adapterSupported
      ? `${adapter.name} adapter: only documented ${adapter.fillablePageKinds.join('/')} labels are mapped. The local model is not used on this page.`
      : adapter.pageNotice(pageKind)
    : blockedPage
      ? 'This page is not an approved Formlee target; nothing will be filled.'
      : null

  return {
    createdAt: new Date().toISOString(),
    adapter: classification?.adapter ?? 'generic',
    adapterLabel: adapter?.name ?? null,
    adapterStatus: adapter?.statusLabel ?? null,
    adapterNote,
    page: pagePlan,
    aiUsed,
    aiNote,
    counts,
    items,
  }
}

function recognitionResultToPlanItem(
  result: FieldRecognitionResult,
  descriptor: AgentFieldDescriptor
): AgentPlanItem {
  return {
    index: result.index,
    label: descriptor.label || '(no label detected)',
    kind: descriptor.kind,
    required: descriptor.required,
    status: result.status,
    canonical: result.canonical,
    ambiguous: result.ambiguous,
    needsReview: result.needsReview,
    reason: result.reason,
    firedByAi: result.source === 'AI_SUGGESTION',
    group: descriptor.group,
    source: result.source,
    confidence: result.confidence,
    warnings: result.warnings,
    optionMappingSuggestion: result.optionMappingSuggestion,
    options: descriptor.options,
  }
}

/** Caches the latest plan on every currently-valid session of the workspace so
 * the /apply/agent page can preview what the extension detected. */
export async function persistAgentPlan(workspaceId: string, plan: AgentFillPlan): Promise<void> {
  await prisma.agentSession.updateMany({
    where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { plan: plan as unknown as Prisma.InputJsonValue, planAt: new Date() },
  })
}
