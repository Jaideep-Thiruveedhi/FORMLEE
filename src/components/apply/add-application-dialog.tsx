'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EXAMS } from '@/lib/apply-ai/exams'
import { formatDateOnly } from '@/lib/apply-ai/applications'
import {
  useCreateApplication,
  type ApplicationMutationError,
} from '@/lib/apply-ai/api-client'
import type { ApplicationWithEvaluation, ExamId } from '@/lib/apply-ai/types'
import { DeadlineStateBadge, SupportStatusBadge } from './status-badge'

/**
 * Add-examination flow. Sessions come from the verified catalog; a session that
 * is already tracked is shown as such instead of allowing a duplicate attempt.
 * Exams with no published dates can still be added to the workspace — tracking
 * never depends on a deadline existing.
 */
export function AddApplicationDialog({
  open,
  onClose,
  applications,
}: {
  open: boolean
  onClose: () => void
  applications: ApplicationWithEvaluation[]
}) {
  const router = useRouter()
  const createMutation = useCreateApplication()
  const [selectedExamId, setSelectedExamId] = useState<ExamId | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; existingId?: string | null } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const selectedExam = EXAMS.find(exam => exam.id === selectedExamId) ?? null
  const trackedKeys = new Set(
    applications.map(
      application =>
        `${application.examId}:${application.sessionId}:${application.applicationYear}`
    )
  )

  const close = () => {
    setSelectedExamId(null)
    setSelectedSessionId(null)
    setError(null)
    createMutation.reset()
    onClose()
  }

  const submit = async () => {
    if (!selectedExam || !selectedSessionId) return
    setError(null)
    try {
      const result = await createMutation.mutateAsync({
        examId: selectedExam.id,
        sessionId: selectedSessionId,
      })
      close()
      router.push(`/apply/applications/${result.application.id}`)
    } catch (cause) {
      const mutationError = cause as ApplicationMutationError
      setError({ message: mutationError.message, existingId: mutationError.existingId })
    }
  }

  return (
    <div
      className='fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4'
      role='presentation'
      onMouseDown={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='add-application-title'
        className='bg-background w-full sm:max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl flex flex-col'
      >
        <div className='flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-border'>
          <div>
            <h2 id='add-application-title' className='text-lg font-bold text-foreground'>
              {selectedExam ? `Add ${selectedExam.name}` : 'Add an examination'}
            </h2>
            <p className='text-xs text-muted-foreground mt-0.5'>
              {selectedExam
                ? 'Choose the application session you are tracking.'
                : 'Workspace tracking is available for every listed exam — no rank or result is required.'}
            </p>
          </div>
          <button
            type='button'
            onClick={close}
            className='shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors'
            aria-label='Close add-examination dialog'
          >
            ✕
          </button>
        </div>

        <div className='overflow-y-auto px-5 sm:px-6 py-4'>
          {!selectedExam ? (
            <div className='grid sm:grid-cols-2 gap-3'>
              {EXAMS.map(exam => (
                <button
                  key={exam.id}
                  type='button'
                  onClick={() => {
                    setSelectedExamId(exam.id)
                    setSelectedSessionId(null)
                    setError(null)
                  }}
                  className='text-left border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors'
                >
                  <div className='flex items-start gap-3'>
                    <span className='w-9 h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-lg' aria-hidden>
                      {exam.icon}
                    </span>
                    <span className='min-w-0'>
                      <span className='flex flex-wrap items-center gap-1.5'>
                        <span className='font-semibold text-foreground text-sm'>{exam.name}</span>
                        <SupportStatusBadge status={exam.supportStatus} />
                      </span>
                      <span className='block text-[11px] text-muted-foreground mt-0.5'>
                        {exam.organizer}
                      </span>
                      <span className='block text-xs text-muted-foreground mt-2 line-clamp-2'>
                        {exam.description}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <button
                type='button'
                onClick={() => {
                  setSelectedExamId(null)
                  setSelectedSessionId(null)
                  setError(null)
                }}
                className='text-xs font-medium text-primary hover:underline mb-4'
              >
                ← Choose a different examination
              </button>

              <div className='rounded-xl border border-border p-4'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-semibold text-foreground'>{selectedExam.fullName}</span>
                  <SupportStatusBadge status={selectedExam.supportStatus} />
                </div>
                <p className='text-xs text-muted-foreground mt-1'>{selectedExam.supportNote}</p>
                {selectedExam.officialWebsite && (
                  <a
                    href={selectedExam.officialWebsite}
                    target='_blank'
                    rel='noreferrer'
                    className='text-[11px] text-primary hover:underline mt-1 inline-block'
                  >
                    Official website ↗
                  </a>
                )}
              </div>

              <fieldset className='mt-4'>
                <legend className='text-sm font-semibold text-foreground mb-2'>
                  Application session
                </legend>
                <div className='space-y-2'>
                  {selectedExam.applicationSessions.map(session => {
                    const tracked = trackedKeys.has(
                      `${selectedExam.id}:${session.id}:${session.applicationYear}`
                    )
                    const deadline = session.deadline
                    return (
                      <label
                        key={session.id}
                        className={
                          'flex items-start gap-3 rounded-xl border p-3 transition-colors ' +
                          (tracked
                            ? 'border-border bg-muted/40 cursor-not-allowed'
                            : selectedSessionId === session.id
                              ? 'border-primary bg-primary/5 cursor-pointer'
                              : 'border-border hover:border-primary/40 cursor-pointer')
                        }
                      >
                        <input
                          type='radio'
                          name='application-session'
                          value={session.id}
                          checked={selectedSessionId === session.id}
                          disabled={tracked}
                          onChange={() => {
                            setSelectedSessionId(session.id)
                            setError(null)
                          }}
                          className='mt-1'
                        />
                        <span className='min-w-0 flex-1'>
                          <span className='flex flex-wrap items-center gap-2'>
                            <span className='text-sm font-medium text-foreground'>
                              {session.label}
                            </span>
                            <span className='text-[11px] text-muted-foreground'>
                              {session.applicationYear}
                            </span>
                            {tracked && (
                              <span className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
                                Already tracked
                              </span>
                            )}
                          </span>
                          <span className='mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground'>
                            <span>{deadline.label}:</span>
                            <span className='font-medium text-foreground'>
                              {deadline.date ? formatDateOnly(deadline.date) : 'Not announced'}
                            </span>
                            <DeadlineStateBadge state={deadline.state} />
                          </span>
                          {deadline.source && (
                            <span className='block text-[10px] text-muted-foreground mt-0.5'>
                              {deadline.source.label} · checked {formatDateOnly(deadline.source.verifiedOn)}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {selectedExam.requirementsPublished ? (
                <p className='mt-4 text-[11px] text-muted-foreground'>
                  {selectedExam.requirements.length} official requirement item
                  {selectedExam.requirements.length === 1 ? '' : 's'} will be tracked for this
                  application. Checklist completion never proves eligibility.
                </p>
              ) : (
                <p className='mt-4 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2'>
                  {selectedExam.requirementsNote}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className='mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
              <p>{error.message}</p>
              {error.existingId && (
                <Link
                  href={`/apply/applications/${error.existingId}`}
                  onClick={close}
                  className='font-semibold underline mt-1 inline-block'
                >
                  Open the existing application
                </Link>
              )}
            </div>
          )}
        </div>

        <div className='flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-border'>
          <button
            type='button'
            onClick={close}
            className='px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors'
          >
            Cancel
          </button>
          <button
            type='button'
            disabled={!selectedExam || !selectedSessionId || createMutation.isPending}
            onClick={() => void submit()}
            className='px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            {createMutation.isPending ? 'Adding…' : 'Add application'}
          </button>
        </div>
      </div>
    </div>
  )
}
