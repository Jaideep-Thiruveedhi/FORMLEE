'use client'

import { useState } from 'react'
import { useApplicationSubmission } from '@/lib/apply-ai/api-client'
import type { ApplicationWithEvaluation } from '@/lib/apply-ai/types'

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * Submission recording. This panel is deliberately separate from the status
 * selector: Formlee never infers submission from fields filled, a completed
 * checklist, or agent activity. Only an explicit confirmation records it, and a
 * portal reference remains student-attested.
 */
export function ApplicationSubmission({ application }: { application: ApplicationWithEvaluation }) {
  const mutation = useApplicationSubmission(application.id)
  const [studentConfirmed, setStudentConfirmed] = useState(false)
  const [referenceConfirmed, setReferenceConfirmed] = useState(false)
  const [reference, setReference] = useState(application.submission.portalReference ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const submitted = application.status === 'SUBMITTED_STUDENT_CONFIRMED'
  const portalRecorded = application.status === 'PORTAL_CONFIRMATION_RECORDED'
  const hasSubmission = submitted || portalRecorded

  const run = async (
    input: Parameters<typeof mutation.mutateAsync>[0],
    successMessage: string
  ) => {
    setError(null)
    setSuccess(null)
    try {
      await mutation.mutateAsync(input)
      setStudentConfirmed(false)
      setReferenceConfirmed(false)
      setSuccess(successMessage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record this action')
    }
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-foreground'>Submission record</h2>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Separate from your preparation status. Only you can record a submission.
          </p>
        </div>
        <span
          className={
            'text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 border ' +
            (hasSubmission
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-muted text-muted-foreground border-border')
          }
        >
          {hasSubmission ? 'Submission recorded by student' : 'Not submitted'}
        </span>
      </div>

      <div className='mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5'>
        <p className='text-xs text-sky-900'>
          <strong className='font-semibold'>Formlee has no connection to the official portal.</strong>{' '}
          It cannot see whether your form was submitted, paid for or accepted. Everything recorded
          here is your own statement, not an official verification.
        </p>
      </div>

      {hasSubmission ? (
        <div className='mt-4 space-y-3'>
          <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-3'>
            <p className='text-xs font-semibold text-emerald-900'>
              {portalRecorded ? 'Portal acknowledgement recorded' : 'Student-confirmed submission'}
            </p>
            <dl className='mt-2 grid sm:grid-cols-2 gap-2 text-xs'>
              <div>
                <dt className='text-emerald-800/80'>Student confirmed on</dt>
                <dd className='font-medium text-emerald-950'>
                  {formatTimestamp(application.submission.studentConfirmedAt)}
                </dd>
              </div>
              <div>
                <dt className='text-emerald-800/80'>Portal reference recorded on</dt>
                <dd className='font-medium text-emerald-950'>
                  {formatTimestamp(application.submission.portalReferenceRecordedAt)}
                </dd>
              </div>
              <div className='sm:col-span-2'>
                <dt className='text-emerald-800/80'>Portal application / acknowledgement reference</dt>
                <dd className='font-mono font-medium text-emerald-950 break-all'>
                  {application.submission.portalReference ?? 'Not recorded'}
                </dd>
              </div>
            </dl>
            <p className='mt-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-800'>
              Student-attested · not verified by Formlee
            </p>
          </div>

          <div className='rounded-xl border border-border p-3'>
            <label htmlFor='portal-reference' className='text-xs font-semibold text-foreground'>
              {portalRecorded ? 'Update portal reference' : 'Add a portal acknowledgement reference'}
            </label>
            <p className='text-[11px] text-muted-foreground mt-0.5'>
              Use only a reference actually shown by the official portal. Formlee stores it as
              self-reported text.
            </p>
            <input
              id='portal-reference'
              type='text'
              value={reference}
              maxLength={120}
              onChange={event => setReference(event.target.value)}
              placeholder='e.g. application number from the portal'
              className='mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
            />
            <label className='mt-2 flex items-start gap-2 text-[11px] text-muted-foreground'>
              <input
                type='checkbox'
                checked={referenceConfirmed}
                onChange={event => setReferenceConfirmed(event.target.checked)}
                className='mt-0.5'
              />
              I confirm this reference was issued by the official portal for this application.
            </label>
            <button
              type='button'
              disabled={!referenceConfirmed || mutation.isPending || reference.trim().length < 2}
              onClick={() =>
                void run(
                  {
                    action: 'RECORD_PORTAL_CONFIRMATION',
                    confirmed: true,
                    portalReference: reference.trim(),
                  },
                  'Portal acknowledgement recorded as student-attested.'
                )
              }
              className='mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {mutation.isPending ? 'Saving…' : 'Save portal reference'}
            </button>
          </div>

          <button
            type='button'
            disabled={mutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Clear the submission record and return this application to "Filled — awaiting your review"? This does not change anything on the official portal.'
                )
              ) {
                void run(
                  { action: 'CLEAR', confirmed: true },
                  'Submission record cleared. The application is back in review.'
                )
              }
            }}
            className='text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50'
          >
            Clear submission record
          </button>
        </div>
      ) : (
        <div className='mt-4 space-y-4'>
          <div className='rounded-xl border border-border p-3'>
            <p className='text-sm font-semibold text-foreground'>I submitted on the official portal</p>
            <p className='text-[11px] text-muted-foreground mt-0.5'>
              Use this only after the official portal has accepted your final submission. Filling
              fields — here or with the agent — is not submission.
            </p>
            <label className='mt-2 flex items-start gap-2 text-xs text-foreground'>
              <input
                type='checkbox'
                checked={studentConfirmed}
                onChange={event => setStudentConfirmed(event.target.checked)}
                className='mt-0.5'
              />
              I confirm that I completed and submitted this application myself on the official
              portal.
            </label>
            <button
              type='button'
              disabled={!studentConfirmed || mutation.isPending}
              onClick={() =>
                void run(
                  { action: 'CONFIRM_STUDENT_SUBMITTED', confirmed: true },
                  'Submission recorded as student-confirmed. This is not an official verification.'
                )
              }
              className='mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {mutation.isPending ? 'Saving…' : 'Record student-confirmed submission'}
            </button>
          </div>

          <div className='rounded-xl border border-border p-3'>
            <p className='text-sm font-semibold text-foreground'>Portal acknowledgement reference</p>
            <p className='text-[11px] text-muted-foreground mt-0.5'>
              Optional. Recording a reference also marks the submission as student-confirmed.
            </p>
            <input
              type='text'
              value={reference}
              maxLength={120}
              onChange={event => setReference(event.target.value)}
              placeholder='e.g. application number from the portal'
              className='mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
            />
            <label className='mt-2 flex items-start gap-2 text-[11px] text-muted-foreground'>
              <input
                type='checkbox'
                checked={referenceConfirmed}
                onChange={event => setReferenceConfirmed(event.target.checked)}
                className='mt-0.5'
              />
              I confirm I submitted on the official portal and this reference was issued there.
            </label>
            <button
              type='button'
              disabled={!referenceConfirmed || mutation.isPending || reference.trim().length < 2}
              onClick={() =>
                void run(
                  {
                    action: 'RECORD_PORTAL_CONFIRMATION',
                    confirmed: true,
                    portalReference: reference.trim(),
                  },
                  'Portal acknowledgement recorded as student-attested.'
                )
              }
              className='mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {mutation.isPending ? 'Saving…' : 'Record portal reference'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className='mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'>
          {error}
        </p>
      )}
      {success && (
        <p className='mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2'>
          {success}
        </p>
      )}
    </section>
  )
}
