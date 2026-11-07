import { HUB_STATUS_DEFINITIONS } from '@/lib/apply-ai/application-status'
import { DEADLINE_STATE_LABELS, SUPPORT_STATUS_DEFINITIONS } from '@/lib/apply-ai/exams'
import type {
  ApplicationStatus,
  DeadlineState,
  ExamSupportStatus,
  HubApplicationStatus,
  ProfileStatus,
} from '@/lib/apply-ai/types'

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; className: string }> = {
  NOT_STARTED: {
    label: 'Not started',
    className: 'bg-secondary text-muted-foreground border border-border',
  },
  PREPARING: {
    label: 'Preparing',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  READY_FOR_REVIEW: {
    label: 'Ready for review',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <span className={'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ' + config.className}>
      <span className='w-1.5 h-1.5 rounded-full bg-current opacity-70' />
      {config.label}
    </span>
  )
}

const PROFILE_STATUS_CONFIG: Record<ProfileStatus, { label: string; className: string }> = {
  INCOMPLETE: {
    label: 'Incomplete',
    className: 'bg-secondary text-muted-foreground border border-border',
  },
  IN_PROGRESS: {
    label: 'In progress',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  COMPLETE: {
    label: 'Complete',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
}

export function ProfileStatusBadge({ status }: { status: ProfileStatus }) {
  const config = PROFILE_STATUS_CONFIG[status]
  return (
    <span className={'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ' + config.className}>
      <span className='w-1.5 h-1.5 rounded-full bg-current opacity-70' />
      {config.label}
    </span>
  )
}

export function UnverifiedBadge() {
  return (
    <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground border border-border'>
      Unverified
    </span>
  )
}

const SUPPORT_STATUS_CLASS: Record<ExamSupportStatus, string> = {
  SUPPORTED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BETA: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  DEMO_ONLY: 'bg-slate-100 text-slate-700 border-slate-200',
  COMING_SOON: 'bg-sky-50 text-sky-800 border-sky-200',
  TRACK_ONLY: 'bg-slate-100 text-slate-700 border-slate-200',
  APPLICATION_CLOSED: 'bg-rose-50 text-rose-800 border-rose-200',
  DATES_NOT_ANNOUNCED: 'bg-secondary text-muted-foreground border-border',
}

export function SupportStatusBadge({ status }: { status: ExamSupportStatus }) {
  const definition = SUPPORT_STATUS_DEFINITIONS[status]
  return (
    <span
      title={definition.description}
      className={
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ' +
        SUPPORT_STATUS_CLASS[status]
      }
    >
      {definition.label}
    </span>
  )
}

export function HubStatusBadge({ status }: { status: HubApplicationStatus }) {
  const definition = HUB_STATUS_DEFINITIONS[status]
  return (
    <span
      title={definition.description}
      className={
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ' +
        definition.className
      }
    >
      <span className='w-1.5 h-1.5 rounded-full bg-current opacity-70' />
      {definition.label}
    </span>
  )
}

const DEADLINE_STATE_CLASS: Record<DeadlineState, string> = {
  ANNOUNCED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  TENTATIVE: 'bg-amber-50 text-amber-800 border-amber-200',
  NOT_ANNOUNCED: 'bg-secondary text-muted-foreground border-border',
}

export function DeadlineStateBadge({ state }: { state: DeadlineState }) {
  return (
    <span
      className={
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ' +
        DEADLINE_STATE_CLASS[state]
      }
    >
      {DEADLINE_STATE_LABELS[state]}
    </span>
  )
}

export function NeedsUpdateBadge() {
  return (
    <span
      title='An official date has changed or has not been published. Refresh this application from the catalog and verify on the official portal.'
      className='inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-50 text-amber-800 border border-amber-300'
    >
      Check for updates
    </span>
  )
}

export function DemoDataBadge() {
  return (
    <span
      title='Demonstration data entered by you — Formlee does not verify it and never invents values.'
      className='inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-accent/10 text-accent-foreground border border-accent/30'
    >
      Self-entered
    </span>
  )
}
