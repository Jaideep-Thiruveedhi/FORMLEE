'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ApplyHeader } from '@/components/apply/apply-header'
import { ApplicationRequirements } from '@/components/apply/application-requirements'
import { ApplicationSubmission } from '@/components/apply/application-submission'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'
import {
  DeadlineStateBadge,
  HubStatusBadge,
  NeedsUpdateBadge,
  SupportStatusBadge,
} from '@/components/apply/status-badge'
import {
  useApplication,
  useDeleteApplication,
  useEnsureWorkspace,
  useUpdateApplication,
} from '@/lib/apply-ai/api-client'
import {
  HUB_APPLICATION_STATUSES,
  HUB_STATUS_DEFINITIONS,
} from '@/lib/apply-ai/application-status'
import { deadlineDaysUntil, formatDateOnly } from '@/lib/apply-ai/applications'
import { EXAM_BY_ID } from '@/lib/apply-ai/exams'
import { PROFILE_SECTIONS } from '@/lib/apply-ai/profile'
import type {
  ApplicationWithEvaluation,
  HubApplicationStatus,
} from '@/lib/apply-ai/types'

const emptySubscribe = () => () => {}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'An unexpected error occurred'
}

const PROFILE_FIELD_LABELS = new Map(
  PROFILE_SECTIONS.flatMap(section => section.fields.map(field => [field.id, field.label]))
)

function mappingFieldLabel(fieldId: string): string {
  if (fieldId === 'documents') return 'Document references'
  return PROFILE_FIELD_LABELS.get(fieldId) ?? fieldId.replace(/([A-Z])/g, ' $1')
}

export default function ApplicationDetailPage() {
  const hydrated = useHydrated()
  const params = useParams<{ id: string }>()
  const id = typeof params.id === 'string' ? params.id : ''
  const { ready: workspaceReady, status: workspaceStatus } = useEnsureWorkspace()
  const blocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'
  const query = useApplication(id, workspaceReady && !blocked)

  const loading = !hydrated || !workspaceReady || (!blocked && query.isLoading)

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='applications' />

      <main className='flex-1'>
        <div className='max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6'>
          <Link
            href='/apply/applications'
            className='inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary'
          >
            ← Application Hub
          </Link>

          <div className='mt-3'>
            <SaveWorkBanner status={workspaceStatus} />
          </div>

          {loading ? (
            <div className='mt-5 space-y-4'>
              <div className='h-40 rounded-2xl bg-muted/40 animate-pulse' />
              <div className='grid lg:grid-cols-2 gap-4'>
                <div className='h-64 rounded-2xl bg-muted/40 animate-pulse' />
                <div className='h-64 rounded-2xl bg-muted/40 animate-pulse' />
              </div>
            </div>
          ) : blocked ? (
            <div className='mt-5 rounded-2xl border border-border bg-background p-6'>
              <h1 className='text-lg font-bold text-foreground'>This application is not available here</h1>
              <p className='text-sm text-muted-foreground mt-1'>
                Save this browser workspace to your account or sign in to the account that owns it.
                Applications are never merged or exposed across workspaces.
              </p>
            </div>
          ) : query.isError || !query.data ? (
            <div className='mt-5 rounded-2xl border border-red-200 bg-red-50 p-6 text-center'>
              <h1 className='text-sm font-bold text-red-800'>Could not load this application</h1>
              <p className='text-xs text-red-700 mt-1'>
                {errorMessage(query.error)}
              </p>
              <button
                type='button'
                onClick={() => void query.refetch()}
                className='mt-3 px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
              >
                Retry
              </button>
            </div>
          ) : (
            <ApplicationDetail application={query.data.application} />
          )}
        </div>
      </main>
    </div>
  )
}

function ApplicationDetail({ application }: { application: ApplicationWithEvaluation }) {
  const updateMutation = useUpdateApplication(application.id)
  const exam = EXAM_BY_ID[application.examId]
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const daysUntilDeadline = application.deadline.date
    ? deadlineDaysUntil(application.deadline.date)
    : null

  const toggleManual = async (requirementId: string, done: boolean) => {
    setTogglingId(requirementId)
    setUpdateError(null)
    setUpdateMessage(null)
    try {
      await updateMutation.mutateAsync({ checklist: { [requirementId]: done } })
      setUpdateMessage('Checklist confirmation saved.')
    } catch (cause) {
      setUpdateError(errorMessage(cause))
    } finally {
      setTogglingId(null)
    }
  }

  const refreshDeadline = async () => {
    setUpdateError(null)
    setUpdateMessage(null)
    try {
      await updateMutation.mutateAsync({ refreshDeadline: true })
      setUpdateMessage('Deadline refreshed from the verified catalog.')
    } catch (cause) {
      setUpdateError(errorMessage(cause))
    }
  }

  return (
    <div className='mt-5 space-y-4'>
      <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
        <div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4'>
          <div className='flex items-start gap-3 min-w-0'>
            <div className='w-12 h-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-2xl' aria-hidden>
              {application.examIcon}
            </div>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='text-xl sm:text-2xl font-bold text-foreground leading-tight'>
                  {application.examName}
                </h1>
                <SupportStatusBadge status={application.supportStatus} />
              </div>
              <p className='text-sm text-muted-foreground mt-0.5'>
                {application.examFullName} · {application.examOrganizer}
              </p>
              <p className='text-xs text-muted-foreground mt-1'>
                {application.sessionLabel} · Application year {application.applicationYear}
              </p>
              {application.officialWebsite && (
                <a
                  href={application.officialWebsite}
                  target='_blank'
                  rel='noreferrer'
                  className='text-xs font-semibold text-primary hover:underline mt-1 inline-block'
                >
                  Official website ↗
                </a>
              )}
            </div>
          </div>
          <div className='flex flex-col items-start sm:items-end gap-2'>
            <HubStatusBadge status={application.status} />
            <p className='text-[11px] text-muted-foreground text-right'>
              Updated {formatTimestamp(application.updatedAt)}
            </p>
          </div>
        </div>
        <p className='mt-3 text-xs text-muted-foreground border-t border-border pt-3'>
          {application.supportNote}
        </p>
      </section>

      <MappingReviewPanel application={application} />

      <div className='grid lg:grid-cols-2 gap-4'>
        <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-lg font-bold text-foreground'>Deadline</h2>
            <div className='flex flex-wrap items-center gap-1.5'>
              <DeadlineStateBadge state={application.deadline.state} />
              {application.deadline.needsUpdate && <NeedsUpdateBadge />}
            </div>
          </div>

          <p className='mt-3 text-2xl font-bold text-foreground'>
            {application.deadline.date ? formatDateOnly(application.deadline.date) : 'Not announced'}
          </p>
          <p className='text-xs text-muted-foreground'>{application.deadline.label}</p>

          {daysUntilDeadline !== null && (
            <p
              className={
                'mt-2 text-xs font-semibold ' +
                (daysUntilDeadline < 0
                  ? 'text-rose-700'
                  : daysUntilDeadline <= 7
                    ? 'text-rose-700'
                    : daysUntilDeadline <= 30
                      ? 'text-amber-700'
                      : 'text-muted-foreground')
              }
            >
              {daysUntilDeadline < 0
                ? `Passed ${Math.abs(daysUntilDeadline)} day${Math.abs(daysUntilDeadline) === 1 ? '' : 's'} ago — verify any officially announced late window.`
                : daysUntilDeadline === 0
                  ? 'Due today — confirm the exact closing time on the official portal.'
                  : `${daysUntilDeadline} day${daysUntilDeadline === 1 ? '' : 's'} remaining.`}
            </p>
          )}

          <p className='mt-3 text-xs text-muted-foreground'>{application.deadline.note}</p>

          {application.deadline.source ? (
            <div className='mt-3 rounded-lg bg-muted/50 border border-border px-3 py-2'>
              <a
                href={application.deadline.source.url}
                target='_blank'
                rel='noreferrer'
                className='text-[11px] font-semibold text-primary hover:underline'
              >
                {application.deadline.source.label}
              </a>
              <p className='text-[10px] text-muted-foreground mt-0.5'>
                Checked {formatDateOnly(application.deadline.source.verifiedOn)}
                {application.deadline.catalogUpdated
                  ? ' · catalog has newer information'
                  : ''}
              </p>
            </div>
          ) : (
            <p className='mt-3 text-[11px] text-muted-foreground'>
              No official source is recorded for this deadline.
            </p>
          )}

          <div className='mt-3 flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={() => void refreshDeadline()}
              disabled={updateMutation.isPending}
              className='px-3 py-1.5 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 disabled:opacity-50'
            >
              {updateMutation.isPending ? 'Refreshing…' : 'Refresh from verified catalog'}
            </button>
            <span className='text-[10px] text-muted-foreground'>
              Never reuses a previous cycle’s date.
            </span>
          </div>
        </section>

        <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
          <h2 className='text-lg font-bold text-foreground'>Progress</h2>
          {application.evaluation.progressPercent === null ? (
            <>
              <p className='mt-3 text-sm text-muted-foreground'>
                An official 2027 requirement list is not published, so Formlee does not show a
                checklist percentage.
              </p>
              <div className='mt-3 grid grid-cols-2 gap-3'>
                <div className='rounded-xl border border-border p-3'>
                  <p className='text-[11px] text-muted-foreground'>Profile sections</p>
                  <p className='text-lg font-bold text-foreground'>
                    {application.evaluation.reusableWorkspace.sectionsComplete} /{' '}
                    {application.evaluation.reusableWorkspace.sectionsTotal}
                  </p>
                </div>
                <div className='rounded-xl border border-border p-3'>
                  <p className='text-[11px] text-muted-foreground'>Documents</p>
                  <p className='text-lg font-bold text-foreground'>
                    {application.evaluation.reusableWorkspace.documentsUploaded} /{' '}
                    {application.evaluation.reusableWorkspace.documentsTotal}
                  </p>
                </div>
              </div>
              <p className='mt-3 text-[11px] text-muted-foreground'>
                These reusable workspace totals are not an exam-specific progress score.
              </p>
            </>
          ) : (
            <>
              <div className='mt-3 flex items-baseline gap-2'>
                <span className='text-3xl font-bold text-foreground'>
                  {application.evaluation.progressPercent}%
                </span>
                <span className='text-xs text-muted-foreground'>
                  {application.evaluation.completeCount} of{' '}
                  {application.evaluation.applicableCount} published items
                </span>
              </div>
              <div
                className='mt-2 h-2.5 bg-muted rounded-full overflow-hidden'
                role='progressbar'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={application.evaluation.progressPercent}
                aria-label='Requirement progress'
              >
                <div
                  className={
                    'h-full rounded-full ' +
                    (application.evaluation.allRequirementsMet ? 'bg-emerald-500' : 'bg-primary')
                  }
                  style={{ width: `${application.evaluation.progressPercent}%` }}
                />
              </div>
              <div className='mt-3 space-y-1.5'>
                {application.evaluation.categoryBreakdown.map(category => (
                  <div key={category.category} className='flex items-center justify-between text-xs'>
                    <span className='text-muted-foreground'>{category.label}</span>
                    <span className='font-medium text-foreground'>
                      {category.complete}/{category.total}
                    </span>
                  </div>
                ))}
              </div>
              <p className='mt-3 text-[11px] text-muted-foreground'>
                {application.evaluation.missingCount} missing ·{' '}
                {application.evaluation.awaitingStudentCount} awaiting your confirmation
                {application.evaluation.needsConfirmationCount > 0
                  ? ` · ${application.evaluation.needsConfirmationCount} need explicit confirmation`
                  : ''}
                {application.evaluation.awaitingResultsCount > 0
                  ? ` · ${application.evaluation.awaitingResultsCount} awaiting Class 12 results`
                  : ''}
                . Progress comes from actual records, never a self-declared percentage.
              </p>
            </>
          )}

          {application.evaluation.nextAction && (
            application.evaluation.nextAction.kind === 'portal' ? (
              <a
                href={application.evaluation.nextAction.href}
                target='_blank'
                rel='noreferrer'
                className='mt-4 inline-flex px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
              >
                {application.evaluation.nextAction.label} ↗
              </a>
            ) : (
              <Link
                href={application.evaluation.nextAction.href}
                className='mt-4 inline-flex px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
              >
                {application.evaluation.nextAction.label}
              </Link>
            )
          )}
        </section>

        <ReadinessPanel evaluation={application.evaluation} />
      </div>

      {(updateMessage || updateError) && (
        <p
          className={
            'text-xs rounded-lg px-3 py-2 border ' +
            (updateError
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-emerald-800 bg-emerald-50 border-emerald-200')
          }
        >
          {updateError ?? updateMessage}
        </p>
      )}

      <ApplicationRequirements
        application={application}
        onToggleManual={(requirementId, done) => void toggleManual(requirementId, done)}
        togglingId={togglingId}
      />

      <div className='grid lg:grid-cols-2 gap-4'>
        <StatusPanel key={application.status} application={application} />
        <PreferencesPanel application={application} />
      </div>

      <NotesPanel application={application} />

      <ApplicationSubmission
        key={`${application.submission.studentConfirmedAt ?? 'none'}-${application.submission.portalReferenceRecordedAt ?? 'none'}`}
        application={application}
      />

      {exam && (
        <p className='text-[11px] text-muted-foreground px-1'>
          Catalog entry checked {formatDateOnly(exam.catalogVerifiedOn)}. Requirements are a
          preparation aid, not an eligibility decision.
        </p>
      )}

      <DangerZone application={application} />
    </div>
  )
}

/**
 * Shown when the live vault has moved on from the snapshot used to prepare this
 * application. Nothing is silently rewritten: the student reviews the changed
 * fields and explicitly approves a refreshed snapshot.
 */
function ReadinessPanel({ evaluation }: { evaluation: ApplicationWithEvaluation['evaluation'] }) {
  const stateLabels: Record<typeof evaluation.readinessState, string> = {
    READY: 'Ready',
    PARTIALLY_READY: 'Partially ready',
    MISSING_INFORMATION: 'Missing information',
    NEEDS_CONFIRMATION: 'Needs confirmation',
    DOCUMENT_ATTENTION_REQUIRED: 'Document attention required',
    NOT_APPLICABLE: 'Not applicable',
  }
  const stateClasses: Record<typeof evaluation.readinessState, string> = {
    READY: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    PARTIALLY_READY: 'bg-amber-50 text-amber-900 border-amber-200',
    MISSING_INFORMATION: 'bg-orange-50 text-orange-900 border-orange-200',
    NEEDS_CONFIRMATION: 'bg-sky-50 text-sky-900 border-sky-200',
    DOCUMENT_ATTENTION_REQUIRED: 'bg-rose-50 text-rose-900 border-rose-200',
    NOT_APPLICABLE: 'bg-gray-50 text-gray-800 border-gray-200',
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <h2 className='text-lg font-bold text-foreground'>Readiness</h2>
      <div className={'mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ' + stateClasses[evaluation.readinessState]}>
        {stateLabels[evaluation.readinessState]}
      </div>
      <p className='mt-3 text-xs text-muted-foreground'>
        {evaluation.readinessState === 'READY' && 'All published requirements are satisfied and no vault differences were detected.'}
        {evaluation.readinessState === 'PARTIALLY_READY' && 'Most requirements are met, but there are pending confirmations, awaited results, vault differences or a newer snapshot to review.'}
        {evaluation.readinessState === 'MISSING_INFORMATION' && 'Some required profile sections or documents are still missing.'}
        {evaluation.readinessState === 'NEEDS_CONFIRMATION' && 'A profile answer needs your explicit confirmation before it can be used.'}
        {evaluation.readinessState === 'DOCUMENT_ATTENTION_REQUIRED' && 'A required document exists but its file type, size, dimensions or certificate metadata need attention.'}
        {evaluation.readinessState === 'NOT_APPLICABLE' && 'No official checklist is published for this session yet.'}
      </p>

      {evaluation.documentIssues.length > 0 && (
        <div className='mt-4'>
          <h3 className='text-xs font-semibold text-foreground mb-1.5'>Document issues</h3>
          <ul className='space-y-1.5'>
            {evaluation.documentIssues.map((issue, index) => (
              <li key={`doc-${index}`} className='text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5'>
                <span className='font-semibold'>{issue.code}:</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.certificateIssues.length > 0 && (
        <div className='mt-4'>
          <h3 className='text-xs font-semibold text-foreground mb-1.5'>Certificate issues</h3>
          <ul className='space-y-1.5'>
            {evaluation.certificateIssues.map((issue, index) => (
              <li key={`cert-${index}`} className='text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5'>
                <span className='font-semibold'>{issue.code}:</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.consistencyIssues.length > 0 && (
        <div className='mt-4'>
          <h3 className='text-xs font-semibold text-foreground mb-1.5'>Differs from vault snapshot</h3>
          <ul className='space-y-1.5'>
            {evaluation.consistencyIssues.map((issue, index) => (
              <li key={`consistency-${index}`} className='text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5'>
                <span className='font-semibold'>{issue.field}:</span> vault says “{issue.vaultValue ?? '—'}”, application has “{issue.applicationValue ?? '—'}”. {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.snapshotStale && (
        <p className='mt-4 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5'>
          Your vault has been updated since this application snapshot was taken. Review the mapping panel above.
        </p>
      )}
    </section>
  )
}

function MappingReviewPanel({ application }: { application: ApplicationWithEvaluation }) {
  const mutation = useUpdateApplication(application.id)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!application.mappingReviewRequired) return null

  const approve = async () => {
    setMessage(null)
    setError(null)
    try {
      await mutation.mutateAsync({ reviewMapping: true })
      setMessage(
        'Mapping approved. The snapshot now matches your current vault. Anything you already entered on the official portal is unchanged — re-check those fields there.'
      )
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className='bg-amber-50 border border-amber-300 rounded-2xl p-5 sm:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-base font-bold text-amber-950'>Your vault changed after this application was prepared</h2>
          <p className='text-xs text-amber-900 mt-1 max-w-2xl'>
            Formlee kept the original profile snapshot and flagged this application instead of overwriting it.
            Review the changed fields, then approve the refreshed mapping. Your exam-specific preferences and
            checklist answers stay on this application record.
          </p>
        </div>
        <span className='px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300'>
          Student review required
        </span>
      </div>

      {application.mappingChangedFields.length > 0 && (
        <p className='mt-3 text-xs text-amber-900'>
          <strong className='font-semibold'>Changed:</strong>{' '}
          {application.mappingChangedFields.map(mappingFieldLabel).join(', ')}
        </p>
      )}

      <p className='mt-2 text-[11px] text-amber-800'>
        Prepared from vault version {application.profileVersion ?? 'unknown'}
        {application.profileSnapshotAt
          ? ` on ${formatTimestamp(application.profileSnapshotAt)}`
          : ''}
        . Approving never submits anything and never uploads documents.
      </p>

      <button
        type='button'
        onClick={() => void approve()}
        disabled={mutation.isPending}
        className='mt-3 px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
      >
        {mutation.isPending ? 'Approving…' : 'Review and approve refreshed mapping'}
      </button>

      {message && <p className='mt-2 text-xs text-emerald-800'>{message}</p>}
      {error && <p className='mt-2 text-xs text-red-700'>{error}</p>}
    </section>
  )
}

function StatusPanel({ application }: { application: ApplicationWithEvaluation }) {
  const mutation = useUpdateApplication(application.id)
  const [status, setStatus] = useState<HubApplicationStatus>(application.status)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const currentSubmitted =
    application.status === 'SUBMITTED_STUDENT_CONFIRMED' ||
    application.status === 'PORTAL_CONFIRMATION_RECORDED'
  const selectable = HUB_APPLICATION_STATUSES.filter(
    value => !HUB_STATUS_DEFINITIONS[value].submitted
  )

  const save = async () => {
    setMessage(null)
    setError(null)
    try {
      await mutation.mutateAsync({ status })
      setMessage('Preparation status saved.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <h2 className='text-lg font-bold text-foreground'>Preparation status</h2>
      <p className='text-xs text-muted-foreground mt-0.5'>
        Your own tracking status. It never changes submission records by itself.
      </p>

      {currentSubmitted ? (
        <div className='mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900'>
          This application is in a submission state. Clear the submission record below before
          changing preparation status.
        </div>
      ) : (
        <>
          <label htmlFor='hub-status' className='block text-xs font-semibold text-foreground mt-3'>
            Status
          </label>
          <select
            id='hub-status'
            value={status}
            onChange={event => setStatus(event.target.value as HubApplicationStatus)}
            className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
          >
            {selectable.map(value => (
              <option key={value} value={value}>
                {HUB_STATUS_DEFINITIONS[value].label}
              </option>
            ))}
          </select>
          <p className='mt-2 text-[11px] text-muted-foreground'>
            {HUB_STATUS_DEFINITIONS[status]?.description}
          </p>
          <button
            type='button'
            onClick={() => void save()}
            disabled={mutation.isPending || status === application.status}
            className='mt-3 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {mutation.isPending ? 'Saving…' : 'Save status'}
          </button>
        </>
      )}

      {message && <p className='mt-2 text-xs text-emerald-700'>{message}</p>}
      {error && <p className='mt-2 text-xs text-red-700'>{error}</p>}
    </section>
  )
}

function PreferencesPanel({ application }: { application: ApplicationWithEvaluation }) {
  const mutation = useUpdateApplication(application.id)
  const exam = EXAM_BY_ID[application.examId]
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of exam?.preferenceFields ?? []) {
      initial[field.id] = application.preferences[field.id] ?? ''
    }
    return initial
  })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setMessage(null)
    setError(null)
    try {
      await mutation.mutateAsync({ preferences: values })
      setMessage('Preferences saved.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <h2 className='text-lg font-bold text-foreground'>Preferences</h2>
      <p className='text-xs text-muted-foreground mt-0.5'>
        Planning notes for your own reference. Official choices are made on the portal.
      </p>

      <div className='mt-3 space-y-3'>
        {(exam?.preferenceFields ?? []).map(field => (
          <div key={field.id}>
            <label htmlFor={`preference-${field.id}`} className='block text-xs font-semibold text-foreground'>
              {field.label}
            </label>
            <input
              id={`preference-${field.id}`}
              type='text'
              value={values[field.id] ?? ''}
              maxLength={field.maxLength}
              placeholder={field.placeholder}
              onChange={event =>
                setValues(current => ({ ...current, [field.id]: event.target.value }))
              }
              className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
            />
            {field.help && (
              <p className='text-[10px] text-muted-foreground mt-1'>{field.help}</p>
            )}
          </div>
        ))}
      </div>

      <button
        type='button'
        onClick={() => void save()}
        disabled={mutation.isPending}
        className='mt-3 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
      >
        {mutation.isPending ? 'Saving…' : 'Save preferences'}
      </button>

      {message && <p className='mt-2 text-xs text-emerald-700'>{message}</p>}
      {error && <p className='mt-2 text-xs text-red-700'>{error}</p>}
    </section>
  )
}

function NotesPanel({ application }: { application: ApplicationWithEvaluation }) {
  const mutation = useUpdateApplication(application.id)
  const [notes, setNotes] = useState(application.notes ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setMessage(null)
    setError(null)
    try {
      await mutation.mutateAsync({ notes: notes.trim().length > 0 ? notes : null })
      setMessage('Notes saved.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <h2 className='text-lg font-bold text-foreground'>Notes</h2>
      <p className='text-xs text-muted-foreground mt-0.5'>
        Private to this workspace. Do not store passwords, OTPs or payment details.
      </p>
      <textarea
        value={notes}
        maxLength={4000}
        rows={3}
        onChange={event => setNotes(event.target.value)}
        placeholder='e.g. reminder to re-check the official bulletin before filling'
        className='mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
      />
      <div className='flex items-center gap-3 mt-2'>
        <button
          type='button'
          onClick={() => void save()}
          disabled={mutation.isPending}
          className='px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
        >
          {mutation.isPending ? 'Saving…' : 'Save notes'}
        </button>
        <span className='text-[10px] text-muted-foreground'>{notes.length} / 4000</span>
      </div>
      {message && <p className='mt-2 text-xs text-emerald-700'>{message}</p>}
      {error && <p className='mt-2 text-xs text-red-700'>{error}</p>}
    </section>
  )
}

function DangerZone({ application }: { application: ApplicationWithEvaluation }) {
  const deleteMutation = useDeleteApplication()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setError(null)
    if (
      !window.confirm(
        `Stop tracking this ${application.examName} application? Your profile, documents and submission history for other applications are not affected.`
      )
    ) {
      return
    }
    try {
      await deleteMutation.mutateAsync(application.id)
      router.push('/apply/applications')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <h2 className='text-sm font-bold text-foreground'>Remove tracking</h2>
      <p className='text-xs text-muted-foreground mt-1'>
        Deletes this application record only. It does not delete your reusable profile, documents or
        any other application, and it does not affect the official portal.
      </p>
      <button
        type='button'
        onClick={() => void remove()}
        disabled={deleteMutation.isPending}
        className='mt-3 px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50'
      >
        {deleteMutation.isPending ? 'Removing…' : 'Remove this application'}
      </button>
      {error && <p className='mt-2 text-xs text-red-700'>{error}</p>}
    </section>
  )
}
