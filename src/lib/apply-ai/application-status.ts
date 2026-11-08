import type { HubApplicationStatus } from './types'

export interface HubStatusDefinition {
  label: string
  shortLabel: string
  description: string
  /** Tailwind classes for a badge. */
  className: string
  /** Submission states are written only through the explicit submission action. */
  submitted: boolean
}

export const HUB_STATUS_DEFINITIONS: Record<HubApplicationStatus, HubStatusDefinition> = {
  NOT_STARTED: {
    label: 'Not started',
    shortLabel: 'Not started',
    description: 'No preparation work has been recorded for this application yet.',
    className: 'bg-secondary text-muted-foreground border-border',
    submitted: false,
  },
  PREPARING: {
    label: 'Preparing',
    shortLabel: 'Preparing',
    description: 'You are gathering information, documents or preferences for the official form.',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
    submitted: false,
  },
  MISSING_INFORMATION: {
    label: 'Missing information',
    shortLabel: 'Missing info',
    description: 'One or more profile, document or manual checklist items still need your attention.',
    className: 'bg-orange-50 text-orange-800 border-orange-200',
    submitted: false,
  },
  READY_TO_FILL: {
    label: 'Ready to fill',
    shortLabel: 'Ready to fill',
    description: 'Your preparation checklist is complete. You still fill and submit the form on the official portal yourself.',
    className: 'bg-green-50 text-green-800 border-green-200',
    submitted: false,
  },
  FILLING_IN_PROGRESS: {
    label: 'Filling in progress',
    shortLabel: 'Filling',
    description: 'You are entering details on the official portal. Formlee has not submitted anything.',
    className: 'bg-blue-50 text-blue-800 border-blue-200',
    submitted: false,
  },
  FILLED_AWAITING_STUDENT_REVIEW: {
    label: 'Filled — awaiting your review',
    shortLabel: 'Awaiting review',
    description: 'You recorded that the form is filled, but you have not confirmed submission. This is not a submitted status.',
    className: 'bg-violet-50 text-violet-800 border-violet-200',
    submitted: false,
  },
  WAITING_FOR_MANUAL_VERIFICATION: {
    label: 'Waiting for manual verification',
    shortLabel: 'Manual verification',
    description: 'You are waiting for a portal, payment or document step that must be completed manually. This is not a submitted status.',
    className: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    submitted: false,
  },
  SUBMITTED_STUDENT_CONFIRMED: {
    label: 'Submitted — student confirmed',
    shortLabel: 'Student confirmed',
    description: 'You explicitly confirmed that you submitted on the official portal. Formlee has no independent proof of the submission.',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    submitted: true,
  },
  PORTAL_CONFIRMATION_RECORDED: {
    label: 'Portal acknowledgement recorded',
    shortLabel: 'Portal recorded',
    description: 'You recorded a reference from the official portal. This is student-attested, not independently verified by Formlee.',
    className: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    submitted: true,
  },
}

export const PRE_SUBMISSION_STATUSES: HubApplicationStatus[] = [
  'NOT_STARTED',
  'PREPARING',
  'MISSING_INFORMATION',
  'READY_TO_FILL',
  'FILLING_IN_PROGRESS',
  'FILLED_AWAITING_STUDENT_REVIEW',
  'WAITING_FOR_MANUAL_VERIFICATION',
]

export const HUB_APPLICATION_STATUSES = Object.keys(
  HUB_STATUS_DEFINITIONS
) as HubApplicationStatus[]

export function isSubmissionStatus(status: HubApplicationStatus): boolean {
  return HUB_STATUS_DEFINITIONS[status].submitted
}

export function getHubStatusDefinition(status: HubApplicationStatus): HubStatusDefinition {
  return HUB_STATUS_DEFINITIONS[status]
}
