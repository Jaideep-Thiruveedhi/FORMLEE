import Link from 'next/link'
import type { ApplicationReminder } from '@/lib/apply-ai/types'

const SEVERITY_STYLES = {
  urgent: {
    container: 'border-rose-200 bg-rose-50',
    dot: 'bg-rose-500',
    label: 'Urgent',
    labelClass: 'text-rose-700',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50',
    dot: 'bg-amber-500',
    label: 'Action needed',
    labelClass: 'text-amber-800',
  },
  info: {
    container: 'border-sky-200 bg-sky-50',
    dot: 'bg-sky-500',
    label: 'For information',
    labelClass: 'text-sky-800',
  },
} as const

/**
 * In-app reminders derived from the current application state and deadlines.
 * There is no email/SMS/push delivery and no external scheduler: these are
 * recomputed every time the hub loads.
 */
export function RemindersPanel({ reminders }: { reminders: ApplicationReminder[] }) {
  if (reminders.length === 0) {
    return (
      <section className='bg-background border border-border rounded-2xl p-5'>
        <div className='flex items-center gap-2'>
          <span aria-hidden>🔔</span>
          <h2 className='font-semibold text-foreground'>Reminders</h2>
        </div>
        <p className='mt-2 text-sm text-muted-foreground'>
          Nothing needs your attention right now. Reminders appear here when a verified deadline is
          approaching, information is missing, or a status needs review.
        </p>
        <p className='mt-2 text-[11px] text-muted-foreground'>
          In-app only. Formlee does not send SMS, email or push notifications.
        </p>
      </section>
    )
  }

  return (
    <section className='bg-background border border-border rounded-2xl p-5'>
      <div className='flex items-center justify-between gap-2 mb-3'>
        <div className='flex items-center gap-2'>
          <span aria-hidden>🔔</span>
          <h2 className='font-semibold text-foreground'>Reminders</h2>
          <span className='text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary'>
            {reminders.length}
          </span>
        </div>
        <span className='text-[10px] text-muted-foreground'>In-app only</span>
      </div>

      <ul className='space-y-2'>
        {reminders.map(reminder => {
          const style = SEVERITY_STYLES[reminder.severity]
          return (
            <li key={reminder.id} className={'rounded-xl border px-3 py-2.5 ' + style.container}>
              <div className='flex items-start gap-2.5'>
                <span className={'mt-1.5 w-2 h-2 shrink-0 rounded-full ' + style.dot} aria-hidden />
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <p className='text-sm font-semibold text-foreground'>{reminder.title}</p>
                    <span className={'text-[10px] font-semibold uppercase tracking-wide ' + style.labelClass}>
                      {style.label}
                    </span>
                  </div>
                  <p className='text-xs text-muted-foreground mt-0.5'>{reminder.detail}</p>
                  <Link
                    href={reminder.href}
                    className='text-[11px] font-semibold text-primary hover:underline mt-1 inline-block'
                  >
                    Open application →
                  </Link>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
