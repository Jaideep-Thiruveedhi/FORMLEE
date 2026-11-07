'use client'

import Link from 'next/link'
import { useApplyStore } from '@/lib/apply-ai/store'
import type { ApplicationStatus, ExamId, ExamRequirement } from '@/lib/apply-ai/types'
import { StatusBadge } from './status-badge'

/**
 * Guided preparation workflow for one exam, driven entirely by configured
 * requirement items (profile sections + applicable documents) resolved from
 * the saved server profile and uploaded documents.
 *
 * Automatic submission to examination portals — including CAPTCHA, OTP or
 * payment steps — is intentionally out of scope; the final step always points
 * the student at the official portal instead.
 */
export function PreparationWorkflow({
  examId,
  examName,
  requirement,
  started,
  startedAt,
  status,
}: {
  examId: ExamId
  examName: string
  requirement: ExamRequirement
  started: boolean
  startedAt: string | null
  status: ApplicationStatus
}) {
  const beginApplication = useApplyStore(state => state.beginApplication)

  const unmet = requirement.items.filter(item => !item.met)
  const firstUnmetProfile = unmet.find(item => item.kind === 'profile-section')
  const firstUnmetDocument = unmet.find(item => item.kind === 'document')
  const profileItems = requirement.items.filter(item => item.kind === 'profile-section')
  const documentItems = requirement.items.filter(item => item.kind === 'document')
  const profileMetCount = profileItems.filter(item => item.met).length
  const docsMetCount = documentItems.filter(item => item.met).length
  const profileDone = profileItems.length > 0 && profileItems.every(item => item.met)
  const documentsDone = documentItems.length > 0 && documentItems.every(item => item.met)

  const steps: WorkflowStep[] = [
    {
      id: 'start',
      label: 'Start this application tracker',
      desc: 'Adds the examination to your local tracker. No data is sent anywhere.',
      done: started,
      action: started ? undefined : ('begin' as const),
    },
    {
      id: 'profile',
      label: 'Complete your reusable profile sections',
      desc: profileMetCount + ' of ' + profileItems.length + ' configured profile sections ready — fill each requirement once and every exam reuses it.',
      done: profileDone,
      action: profileDone ? undefined : ('profile' as const),
    },
    {
      id: 'documents',
      label: 'Upload required documents',
      desc: docsMetCount + ' of ' + documentItems.length + ' applicable checklist rows uploaded.',
      done: documentsDone,
      action: documentsDone ? undefined : ('documents' as const),
    },
    {
      id: 'review',
      label: 'Review & submit on the official portal',
      desc: requirement.ready
        ? 'Every readiness requirement is met. Review your details, then submit on the exam portal yourself.'
        : 'Unlocks when all requirements above are met; submission itself stays on the official portal.',
      done: requirement.ready,
    },
  ]

  const currentStepIndex = steps.findIndex(step => !step.done)

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-lg font-semibold text-foreground'>Preparation workflow</h3>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {started
              ? 'Application started ' + formatDate(startedAt) + ' — complete each step below.'
              : 'Create your preparation tracker to unlock guidance for this exam.'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <ol className='bg-background border border-border rounded-xl divide-y divide-border overflow-hidden'>
        {steps.map((step, i) => (
          <li
            key={step.id}
            className='flex items-start gap-3 p-4 sm:p-5'
            aria-current={i === currentStepIndex ? 'step' : undefined}
          >
            <span
              className={'w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ' +
                (step.done
                  ? 'bg-green-500 text-white'
                  : i === currentStepIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground')}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <div className='min-w-0 flex-1'>
              <p
                className={'text-sm font-semibold ' +
                  (step.done ? 'text-muted-foreground line-through decoration-border' : 'text-foreground')}
              >
                {step.label}
              </p>
              <p className='text-xs text-muted-foreground mt-0.5'>{step.desc}</p>
              {!step.done && step.action === 'begin' && (
                <button
                  type='button'
                  onClick={() => beginApplication(examId)}
                  className='mt-2 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
                >
                  Start application
                </button>
              )}
              {!step.done && step.action === 'profile' && (
                <Link
                  href={unmet.length > 0 && firstUnmetProfile !== undefined ? firstUnmetProfile.href : '/apply/profile'}
                  className='mt-2 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors inline-block'
                >
                  Open profile
                </Link>
              )}
              {!step.done && step.action === 'documents' && (
                <Link
                  href={unmet.length > 0 && firstUnmetDocument !== undefined ? firstUnmetDocument.href : '/apply/documents'}
                  className='mt-2 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors inline-block'
                >
                  Open documents
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>

      {unmet.length > 0 ? (
        <div className='bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5'>
          <p className='text-sm font-semibold text-amber-800 mb-3'>
            {unmet.length} requirement{unmet.length > 1 ? 's' : ''} remaining for {examName} — complete these to
            become &ldquo;Ready for review&rdquo;
          </p>
          <ul className='space-y-2'>
            {unmet.map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className='w-full flex items-start gap-2.5 p-2.5 rounded-lg bg-white/60 hover:bg-white transition-colors group'
                >
                  <span aria-hidden className='text-sm mr-1'>{item.kind === 'profile-section' ? '🧍' : '📎'}</span>
                  <span className='min-w-0 flex-1'>
                    <span className='block text-xs font-semibold text-amber-900 group-hover:underline'>{item.label}</span>
                    <span className='block text-[11px] text-amber-700'>{item.detail}</span>
                  </span>
                  <span className='text-[11px] font-medium text-amber-700 ml-2 mt-0.5'>Fix →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className='bg-green-50 border border-green-200 rounded-xl p-4 sm:p-5'>
          <p className='text-sm font-semibold text-green-800'>All set for review</p>
          <p className='text-xs text-green-700 mt-1'>
            Every configured requirement is met based on your saved profile and uploaded documents. Review your
            details, then submit on the official portal yourself — Formlee does not submit applications.
          </p>
        </div>
      )}

      <div className='bg-secondary border border-border rounded-xl p-4 text-xs text-secondary-foreground leading-relaxed'>
        <strong className='font-semibold'>About submission:</strong> Formlee does not submit applications to
        examination portals, handle CAPTCHAs, OTPs or payments. When this tracker says you are ready, you complete
        the official submission yourself on the examination body&apos;s portal.
      </div>
    </div>
  )
}

interface WorkflowStep {
  id: 'start' | 'profile' | 'documents' | 'review'
  label: string
  desc: string
  done: boolean
  action?: 'begin' | 'profile' | 'documents'
}

function formatDate(iso: string | null): string {
  if (!iso) return 'in a previous session'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return 'in a previous session'
  }
}
