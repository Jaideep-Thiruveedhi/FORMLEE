import Link from 'next/link'
import type { ApplicationWithEvaluation } from '@/lib/apply-ai/types'
import { formatDateOnly } from '@/lib/apply-ai/applications'
import {
  DeadlineStateBadge,
  HubStatusBadge,
  NeedsUpdateBadge,
  SupportStatusBadge,
} from './status-badge'

import type { ApplicationEvaluation } from '@/lib/apply-ai/types'

function ReadinessStateBadge({ state }: { state: ApplicationEvaluation['readinessState'] }) {
  const styles: Record<ApplicationEvaluation['readinessState'], { label: string; className: string }> = {
    READY: { label: 'Ready', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    PARTIALLY_READY: { label: 'Partially ready', className: 'bg-amber-50 text-amber-800 border-amber-200' },
    MISSING_INFORMATION: { label: 'Missing information', className: 'bg-orange-50 text-orange-800 border-orange-200' },
    NEEDS_CONFIRMATION: { label: 'Needs confirmation', className: 'bg-sky-50 text-sky-800 border-sky-200' },
    DOCUMENT_ATTENTION_REQUIRED: { label: 'Document attention', className: 'bg-rose-50 text-rose-800 border-rose-200' },
    NOT_APPLICABLE: { label: 'Not applicable', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  }
  const style = styles[state]
  return (
    <span className={'px-2 py-0.5 rounded-full text-[10px] font-semibold border ' + style.className}>
      {style.label}
    </span>
  )
}

function relativeUpdated(value: string): string {
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return 'Unknown'
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDateOnly(value.slice(0, 10))
}

/**
 * One tracked application. Every number shown is derived from the evaluation:
 * there is no stored or invented percentage. A missing official checklist is
 * shown as such rather than as "0% complete".
 */
export function ApplicationCard({ application }: { application: ApplicationWithEvaluation }) {
  const { evaluation, deadline } = application
  const submitted =
    application.status === 'SUBMITTED_STUDENT_CONFIRMED' ||
    application.status === 'PORTAL_CONFIRMATION_RECORDED'
  const missingLabels = [
    ...evaluation.missingProfileLabels,
    ...evaluation.missingDocumentLabels,
  ].slice(0, 3)
  const extraMissing =
    evaluation.missingProfileLabels.length + evaluation.missingDocumentLabels.length - missingLabels.length

  return (
    <article className='bg-background border border-border rounded-2xl p-5 flex flex-col hover:shadow-lg transition-shadow'>
      <div className='flex items-start gap-3'>
        <div className='w-11 h-11 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-xl' aria-hidden>
          {application.examIcon}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-bold text-foreground leading-tight'>{application.examName}</h3>
            <SupportStatusBadge status={application.supportStatus} />
          </div>
          <p className='text-xs text-muted-foreground mt-0.5 truncate'>
            {application.sessionLabel} · {application.applicationYear}
          </p>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2 mt-4'>
        <HubStatusBadge status={application.status} />
        <ReadinessStateBadge state={application.evaluation.readinessState} />
        {application.mappingReviewRequired && (
          <span className='px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-300'>
            Profile changed — review mapping
          </span>
        )}
        {application.submission.portalReferenceRecordedAt && (
          <span className='text-[10px] font-semibold uppercase tracking-wide text-emerald-700'>
            Student-recorded reference
          </span>
        )}
      </div>

      <div className='mt-4'>
        {evaluation.progressPercent === null ? (
          <div className='rounded-lg bg-muted/50 border border-border px-3 py-2'>
            <p className='text-xs font-medium text-foreground'>Official 2027 checklist not published</p>
            <p className='text-[11px] text-muted-foreground mt-0.5'>
              Reusable workspace: {evaluation.reusableWorkspace.sectionsComplete}/
              {evaluation.reusableWorkspace.sectionsTotal} profile sections ·{' '}
              {evaluation.reusableWorkspace.documentsUploaded}/{evaluation.reusableWorkspace.documentsTotal}{' '}
              documents
            </p>
          </div>
        ) : (
          <>
            <div className='flex items-center justify-between text-xs mb-1.5'>
              <span className='text-muted-foreground'>Official checklist</span>
              <span className='font-semibold text-foreground'>
                {evaluation.completeCount} of {evaluation.applicableCount} complete
              </span>
            </div>
            <div
              className='h-2 bg-muted rounded-full overflow-hidden'
              role='progressbar'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={evaluation.progressPercent}
              aria-label={`${application.examName} requirement progress`}
            >
              <div
                className={
                  'h-full rounded-full ' +
                  (evaluation.allRequirementsMet ? 'bg-emerald-500' : 'bg-primary')
                }
                style={{ width: `${evaluation.progressPercent}%` }}
              />
            </div>
            <p className='mt-1 text-[11px] text-muted-foreground'>
              {evaluation.progressPercent}% of published requirement items
            </p>
          </>
        )}
      </div>

      {missingLabels.length > 0 && (
        <div className='mt-3 text-[11px] text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Still needed:</span>{' '}
          {missingLabels.join(', ')}
          {extraMissing > 0 ? ` +${extraMissing} more` : ''}
        </div>
      )}

      {evaluation.needsConfirmationCount > 0 && (
        <div className='mt-2 text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Confirm in your vault:</span>{' '}
          {evaluation.needsConfirmationLabels.slice(0, 3).join(', ')}
          {evaluation.needsConfirmationLabels.length > 3
            ? ` +${evaluation.needsConfirmationLabels.length - 3} more`
            : ''}
        </div>
      )}

      {evaluation.awaitingResultsCount > 0 && (
        <div className='mt-2 text-[11px] text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Class 12 result awaited:</span> no marks or final certificate are
          required yet.
        </div>
      )}

      {evaluation.documentIssues.length > 0 && (
        <div className='mt-2 text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Document issue{evaluation.documentIssues.length === 1 ? '' : 's'}:</span>{' '}
          {evaluation.documentIssues.slice(0, 2).map(issue => issue.message).join(' · ')}
          {evaluation.documentIssues.length > 2 ? ` +${evaluation.documentIssues.length - 2} more` : ''}
        </div>
      )}

      {evaluation.certificateIssues.length > 0 && (
        <div className='mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Certificate issue{evaluation.certificateIssues.length === 1 ? '' : 's'}:</span>{' '}
          {evaluation.certificateIssues.slice(0, 2).map(issue => issue.message).join(' · ')}
          {evaluation.certificateIssues.length > 2 ? ` +${evaluation.certificateIssues.length - 2} more` : ''}
        </div>
      )}

      {evaluation.consistencyIssues.length > 0 && (
        <div className='mt-2 text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Differs from vault:</span>{' '}
          {evaluation.consistencyIssues.slice(0, 3).map(issue => issue.field).join(' · ')}
          {evaluation.consistencyIssues.length > 3 ? ` +${evaluation.consistencyIssues.length - 3} more` : ''}
        </div>
      )}

      {evaluation.snapshotStale && (
        <div className='mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2'>
          <span className='font-semibold'>Vault snapshot is newer.</span> Review the refreshed mapping before filling.
        </div>
      )}

      <div className='mt-4 pt-4 border-t border-border text-xs'>
        <div className='flex items-center gap-1.5 flex-wrap'>
          <span className='text-muted-foreground'>{deadline.label}:</span>
          <span className='font-medium text-foreground'>
            {deadline.date ? formatDateOnly(deadline.date) : 'Not announced'}
          </span>
          <DeadlineStateBadge state={deadline.state} />
          {deadline.needsUpdate && <NeedsUpdateBadge />}
        </div>
        {deadline.source ? (
          <a
            href={deadline.source.url}
            target='_blank'
            rel='noreferrer'
            className='mt-1 inline-block text-[11px] text-primary hover:underline'
          >
            Source: {deadline.source.label}
            {deadline.verifiedAt ? ` (checked ${formatDateOnly(deadline.verifiedAt)})` : ''}
          </a>
        ) : (
          <p className='mt-1 text-[11px] text-muted-foreground'>No official source recorded.</p>
        )}
        {deadline.catalogUpdated && (
          <p className='mt-1 text-[11px] text-amber-800'>
            The catalog has newer date information. Open the application to refresh it.
          </p>
        )}
      </div>

      <div className='mt-auto pt-4 flex items-end justify-between gap-3'>
        <p className='text-[11px] text-muted-foreground' suppressHydrationWarning>
          Updated {relativeUpdated(application.updatedAt)}
        </p>
        <div className='flex items-center gap-2'>
          <Link
            href={`/apply/applications/${application.id}`}
            className='px-3 py-1.5 text-xs font-semibold text-foreground border border-border rounded-lg hover:bg-muted transition-colors'
          >
            Details
          </Link>
          {!submitted && evaluation.nextAction && (
            evaluation.nextAction.kind === 'portal' ? (
              <a
                href={evaluation.nextAction.href}
                target='_blank'
                rel='noreferrer'
                className='px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
              >
                {evaluation.nextAction.label}
              </a>
            ) : (
              <Link
                href={evaluation.nextAction.href}
                className='px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
              >
                {evaluation.nextAction.label}
              </Link>
            )
          )}
        </div>
      </div>
    </article>
  )
}
