'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'
import type { InvalidField } from './validation'
import type { ProfileEvaluation } from './requirements'
import type {
  ApplicationReminder,
  ApplicationWithEvaluation,
  DocumentId,
  HubApplicationStatus,
  StudentProfileData,
  UploadedDocumentDTO,
} from './types'

export interface ProfileVersionSummary {
  id: string
  version: number
  reason: string
  changedFields: string[]
  createdAt: string
}

interface ProfileResponse {
  profile: StudentProfileData | null
  evaluation: ProfileEvaluation
  history?: ProfileVersionSummary[]
}

export interface ProfileSaveResponse extends ProfileResponse {
  invalidFields: InvalidField[]
  savedAt: string
}

export type ProfileSaveError = Error & { invalidFields?: InvalidField[] }

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export type WorkspaceStatus =
  | 'existing' // signed out: the cookie already holds an unclaimed workspace
  | 'created' // a fresh workspace was minted (anonymous, or owned when signed in)
  | 'owned' // signed in: everything resolves to the account's workspace
  | 'claimable' // signed in, nothing owned, but this browser holds an unclaimed workspace
  | 'unavailable' // signed out: the cookie's workspace is claimed by some account

/**
 * Creates/reads the Formlee workspace. Must complete before profile or
 * document queries run for signed-out visitors — and for signed-in users it
 * resolves (or mints) an account-owned workspace. The token value never
 * reaches client code. Re-runs automatically when the session identity
 * changes, so signing in or out on a mounted page re-resolves correctly.
 */
export function useEnsureWorkspace(): {
  ready: boolean
  status: WorkspaceStatus | null
  rerun: () => void
} {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const lastSessionId = useRef<string | null | undefined>(undefined)

  const mutation = useMutation({
    mutationFn: async (): Promise<WorkspaceStatus> => {
      const res = await fetch('/api/apply/workspace', { method: 'POST' })
      if (!res.ok) throw new Error('Could not initialise your workspace')
      const body = (await res.json().catch(() => null)) as { workspace?: WorkspaceStatus } | null
      // Defensive fallback: the server always returns a status; 'claimable'
      // keeps the helpful banner path visible if that contract ever breaks.
      return body?.workspace ?? 'claimable'
    },
  })

  useEffect(() => {
    if (sessionPending) return
    const sessionId = session?.user?.id ?? null
    if (lastSessionId.current === sessionId) return
    lastSessionId.current = sessionId
    mutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPending, session?.user?.id])

  return {
    ready: mutation.isSuccess && typeof mutation.data === 'string',
    status: mutation.isSuccess ? mutation.data : null,
    rerun: () => mutation.mutate(),
  }
}

/**
 * One-click "Save my work": claims the browser's anonymous workspace for the
 * signed-in account. Server-side conflicts (this account / another account /
 * a concurrent claim) surface as errors carrying their code, so the banner
 * can explain exactly what happened without guessing.
 */
export function useClaimWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await fetch('/api/apply/claim-workspace', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
      if (!res.ok) {
        const error = new Error(body?.error ?? 'Could not save your work') as Error & { code?: string }
        error.code = body?.code
        throw error
      }
    },
    onSuccess: () => {
      // The resolved workspace id has changed to the account's: refetch data.
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY })
    },
  })
}

const PROFILE_KEY = ['apply-ai', 'profile'] as const
const DOCUMENTS_KEY = ['apply-ai', 'documents'] as const
const STORAGE_PROVIDER_KEY = ['apply-ai', 'storage-provider'] as const

export function useProfile(enabled: boolean) {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => jsonFetcher<ProfileResponse>('/api/apply/profile'),
    enabled,
  })
}

export function useSaveProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>): Promise<ProfileSaveResponse> => {
      const res = await fetch('/api/apply/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(
          (body as { error?: string } | null)?.error ?? 'Could not save your profile'
        ) as ProfileSaveError
        error.invalidFields = (body as { invalidFields?: InvalidField[] } | null)?.invalidFields
        throw error
      }
      return body as ProfileSaveResponse
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
    },
  })
}

export interface Class12ResultInput {
  class12PassingYear: string
  class12RollNumber?: string | null
  class12MarksKind?: string | null
  class12Marks?: string | null
  class12Percentage?: string | null
  class12Subjects?: unknown[]
  resultDeclaredOn?: string | null
}

export function useUpdateClass12Results() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Class12ResultInput): Promise<ProfileSaveResponse> => {
      const res = await fetch('/api/apply/profile/class12-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(
          (body as { error?: string } | null)?.error ?? 'Could not update the Class 12 result'
        ) as ProfileSaveError
        error.invalidFields = (body as { invalidFields?: InvalidField[] } | null)?.invalidFields
        throw error
      }
      return body as ProfileSaveResponse
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY })
    },
  })
}

export function useDocuments(enabled: boolean) {
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: () => jsonFetcher<{ documents: UploadedDocumentDTO[] }>('/api/apply/documents'),
    enabled,
  })
}

export function useStorageProvider() {
  return useQuery({
    queryKey: STORAGE_PROVIDER_KEY,
    queryFn: () => jsonFetcher<{ provider: 'local' | 'r2' }>('/api/apply/config/storage'),
    staleTime: Infinity,
  })
}

export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      documentType: DocumentId
      file: File
      displayLabel?: string
    }): Promise<{ document: UploadedDocumentDTO }> => {
      const form = new FormData()
      form.set('documentType', input.documentType)
      form.set('file', input.file)
      if (input.displayLabel) form.set('displayLabel', input.displayLabel)

      const res = await fetch('/api/apply/documents', { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Upload failed')
      }
      return body as { document: UploadedDocumentDTO }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch(`/api/apply/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Could not delete the document')
      }
      return true
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY })
    },
  })
}

export function useRenameDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { documentId: string; displayLabel: string }) => {
      const res = await fetch(`/api/apply/documents/${encodeURIComponent(input.documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayLabel: input.displayLabel }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Could not rename the document')
      }
      return true
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY })
    },
  })
}

export interface DocumentMetadataInput {
  displayLabel?: string
  certificateNumber?: string | null
  issuingAuthority?: string | null
  issuingState?: string | null
  issueDate?: string | null
  validUntil?: string | null
  financialYear?: string | null
  verificationStatus?: 'SELF_REPORTED' | 'STUDENT_CONFIRMED'
}

export function useUpdateDocumentMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { documentId: string; metadata: DocumentMetadataInput }) => {
      const res = await fetch(`/api/apply/documents/${encodeURIComponent(input.documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.metadata),
      })
      const body = (await res.json().catch(() => null)) as
        | { document?: UploadedDocumentDTO; error?: string }
        | null
      if (!res.ok || !body?.document) {
        throw new Error(body?.error ?? 'Could not save the document metadata')
      }
      return body.document
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY })
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
    },
  })
}

export function useDocumentVersions(documentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['apply-ai', 'documents', documentId, 'versions'],
    queryFn: () =>
      jsonFetcher<{ documents: UploadedDocumentDTO[] }>(
        `/api/apply/documents/${encodeURIComponent(documentId ?? '')}/versions`
      ),
    enabled: enabled && !!documentId,
  })
}

export { PROFILE_KEY, DOCUMENTS_KEY }

/* ---------------- Application Hub ---------------- */

export const APPLICATIONS_KEY = ['apply-ai', 'applications'] as const
export const APPLICATION_KEY = (id: string) => ['apply-ai', 'applications', id] as const

export interface ApplicationsEnvelope {
  applications: ApplicationWithEvaluation[]
  reminders: ApplicationReminder[]
}

export interface ApplicationEnvelope {
  application: ApplicationWithEvaluation
}

export type ApplicationMutationError = Error & {
  code?: string
  existingId?: string | null
}

export function useApplications(enabled: boolean) {
  return useQuery({
    queryKey: APPLICATIONS_KEY,
    queryFn: () => jsonFetcher<ApplicationsEnvelope>('/api/apply/applications'),
    enabled,
  })
}

export function useApplication(id: string, enabled: boolean) {
  return useQuery({
    queryKey: APPLICATION_KEY(id),
    queryFn: () => jsonFetcher<ApplicationEnvelope>(`/api/apply/applications/${encodeURIComponent(id)}`),
    enabled: enabled && id.length > 0,
  })
}

export function useCreateApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      examId: string
      sessionId: string
      notes?: string
    }): Promise<ApplicationEnvelope> => {
      const res = await fetch('/api/apply/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(
          (body as { error?: string } | null)?.error ?? 'Could not add this application'
        ) as ApplicationMutationError
        error.code = (body as { code?: string } | null)?.code
        error.existingId = (body as { existingId?: string | null } | null)?.existingId
        throw error
      }
      return body as ApplicationEnvelope
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY })
    },
  })
}

export interface UpdateApplicationInput {
  status?: HubApplicationStatus
  notes?: string | null
  preferences?: Record<string, string>
  checklist?: Record<string, boolean>
  refreshDeadline?: boolean
  reviewMapping?: boolean
}

export function useUpdateApplication(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateApplicationInput): Promise<ApplicationEnvelope> => {
      const res = await fetch(`/api/apply/applications/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(
          (body as { error?: string } | null)?.error ?? 'Could not update this application'
        ) as ApplicationMutationError
        error.code = (body as { code?: string } | null)?.code
        throw error
      }
      return body as ApplicationEnvelope
    },
    onSuccess: envelope => {
      queryClient.setQueryData(APPLICATION_KEY(id), envelope)
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY })
    },
  })
}

export function useApplicationSubmission(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      action: 'CONFIRM_STUDENT_SUBMITTED' | 'RECORD_PORTAL_CONFIRMATION' | 'CLEAR'
      confirmed?: boolean
      portalReference?: string
    }): Promise<ApplicationEnvelope> => {
      const res = await fetch(
        `/api/apply/applications/${encodeURIComponent(id)}/submission`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          (body as { error?: string } | null)?.error ?? 'Could not record the submission action'
        )
      }
      return body as ApplicationEnvelope
    },
    onSuccess: envelope => {
      queryClient.setQueryData(APPLICATION_KEY(id), envelope)
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY })
    },
  })
}

export function useDeleteApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/apply/applications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Could not remove this application')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY })
    },
  })
}

/* ---------------- Billing & Credits ---------------- */

const CREDIT_ACCOUNT_KEY = ['billing', 'account'] as const
const CREDIT_TRANSACTIONS_KEY = ['billing', 'transactions'] as const
const CREDIT_PACKAGES_KEY = ['billing', 'packages'] as const
const PAYMENT_ORDERS_KEY = ['billing', 'orders'] as const

export interface CreditAccountDTO {
  balance: number
  totalEarned: number
  totalSpent: number
  activeReservations: number
}

export interface CreditPackageDTO {
  code: string
  name: string
  credits: number
  amountPaise: number
  currency: string
  amountRupees: number
  perCreditPaise: number
}

export function useCreditAccount(enabled: boolean) {
  return useQuery({
    queryKey: CREDIT_ACCOUNT_KEY,
    queryFn: () => jsonFetcher<{ account: CreditAccountDTO }>('/api/billing/account').then(r => r.account),
    enabled,
  })
}

export function useCreditTransactions(enabled: boolean) {
  return useQuery({
    queryKey: CREDIT_TRANSACTIONS_KEY,
    queryFn: () => jsonFetcher<{ entries: unknown[] }>('/api/billing/transactions').then(r => r.entries),
    enabled,
  })
}

export function useCreditPackages() {
  return useQuery({
    queryKey: CREDIT_PACKAGES_KEY,
    queryFn: () => jsonFetcher<{ packages: CreditPackageDTO[] }>('/api/billing/packages').then(r => r.packages),
  })
}

export interface PaymentOrderDTO {
  id: string
  provider: string
  providerOrderId: string | null
  providerPaymentId: string | null
  packageCode: string
  credits: number
  amountPaise: number
  currency: string
  status: string
  paidAt: string | null
  verifiedAt: string | null
  createdAt: string
}

export function usePaymentOrders(enabled: boolean) {
  return useQuery({
    queryKey: PAYMENT_ORDERS_KEY,
    queryFn: () => jsonFetcher<{ orders: PaymentOrderDTO[] }>('/api/billing/orders').then(r => r.orders),
    enabled,
  })
}

export function useCreatePaymentOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      packageCode: string
    ): Promise<{ order: PaymentOrderDTO; keyId: string | null; configured: boolean }> => {
      const res = await fetch('/api/billing/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageCode }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not create payment order')
      }
      return {
        order: (body as { order: PaymentOrderDTO }).order,
        keyId: (body as { keyId?: string | null }).keyId ?? null,
        configured: (body as { configured?: boolean }).configured ?? false,
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_ORDERS_KEY })
    },
  })
}

export function useVerifyPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      internalOrderId: string
      razorpayPaymentId: string
      razorpayOrderId: string
      razorpaySignature: string
    }): Promise<PaymentOrderDTO> => {
      const res = await fetch('/api/billing/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not verify payment')
      }
      return (body as { order: PaymentOrderDTO }).order
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: CREDIT_ACCOUNT_KEY })
      queryClient.invalidateQueries({ queryKey: CREDIT_TRANSACTIONS_KEY })
    },
  })
}

/* ---------------- Referrals & Affiliate Marketing ---------------- */

export interface ReferralDashboardDTO {
  partner: {
    id: string
    name: string
    email: string
    tier: string
    commissionBasisPoints: number
    isActive: boolean
  }
  codes: string[]
  stats: {
    clicks: number
    registrations: number
    conversions: number
    conversionRate: number
    totalCommission: number
    pendingCommission: number
    approvedCommission: number
    paidCommission: number
  }
}

const REFERRAL_DASHBOARD_KEY = ['referral', 'dashboard'] as const
const REFERRAL_COMMISSIONS_KEY = ['referral', 'commissions'] as const
const REFERRAL_PAYOUTS_KEY = ['referral', 'payouts'] as const
const ADMIN_PARTNERS_KEY = ['admin', 'referrals', 'partners'] as const
const ADMIN_COMMISSIONS_KEY = ['admin', 'referrals', 'commissions'] as const

export function useReferralDashboard(enabled: boolean) {
  return useQuery({
    queryKey: REFERRAL_DASHBOARD_KEY,
    queryFn: () => jsonFetcher<ReferralDashboardDTO>('/api/partner/dashboard'),
    enabled,
  })
}

export function useReferralCommissions(enabled: boolean) {
  return useQuery({
    queryKey: REFERRAL_COMMISSIONS_KEY,
    queryFn: () => jsonFetcher<{ commissions: unknown[] }>('/api/partner/commissions').then(r => r.commissions),
    enabled,
  })
}

export function useReferralPayouts(enabled: boolean) {
  return useQuery({
    queryKey: REFERRAL_PAYOUTS_KEY,
    queryFn: () => jsonFetcher<{ payouts: unknown[] }>('/api/partner/payouts').then(r => r.payouts),
    enabled,
  })
}

export function useAdminPartners(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_PARTNERS_KEY,
    queryFn: () => jsonFetcher<{ partners: unknown[] }>('/api/admin/referrals/partners').then(r => r.partners),
    enabled,
  })
}

export function useAdminCommissions(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...ADMIN_COMMISSIONS_KEY, status],
    queryFn: () =>
      jsonFetcher<{ commissions: unknown[] }>(
        `/api/admin/referrals/commissions${status ? `?status=${encodeURIComponent(status)}` : ''}`
      ).then(r => r.commissions),
    enabled,
  })
}

export function useCreatePartner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      email: string
      phone?: string
      tier?: 'STUDENT_AMBASSADOR' | 'CAMPUS_REPRESENTATIVE' | 'MARKETING_PARTNER'
      commissionBasisPoints?: number
      holdingDays?: number
      notes?: string
    }) => {
      const res = await fetch('/api/admin/referrals/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not create partner')
      }
      return body as { partner: unknown }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_PARTNERS_KEY })
    },
  })
}

export function useApproveCommission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (commissionId: string) => {
      const res = await fetch(`/api/admin/referrals/commissions/${encodeURIComponent(commissionId)}/approve`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not approve commission')
      }
      return body as { commission: unknown }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_COMMISSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_COMMISSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_DASHBOARD_KEY })
    },
  })
}

export function useRejectCommission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (commissionId: string) => {
      const res = await fetch(`/api/admin/referrals/commissions/${encodeURIComponent(commissionId)}/reject`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not reject commission')
      }
      return body as { commission: unknown }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_COMMISSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_COMMISSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_DASHBOARD_KEY })
    },
  })
}

export function useRecordPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      partnerId: string
      amountPaise: number
      commissionIds: string[]
      method?: string
      reference?: string
      notes?: string
    }) => {
      const res = await fetch('/api/admin/referrals/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? 'Could not record payout')
      }
      return body as { payout: unknown }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_COMMISSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: ADMIN_PARTNERS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_PAYOUTS_KEY })
      queryClient.invalidateQueries({ queryKey: REFERRAL_DASHBOARD_KEY })
    },
  })
}

/* ---------------- Apply Agent (V1) ---------------- */

export interface AgentPlanItem {
  index: number
  label: string
  kind: string
  required: boolean
  status: 'mapped' | 'ambiguous' | 'manual' | 'unsafe' | 'unmapped'
  canonical: string | null
  ambiguous: string[]
  needsReview: boolean
  reason: string
  firedByAi: boolean
  group?: string
}

export interface AgentPlanPreview {
  createdAt: string
  adapter?: string
  adapterLabel?: string | null
  adapterStatus?: string | null
  adapterNote?: string | null
  page?: {
    url: string
    kind: string
    fingerprint: string | null
    supported: boolean
  } | null
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

export interface AgentConnectionState {
  connected: boolean
  pairedAt: string | null
  expiresAt: string | null
  plan: AgentPlanPreview | null
  planAt: string | null
}

const AGENT_STATE_KEY = ['apply-agent', 'state'] as const

/** Live connection state + last detection plan preview. Light polling keeps
 * the page current while the extension scans/fills. */
export function useAgentState(enabled: boolean) {
  return useQuery({
    queryKey: AGENT_STATE_KEY,
    queryFn: () => jsonFetcher<AgentConnectionState>('/api/agent/plan'),
    enabled,
    refetchInterval: 4000,
  })
}

export function useCreatePairingTicket() {
  return useMutation({
    mutationFn: async (): Promise<{ code: string; expiresAt: string }> => {
      const res = await fetch('/api/agent/pairing-ticket', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { code?: string; expiresAt?: string; error?: string } | null
      if (!res.ok || !body?.code || !body?.expiresAt) {
        throw new Error(body?.error ?? 'Could not create a pairing code')
      }
      return { code: body.code, expiresAt: body.expiresAt }
    },
  })
}

export function useRevokeAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const res = await fetch('/api/agent/revoke', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { revoked?: number; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? 'Could not disconnect the agent')
      return body?.revoked ?? 0
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENT_STATE_KEY })
    },
  })
}
