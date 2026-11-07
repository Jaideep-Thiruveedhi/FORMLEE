'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { EXAMS, OFFICIAL_SOURCE_NOTE } from '@/lib/apply-ai/exams'
import { useApplyStore } from '@/lib/apply-ai/store'
import {
  evaluateExamRequirements,
  evaluateProfile,
  getApplicationStatus,
  isDocumentApplicable,
  isDocumentUploaded,
} from '@/lib/apply-ai/requirements'
import { DOCUMENT_TYPES } from '@/lib/apply-ai/documents'
import { useDocuments, useEnsureWorkspace, useProfile } from '@/lib/apply-ai/api-client'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'
import type { ApplicationStatus, ExamId, ExamRequirement } from '@/lib/apply-ai/types'
import { ApplyHeader } from '@/components/apply/apply-header'
import { ExamCard } from '@/components/apply/exam-card'
import { PreparationWorkflow } from '@/components/apply/preparation-workflow'
import { ProfileStatusBadge } from '@/components/apply/status-badge'

const emptySubscribe = () => () => {}

/**
 * Hydration guard for the persisted local tracker store: returns false during
 * SSR/hydration render and true after mount, without setState-in-effect
 * cascades.
 */
function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

const STATUS_SUMMARY_STYLES: Record<ApplicationStatus, string> = {
  NOT_STARTED: 'bg-secondary text-muted-foreground',
  PREPARING: 'bg-amber-50 text-amber-700',
  READY_FOR_REVIEW: 'bg-green-50 text-green-700',
}

/**
 * Formlee workspace dashboard: profile and documents are read from the
 * server workspace; readiness for each exam is computed from concrete
 * configured requirements, never from arbitrary percentages.
 */
export default function ApplyAIDashboard() {
  const hydrated = useHydrated()
  const { ready: workspaceReady, status: workspaceStatus, rerun: rerunWorkspace } = useEnsureWorkspace()
  const [activeExamId, setActiveExamId] = useState<ExamId | null>(null)

  // Claimable/unavailable states resolve no data (the workspace does not
  // belong to the caller yet): skip the queries instead of 401 error panels.
  const dataBlocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'
  const profileQuery = useProfile(workspaceReady && !dataBlocked)
  const documentsQuery = useDocuments(workspaceReady && !dataBlocked)

  const applications = useApplyStore(state => state.applications)
  const resetTracker = useApplyStore(state => state.resetTracker)

  const profile = profileQuery.data?.profile ?? null
  // Own memo so downstream useMemo dependency arrays see a stable reference.
  const documents = useMemo(() => documentsQuery.data?.documents ?? [], [documentsQuery.data])

  const profileEvaluation = useMemo(
    () => profileQuery.data?.evaluation ?? evaluateProfile(profile),
    [profileQuery.data, profile]
  )

  const requirementsByExam = useMemo(() => {
    const map = {} as Record<ExamId, { requirement: ExamRequirement; status: ApplicationStatus }>
    for (const exam of EXAMS) {
      const requirement = evaluateExamRequirements(exam.id, profile, documents)
      const started = !!applications[exam.id]
      map[exam.id] = {
        requirement,
        status: getApplicationStatus(requirement, started).status,
      }
    }
    return map
  }, [profile, documents, applications])

  const startedCount = useMemo(
    () => EXAMS.filter(exam => !!applications[exam.id]).length,
    [applications]
  )

  const applicableCoreDocs = useMemo(
    () =>
      DOCUMENT_TYPES.filter(
        doc => doc.id !== 'OTHER' && isDocumentApplicable(doc.id, profile)
      ),
    [profile]
  )
  const uploadedApplicableDocs = useMemo(
    () => applicableCoreDocs.filter(doc => isDocumentUploaded(doc.id, documents)).length,
    [applicableCoreDocs, documents]
  )

  const readyCount = useMemo(
    () =>
      EXAMS.filter(exam => requirementsByExam[exam.id].status === 'READY_FOR_REVIEW').length,
    [requirementsByExam]
  )

  const activeExam = EXAMS.find(exam => exam.id === activeExamId) ?? null

  const openExam = (examId: ExamId) => {
    setActiveExamId(examId)
    requestAnimationFrame(() =>
      document.getElementById('apply-active-exam')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }

  const loading =
    !hydrated ||
    !workspaceReady ||
    (!dataBlocked && (profileQuery.isLoading || documentsQuery.isLoading))
  const errored = !dataBlocked && (profileQuery.isError || documentsQuery.isError)

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='dashboard' />

      <main className='flex-1'>
        {/* Intro */}
        <section className='relative py-12 sm:py-16 overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10' />
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
            <div className='max-w-3xl'>
              <span className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mb-4'>
                Application workspace
              </span>
              <h1 className='text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-4'>
                Formlee <span className='text-primary'>workspace</span>
              </h1>
              <p className='text-lg text-muted-foreground max-w-2xl'>
                Manage your examination applications from one place. Build your profile once, upload each
                document once, and see exactly which readiness requirements remain for every exam - before you
                submit on the official portal yourself.
              </p>
              <p className='mt-3 text-xs text-muted-foreground max-w-2xl'>
                {OFFICIAL_SOURCE_NOTE}
              </p>
              <div className='mt-5 flex flex-wrap items-center gap-2'>
                <Link
                  href='/apply/applications'
                  className='inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors'
                >
                  Open Application Hub →
                </Link>
                <span className='text-xs text-muted-foreground'>
                  Track deadlines, requirements and per-exam status in one place.
                </span>
              </div>
            </div>
          </div>
        </section>

        {errored && !loading ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='bg-red-50 border border-red-200 rounded-xl p-6 text-center max-w-lg mx-auto'>
              <p className='text-sm font-semibold text-red-700 mb-1'>Could not load your workspace data</p>
              <p className='text-xs text-red-600 mb-4'>
                {(profileQuery.error as Error | null)?.message ??
                  (documentsQuery.error as Error | null)?.message ??
                  'An unexpected error occurred.'}
              </p>
              <div className='flex justify-center gap-2'>
                {profileQuery.isError && (
                  <button
                    type='button'
                    onClick={() => void profileQuery.refetch()}
                    className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
                  >
                    Retry profile
                  </button>
                )}
                {documentsQuery.isError && (
                  <button
                    type='button'
                    onClick={() => void documentsQuery.refetch()}
                    className='px-4 py-2 text-xs font-semibold text-primary border border-primary/30 bg-white rounded-lg hover:bg-primary/10'
                  >
                    Retry documents
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : loading ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6'>
              {[0, 1, 2, 3].map(n => (
                <div key={n} className='h-20 rounded-xl bg-muted/40 animate-pulse' />
              ))}
            </div>
            <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-4'>
              {EXAMS.map(exam => (
                <div key={exam.id} className='h-64 rounded-xl bg-muted/40 animate-pulse' />
              ))}
            </div>
          </section>
        ) : (
          <>
            {/* Workspace notice */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
              {workspaceStatus === 'existing' || workspaceStatus === 'created' ? (
              <div className='flex flex-col sm:flex-row sm:items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3'>
                <span className='text-lg' aria-hidden>🔍</span>
                <div className='text-xs text-amber-800 flex-1'>
                  <p>
                    <strong className='font-semibold'>Browser workspace:</strong> your profile and documents are
                    self-entered and unverified. Create an account or{' '}
                    <Link href='/login' className='font-semibold underline hover:text-amber-900'>
                      sign in
                    </Link>{' '}
                    to keep this work across devices.
                  </p>
                  <p className='mt-1'>
                    Formlee never submits applications, fills CAPTCHAs/OTPs, or makes payments, and never invents
                    exam deadlines, fees or eligibility rules.
                  </p>
                </div>
                <button
                  type='button'
                  onClick={() => {
                    if (window.confirm('Clear the local "application started" trackers? Your server profile and documents are not touched.'))
                      resetTracker()
                  }}
                  className='self-start sm:self-auto px-3 py-1.5 text-xs font-semibold text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors'
                >
                  Reset local trackers
                </button>
              </div>
              ) : (
                <SaveWorkBanner status={workspaceStatus} onSaved={rerunWorkspace} />
              )}
            </section>

            {/* Summary chips */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6'>
              <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
                <SummaryChip
                  label='Profile sections'
                  value={profileEvaluation.completedSections + ' / ' + profileEvaluation.totalSections}
                  progress={(profileEvaluation.completedSections / profileEvaluation.totalSections) * 100}
                />
                <SummaryChip
                  label='Applicable documents'
                  value={uploadedApplicableDocs + ' / ' + applicableCoreDocs.length}
                  progress={(uploadedApplicableDocs / applicableCoreDocs.length) * 100}
                />
                <SummaryChip label='Trackers started' value={startedCount + ' / ' + EXAMS.length} />
                <SummaryChip label='Ready for review' value={readyCount + ' / ' + EXAMS.length} />
              </div>
            </section>

            {/* Profile & documents quick links */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4'>
              <div className='grid md:grid-cols-2 gap-4'>
                <WorkspaceLinkCard
                  href='/apply/profile'
                  icon='P'
                  title='Student profile'
                  description='Identity, Class 10 & 12 academics and preferences â€” filled once, reused by every exam.'
                  stat={profileEvaluation.completedSections + ' of ' + profileEvaluation.totalSections + ' sections complete'}
                  badge={<ProfileStatusBadge status={profileEvaluation.status} />}
                />
                <WorkspaceLinkCard
                  href='/apply/documents'
                  icon='D'
                  title='Document manager'
                  description='Upload the checklist once â€” photograph, signature, marksheets â€” and reuse for every exam.'
                  stat={
                    isDocumentUploaded('PHOTO', documents) || uploadedApplicableDocs > 0
                      ? uploadedApplicableDocs + ' of ' + applicableCoreDocs.length + ' applicable core documents uploaded'
                      : 'No documents uploaded yet'
                  }
                  statNode={
                    <span className='inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border'>
                      Uploaded â‰  verified
                    </span>
                  }
                />
              </div>
            </section>

            {/* Exam dashboard */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12'>
              <div className='mb-6'>
                <h2 className='text-2xl font-bold text-foreground'>Examination dashboard</h2>
                <p className='text-muted-foreground mt-1 text-sm max-w-2xl'>
                  Every exam below reuses the same profile and checklist. Begin preparation to see exactly which
                  requirement items remain â€” readiness is computed from those configured items, not percentages.
                </p>
              </div>

              <div className='grid md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 items-start'>
                {EXAMS.map(exam => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    requirement={requirementsByExam[exam.id].requirement}
                    status={requirementsByExam[exam.id].status}
                    active={activeExamId === exam.id}
                    onOpen={() => openExam(exam.id)}
                  />
                ))}
              </div>

              {/* Per-exam guided panel */}
              <div id='apply-active-exam' className='scroll-mt-20' />
              {activeExamId && activeExam && (
                <div className='mt-8 bg-background border border-primary/30 ring-1 ring-primary/10 rounded-2xl p-5 sm:p-8'>
                  <div className='flex flex-wrap items-start justify-between gap-4 mb-6'>
                    <div className='flex items-center gap-3'>
                      <div className='w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl'>
                        {activeExam.icon}
                      </div>
                      <div>
                        <h3 className='text-xl font-bold text-foreground leading-tight'>
                          {activeExam.name} â€” application details
                        </h3>
                        <p className='text-sm text-muted-foreground'>
                          {activeExam.fullName} Â· {activeExam.organizer}
                        </p>
                      </div>
                    </div>
                    <span
                      className={'rounded-full px-2.5 py-1 text-xs font-semibold ' + STATUS_SUMMARY_STYLES[requirementsByExam[activeExamId].status]}
                    >
                      {requirementsByExam[activeExamId].requirement.metCount} of{' '}
                      {requirementsByExam[activeExamId].requirement.totalCount} requirement items met
                    </span>
                  </div>

                  <PreparationWorkflow
                    examId={activeExamId}
                    examName={activeExam.name}
                    requirement={requirementsByExam[activeExamId].requirement}
                    started={!!applications[activeExamId]}
                    startedAt={applications[activeExamId]?.startedAt ?? null}
                    status={requirementsByExam[activeExamId].status}
                  />
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <footer className='border-t border-border bg-background py-8'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground'>
          <p>Formlee — your reusable profile and document workspace for entrance-exam applications.</p>
          <p className='mt-1'>
            Formlee never submits or verifies exam applications on official portals, and does not bypass CAPTCHAs,
            OTPs or payment confirmations. Uploaded documents are never officially verified merely by being stored
            here.
          </p>
        </div>
      </footer>
    </div>
  )
}

function SummaryChip({ label, value, progress }: { label: string; value: string; progress?: number }) {
  return (
    <div className='bg-background border border-border rounded-xl p-4'>
      <p className='text-xs text-muted-foreground mb-1'>{label}</p>
      <p className='text-xl font-bold text-foreground'>{value}</p>
      {progress !== undefined && (
        <div className='mt-2 h-1.5 bg-muted rounded-full overflow-hidden'>
          <div className='h-full bg-primary rounded-full' style={{ width: Math.round(Math.min(progress, 100)) + '%' }} />
        </div>
      )}
    </div>
  )
}

function WorkspaceLinkCard({
  href,
  icon,
  title,
  description,
  stat,
  badge,
  statNode,
}: {
  href: string
  icon: string
  title: string
  description: string
  stat: string
  badge?: ReactNode
  statNode?: ReactNode
}) {
  return (
    <Link
      href={href}
      className='group bg-background border border-border rounded-xl p-5 flex items-start gap-4 hover:shadow-md hover:border-primary/40 transition-all'
    >
      <div className='w-11 h-11 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-xl'>
        {icon}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2 mb-1'>
          <h3 className='font-semibold text-foreground'>{title}</h3>
          {badge}
          {statNode}
        </div>
        <p className='text-sm text-muted-foreground'>{description}</p>
        <p className='mt-2 text-xs font-medium text-primary group-hover:underline'>{stat} â†’</p>
      </div>
    </Link>
  )
}
