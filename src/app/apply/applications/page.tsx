'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ApplyHeader } from '@/components/apply/apply-header'
import { AddApplicationDialog } from '@/components/apply/add-application-dialog'
import { ApplicationCard } from '@/components/apply/application-card'
import { RemindersPanel } from '@/components/apply/reminders-panel'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'
import { useApplications, useEnsureWorkspace } from '@/lib/apply-ai/api-client'
import { deadlineDaysUntil } from '@/lib/apply-ai/applications'
import type { ApplicationWithEvaluation, ExamId } from '@/lib/apply-ai/types'

const emptySubscribe = () => () => {}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

type StatusFilter = 'all' | 'active' | 'attention' | 'submitted'

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'submitted', label: 'Submitted' },
]

function isSubmitted(application: ApplicationWithEvaluation): boolean {
  return (
    application.status === 'SUBMITTED_STUDENT_CONFIRMED' ||
    application.status === 'PORTAL_CONFIRMATION_RECORDED'
  )
}

function needsAttention(application: ApplicationWithEvaluation): boolean {
  if (isSubmitted(application)) return false
  if (application.evaluation.missingCount > 0) return true
  if (application.evaluation.awaitingStudentCount > 0) return true
  if (application.evaluation.attentionRequiredCount > 0) return true
  if (application.evaluation.consistencyIssues.length > 0) return true
  if (application.evaluation.snapshotStale) return true
  if (application.deadline.catalogUpdated) return true
  if (application.deadline.date) {
    const days = deadlineDaysUntil(application.deadline.date)
    if (days !== null && days <= 30) return true
  }
  return (
    application.status === 'MISSING_INFORMATION' ||
    application.status === 'FILLED_AWAITING_STUDENT_REVIEW' ||
    application.status === 'WAITING_FOR_MANUAL_VERIFICATION'
  )
}

/**
 * Application Hub — the student's tracked examination applications.
 *
 * Records are server-persisted per workspace. Cards show only derived state:
 * status chosen by the student, progress computed from published requirements,
 * and deadline snapshots with their official source and verification date.
 */
export default function ApplicationsHubPage() {
  const hydrated = useHydrated()
  const { ready: workspaceReady, status: workspaceStatus } = useEnsureWorkspace()
  const dataBlocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'
  const applicationsQuery = useApplications(workspaceReady && !dataBlocked)

  const [addOpen, setAddOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [examFilter, setExamFilter] = useState<'all' | ExamId>('all')

  const applications = useMemo(
    () => applicationsQuery.data?.applications ?? [],
    [applicationsQuery.data]
  )
  const reminders = applicationsQuery.data?.reminders ?? []

  const counts = useMemo(
    () => ({
      total: applications.length,
      active: applications.filter(app => !isSubmitted(app)).length,
      attention: applications.filter(needsAttention).length,
      submitted: applications.filter(isSubmitted).length,
    }),
    [applications]
  )

  const examOptions = useMemo(() => {
    const seen = new Map<ExamId, string>()
    for (const application of applications) {
      if (!seen.has(application.examId)) seen.set(application.examId, application.examName)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [applications])

  const filtered = useMemo(
    () =>
      applications.filter(application => {
        if (examFilter !== 'all' && application.examId !== examFilter) return false
        if (statusFilter === 'active') return !isSubmitted(application)
        if (statusFilter === 'submitted') return isSubmitted(application)
        if (statusFilter === 'attention') return needsAttention(application)
        return true
      }),
    [applications, statusFilter, examFilter]
  )

  const loading =
    !hydrated ||
    !workspaceReady ||
    (!dataBlocked && applicationsQuery.isLoading)
  const errored = !dataBlocked && applicationsQuery.isError

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='applications' />

      <main className='flex-1'>
        <section className='relative py-10 sm:py-14 overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10' />
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
            <div className='flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6'>
              <div className='max-w-2xl'>
                <span className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mb-4'>
                  Application Hub
                </span>
                <h1 className='text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3'>
                  Your exam <span className='text-primary'>applications</span>
                </h1>
                <p className='text-muted-foreground'>
                  Track every application in one place — status, published requirements, verified
                  deadlines and reminders. Ranks and results are never required, and Formlee never
                  submits on your behalf.
                </p>
              </div>
              <button
                type='button'
                onClick={() => setAddOpen(true)}
                className='self-start lg:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm'
              >
                <span aria-hidden>+</span> Add examination
              </button>
            </div>
          </div>
        </section>

        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
          <SaveWorkBanner status={workspaceStatus} />
        </section>

        {errored && !loading ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='bg-red-50 border border-red-200 rounded-xl p-6 text-center max-w-lg mx-auto'>
              <p className='text-sm font-semibold text-red-700 mb-1'>Could not load your applications</p>
              <p className='text-xs text-red-600 mb-4'>
                {(applicationsQuery.error as Error | null)?.message ??
                  'An unexpected error occurred.'}
              </p>
              <button
                type='button'
                onClick={() => void applicationsQuery.refetch()}
                className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
              >
                Retry
              </button>
            </div>
          </section>
        ) : loading ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6'>
              {[0, 1, 2, 3].map(n => (
                <div key={n} className='h-20 rounded-xl bg-muted/40 animate-pulse' />
              ))}
            </div>
            <div className='grid md:grid-cols-2 xl:grid-cols-3 gap-4'>
              {[0, 1, 2].map(n => (
                <div key={n} className='h-80 rounded-2xl bg-muted/40 animate-pulse' />
              ))}
            </div>
          </section>
        ) : (
          <>
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4'>
              <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
                <SummaryChip label='Tracked applications' value={counts.total} />
                <SummaryChip label='Active' value={counts.active} />
                <SummaryChip
                  label='Needs attention'
                  value={counts.attention}
                  tone={counts.attention > 0 ? 'warning' : 'default'}
                />
                <SummaryChip label='Submitted (student-confirmed)' value={counts.submitted} tone='success' />
              </div>
            </section>

            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4'>
              <RemindersPanel reminders={reminders} />
            </section>

            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10'>
              <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5'>
                <div>
                  <h2 className='text-xl font-bold text-foreground'>Tracked applications</h2>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    One record per exam, session and application year.
                  </p>
                </div>
                {applications.length > 0 && (
                  <div className='flex flex-wrap items-center gap-2'>
                    <div className='flex rounded-lg border border-border bg-background p-0.5 overflow-x-auto'>
                      {FILTERS.map(filter => (
                        <button
                          key={filter.id}
                          type='button'
                          onClick={() => setStatusFilter(filter.id)}
                          aria-pressed={statusFilter === filter.id}
                          className={
                            'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ' +
                            (statusFilter === filter.id
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground')
                          }
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                    {examOptions.length > 1 && (
                      <select
                        value={examFilter}
                        onChange={event => setExamFilter(event.target.value as 'all' | ExamId)}
                        aria-label='Filter by examination'
                        className='px-3 py-2 rounded-lg border border-border bg-background text-xs font-medium text-foreground'
                      >
                        <option value='all'>All exams</option>
                        {examOptions.map(option => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {applications.length === 0 ? (
                <EmptyState onAdd={() => setAddOpen(true)} />
              ) : filtered.length === 0 ? (
                <div className='bg-background border border-border rounded-2xl p-8 text-center'>
                  <p className='text-sm font-semibold text-foreground'>No applications match these filters</p>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Try a different status or examination filter.
                  </p>
                  <button
                    type='button'
                    onClick={() => {
                      setStatusFilter('all')
                      setExamFilter('all')
                    }}
                    className='mt-3 px-4 py-2 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5'
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className='grid md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 items-stretch'>
                  {filtered.map(application => (
                    <ApplicationCard key={application.id} application={application} />
                  ))}
                </div>
              )}
            </section>

            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12'>
              <div className='rounded-2xl border border-border bg-background p-5 sm:p-6'>
                <h2 className='font-semibold text-foreground'>What Formlee does — and does not do</h2>
                <div className='grid sm:grid-cols-3 gap-4 mt-3 text-xs text-muted-foreground'>
                  <p>
                    <strong className='text-foreground block mb-1'>Tracks preparation</strong>
                    Requirements come from published official instructions, and progress is computed
                    from your real profile, documents and checklist confirmations.
                  </p>
                  <p>
                    <strong className='text-foreground block mb-1'>Shows verified dates</strong>
                    Every deadline carries its official source and the date it was checked. Missing
                    dates are shown as “not announced”, never copied from an old cycle.
                  </p>
                  <p>
                    <strong className='text-foreground block mb-1'>Never claims submission</strong>
                    You fill and submit on the official portal. A submitted status exists only after
                    you explicitly record it, and portal references stay student-attested.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className='border-t border-border bg-background py-8'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground'>
          <p>Formlee — your reusable profile and document workspace for entrance-exam applications.</p>
          <p className='mt-1'>
            Checklist completion never proves eligibility. Reminders are in-app only; no SMS, email or
            push notifications are sent.
          </p>
        </div>
      </footer>

      <AddApplicationDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        applications={applications}
      />
    </div>
  )
}

function SummaryChip({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'warning' | 'success'
}) {
  const valueClass =
    tone === 'warning' && value > 0
      ? 'text-amber-700'
      : tone === 'success' && value > 0
        ? 'text-emerald-700'
        : 'text-foreground'
  return (
    <div className='bg-background border border-border rounded-xl p-4'>
      <p className='text-xs text-muted-foreground mb-1'>{label}</p>
      <p className={'text-2xl font-bold ' + valueClass}>{value}</p>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className='bg-background border border-dashed border-border rounded-2xl p-8 sm:p-12 text-center'>
      <div className='w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center text-2xl' aria-hidden>
        🗂️
      </div>
      <h3 className='mt-4 text-lg font-bold text-foreground'>No applications tracked yet</h3>
      <p className='mt-1 text-sm text-muted-foreground max-w-md mx-auto'>
        Add an examination to see its verified deadlines, published requirements and your own
        preparation status in one place. You can add more at any time — before results or ranks.
      </p>
      <button
        type='button'
        onClick={onAdd}
        className='mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors'
      >
        <span aria-hidden>+</span> Add your first examination
      </button>
      <p className='mt-4 text-[11px] text-muted-foreground'>
        Prefer the overview? Visit the{' '}
        <Link href='/apply' className='text-primary hover:underline'>
          workspace dashboard
        </Link>
        .
      </p>
    </div>
  )
}
