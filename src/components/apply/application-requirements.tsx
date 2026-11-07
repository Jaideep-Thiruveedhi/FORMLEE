'use client'

import Link from 'next/link'
import type {
  ApplicationRequirementItem,
  ApplicationWithEvaluation,
  RequirementCategoryProgress,
} from '@/lib/apply-ai/types'
import { formatDateOnly } from '@/lib/apply-ai/applications'

const STATE_STYLES: Record<ApplicationRequirementItem['state'], { icon: string; className: string; label: string }> = {
  COMPLETE: { icon: '✓', className: 'bg-emerald-100 text-emerald-700 border-emerald-300', label: 'Complete' },
  MISSING: { icon: '!', className: 'bg-orange-100 text-orange-700 border-orange-300', label: 'Missing' },
  AWAITING_STUDENT: { icon: '?', className: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Your confirmation needed' },
  NEEDS_CONFIRMATION: { icon: '!', className: 'bg-sky-100 text-sky-800 border-sky-300', label: 'Needs your explicit confirmation' },
  AWAITING_RESULTS: { icon: '…', className: 'bg-indigo-100 text-indigo-800 border-indigo-300', label: 'Awaiting Class 12 results' },
  NOT_APPLICABLE: { icon: '—', className: 'bg-muted text-muted-foreground border-border', label: 'Not applicable' },
  ATTENTION_REQUIRED: { icon: '⚠', className: 'bg-rose-100 text-rose-700 border-rose-300', label: 'Needs attention' },
}

/**
 * Official requirement checklist. Each row is tied to a catalog definition and
 * its official source. Manual rows are student confirmations, never automatic
 * verification of an examination rule.
 */
export function ApplicationRequirements({
  application,
  onToggleManual,
  togglingId,
}: {
  application: ApplicationWithEvaluation
  onToggleManual: (requirementId: string, done: boolean) => void
  togglingId: string | null
}) {
  const { evaluation } = application

  if (!evaluation.officialChecklistAvailable) {
    return (
      <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
        <h2 className='text-lg font-bold text-foreground'>Requirements</h2>
        <div className='mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3'>
          <p className='text-sm font-semibold text-amber-900'>
            Official requirement list not published
          </p>
          <p className='text-xs text-amber-800 mt-1'>{evaluation.requirementsNote}</p>
        </div>

        <div className='mt-4 grid sm:grid-cols-2 gap-3'>
          <div className='rounded-xl border border-border p-4'>
            <p className='text-xs text-muted-foreground'>Profile sections complete</p>
            <p className='text-xl font-bold text-foreground mt-1'>
              {evaluation.reusableWorkspace.sectionsComplete} /{' '}
              {evaluation.reusableWorkspace.sectionsTotal}
            </p>
            <Link href='/apply/profile' className='text-xs font-semibold text-primary hover:underline mt-2 inline-block'>
              Open profile →
            </Link>
          </div>
          <div className='rounded-xl border border-border p-4'>
            <p className='text-xs text-muted-foreground'>Applicable documents uploaded</p>
            <p className='text-xl font-bold text-foreground mt-1'>
              {evaluation.reusableWorkspace.documentsUploaded} /{' '}
              {evaluation.reusableWorkspace.documentsTotal}
            </p>
            <Link href='/apply/documents' className='text-xs font-semibold text-primary hover:underline mt-2 inline-block'>
              Open documents →
            </Link>
          </div>
        </div>

        <p className='mt-4 text-[11px] text-muted-foreground'>
          Your reusable workspace is not an exam-specific checklist, and completing it never proves
          eligibility. Verify the official instructions when they are published.
        </p>
      </section>
    )
  }

  const grouped = evaluation.items.reduce<Record<string, ApplicationRequirementItem[]>>(
    (accumulator, item) => {
      const existing = accumulator[item.category] ?? []
      existing.push(item)
      accumulator[item.category] = existing
      return accumulator
    },
    {}
  )

  const categoryLabels = new Map(
    evaluation.categoryBreakdown.map((progress: RequirementCategoryProgress) => [
      progress.category,
      progress.label,
    ])
  )

  return (
    <section className='bg-background border border-border rounded-2xl p-5 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-foreground'>Requirements</h2>
          <p className='text-xs text-muted-foreground mt-0.5'>{evaluation.requirementsNote}</p>
        </div>
        <span className='text-xs font-semibold text-foreground bg-muted border border-border rounded-full px-3 py-1'>
          {evaluation.completeCount} / {evaluation.applicableCount} complete
        </span>
      </div>

      {(evaluation.needsConfirmationCount > 0 || evaluation.awaitingResultsCount > 0 || evaluation.attentionRequiredCount > 0) && (
        <div className='mt-3 grid sm:grid-cols-2 gap-2'>
          {evaluation.needsConfirmationCount > 0 && (
            <div className='rounded-xl border border-sky-200 bg-sky-50 px-3 py-2'>
              <p className='text-[11px] font-semibold text-sky-900'>
                {evaluation.needsConfirmationCount} item{evaluation.needsConfirmationCount === 1 ? '' : 's'} need your explicit confirmation
              </p>
              <p className='text-[11px] text-sky-800 mt-0.5'>
                {evaluation.needsConfirmationLabels.join(' · ')}
              </p>
            </div>
          )}
          {evaluation.awaitingResultsCount > 0 && (
            <div className='rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2'>
              <p className='text-[11px] font-semibold text-indigo-900'>
                {evaluation.awaitingResultsCount} item{evaluation.awaitingResultsCount === 1 ? '' : 's'} awaiting Class 12 results
              </p>
              <p className='text-[11px] text-indigo-800 mt-0.5'>
                No marks or final certificate are required until the result is declared.
              </p>
            </div>
          )}
          {evaluation.attentionRequiredCount > 0 && (
            <div className='rounded-xl border border-rose-200 bg-rose-50 px-3 py-2'>
              <p className='text-[11px] font-semibold text-rose-900'>
                {evaluation.attentionRequiredCount} document/certification issue{evaluation.attentionRequiredCount === 1 ? '' : 's'} need attention
              </p>
              <p className='text-[11px] text-rose-800 mt-0.5'>
                Check file size, type, dimensions or certificate dates below.
              </p>
            </div>
          )}
        </div>
      )}

      <div className='mt-4 space-y-5'>
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2'>
              {categoryLabels.get(category as ApplicationRequirementItem['category']) ?? category}
            </h3>
            <ul className='space-y-2'>
              {items.map(item => {
                const style = STATE_STYLES[item.state]
                return (
                  <li
                    key={item.id}
                    id={`requirement-${item.id}`}
                    className={
                      'rounded-xl border px-3 py-3 scroll-mt-24 ' +
                      (item.state === 'NOT_APPLICABLE'
                        ? 'border-border bg-muted/30'
                        : 'border-border')
                    }
                  >
                    <div className='flex items-start gap-3'>
                      <span
                        className={
                          'mt-0.5 w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-xs font-bold ' +
                          style.className
                        }
                        aria-label={style.label}
                      >
                        {style.icon}
                      </span>
                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <p className={'text-sm font-semibold ' + (item.state === 'NOT_APPLICABLE' ? 'text-muted-foreground' : 'text-foreground')}>
                            {item.label}
                          </p>
                          {item.kind === 'manual' && item.state !== 'NOT_APPLICABLE' && (
                            <label className='inline-flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                              <input
                                type='checkbox'
                                checked={item.met}
                                disabled={togglingId === item.id}
                                onChange={event => onToggleManual(item.id, event.target.checked)}
                              />
                              {togglingId === item.id ? 'Saving…' : 'I confirm this'}
                            </label>
                          )}
                        </div>
                        <p className='text-xs text-muted-foreground mt-1'>{item.detail}</p>
                        {item.manualInstruction && !item.met && (
                          <p className='text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2'>
                            {item.manualInstruction}
                          </p>
                        )}
                        {item.issues.length > 0 && (
                          <ul className='mt-2 space-y-1.5'>
                            {item.issues.map((issue, index) => (
                              <li
                                key={`${issue.code}-${index}`}
                                className={
                                  'text-[11px] rounded-lg px-2.5 py-1.5 border ' +
                                  (issue.severity === 'urgent'
                                    ? 'bg-red-50 text-red-800 border-red-200'
                                    : issue.severity === 'warning'
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-sky-50 text-sky-800 border-sky-200')
                                }
                              >
                                <span className='font-semibold'>{issue.code}:</span> {issue.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5'>
                          {item.kind !== 'manual' && item.state !== 'NOT_APPLICABLE' && (
                            <Link href={item.href} className='text-[11px] font-semibold text-primary hover:underline'>
                              {item.kind === 'profile-section' ? 'Open profile section' : 'Open documents'}
                            </Link>
                          )}
                          <a
                            href={item.source.url}
                            target='_blank'
                            rel='noreferrer'
                            className='text-[11px] text-muted-foreground hover:text-primary hover:underline'
                          >
                            Official source: {item.source.label} · checked{' '}
                            {formatDateOnly(item.source.verifiedOn)}
                          </a>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className='mt-5 text-[11px] text-muted-foreground'>
        Checklist completion is not an eligibility decision. The examination body alone decides
        eligibility, document acceptance and admission.
      </p>
    </section>
  )
}
