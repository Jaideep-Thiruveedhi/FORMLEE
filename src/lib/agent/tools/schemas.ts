/**
 * Zod schemas for every agent tool input.
 *
 * These are the ONLY shapes a model-generated tool call is allowed to have.
 * Output schemas live next to each tool definition in the registry so the
 * executor can validate return values too.
 */

import { z } from 'zod'
import { agentFieldDescriptorSchema, agentPageContextSchema } from '@/lib/agent/mapper'

export const profileSectionIdSchema = z.enum([
  'personal',
  'family',
  'address',
  'class10',
  'class12',
  'category',
  'preferences',
])

export const emptyInputSchema = z.object({})

export const getStudentProfileSectionInputSchema = z.object({
  sectionId: profileSectionIdSchema,
})

export const applicationIdInputSchema = z.object({
  applicationId: z.string().cuid(),
})

export const optionalApplicationIdInputSchema = z.object({
  applicationId: z.string().cuid().optional(),
})

export const detectSupportedExamInputSchema = z.object({
  url: z.string().min(1).max(2048),
})

export const scanSupportedApplicationPageInputSchema = z.object({
  page: agentPageContextSchema.optional(),
})

export const mapApplicationFieldsInputSchema = z.object({
  fields: z.array(agentFieldDescriptorSchema).min(1).max(120),
  page: agentPageContextSchema.optional(),
})

export const generateFieldPreviewInputSchema = z.object({
  fields: z.array(z.string().min(1).max(40)).min(1).max(30),
})

export const getFieldMappingConflictsInputSchema = z.object({
  applicationId: z.string().cuid().optional(),
})

export const proposedMappingItemSchema = z.object({
  index: z.number().int().min(0).max(150),
  canonical: z.string().min(1).max(80),
  label: z.string().max(240),
})

export const valueFingerprintItemSchema = z.object({
  canonical: z.string().min(1).max(80),
  hash: z.string().min(1).max(128),
})

export const requestStudentApprovalInputSchema = z.object({
  adapterId: z.string().min(1).max(80),
  pageUrl: z.string().min(1).max(2048),
  pageFingerprint: z.string().min(1).max(128),
  origin: z.string().min(1).max(512),
  tabRef: z.string().max(64).optional(),
  proposedMapping: z.array(proposedMappingItemSchema).min(1).max(120),
  approvedFieldIds: z.array(z.string().min(1).max(80)).min(1).max(120),
  expiresInMinutes: z.number().int().min(1).max(60).default(10),
})

export const approvalRefSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const approvedFieldItemSchema = z.object({
  index: z.number().int().min(0).max(150),
  canonical: z.string().min(1).max(80),
})

export const executeApprovedFieldFillsInputSchema = z.object({
  approvalRef: approvalRefSchema,
  approved: z.array(approvedFieldItemSchema).min(1).max(120),
})

export const verifyFilledFieldsInputSchema = z.object({
  approvalRef: approvalRefSchema,
  adapterId: z.string().min(1).max(80).optional(),
  pageUrl: z.string().min(1).max(2048).optional(),
  pageFingerprint: z.string().min(1).max(256).optional(),
  results: z
    .array(
      z.object({
        index: z.number().int().min(0).max(150),
        canonical: z.string().min(1).max(80),
        status: z.enum(['filled', 'unverified', 'no-saved-value', 'refused', 'skipped', 'unsupported', 'no-option', 'stale']),
        valueHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })
    )
    .optional(),
})

export const tabRefInputSchema = z.object({
  tabId: z.number().int().min(0).optional(),
})

export const listAgentTasksInputSchema = z.object({
  status: z.string().max(30).optional(),
})

export const getAgentTaskInputSchema = z.object({
  taskRef: z.string().min(1).max(128),
})

export const createAgentTaskInputSchema = z.object({
  objective: z.string().min(1).max(500),
  applicationId: z.string().cuid().optional(),
})

export const resumeAgentTaskInputSchema = z.object({
  taskRef: z.string().min(1).max(128),
})
