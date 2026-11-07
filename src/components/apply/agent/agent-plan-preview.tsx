'use client'

import type { AgentPlanPreview } from '@/lib/apply-ai/api-client'

const STATUS_STYLES: Record<AgentPlanPreview['items'][number]['status'], { label: string; className: string }> = {
  mapped: { label: 'Will fill', className: 'bg-green-100 text-green-800 border-green-300' },
  ambiguous: { label: 'Needs your choice', className: 'bg-amber-100 text-amber-900 border-amber-300' },
  manual: { label: 'Fill by hand', className: 'bg-muted text-muted-foreground border-border' },
  unsafe: { label: 'Skipped for safety', className: 'bg-red-100 text-red-800 border-red-300' },
  unmapped: { label: 'Not mapped', className: 'bg-muted text-muted-foreground border-border' },
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  dateOfBirthDay: 'Date of birth — day',
  dateOfBirthMonth: 'Date of birth — month',
  dateOfBirthYear: 'Date of birth — year',
  email: 'Email address',
  mobileNumber: 'Mobile number',
  addressLine: 'Address',
  city: 'City',
  state: 'State',
  pinCode: 'PIN code',
  class10Board: 'Class 10 board',
  class10PassingYear: 'Class 10 passing year',
  class10RollNumber: 'Class 10 roll number',
  class10MarksKind: 'Class 10 marks format',
  class10Marks: 'Class 10 marks',
  class12Board: 'Class 12 board',
  class12PassingYear: 'Class 12 passing year',
  class12RollNumber: 'Class 12 roll number',
  class12MarksKind: 'Class 12 marks format',
  class12Marks: 'Class 12 marks',
  category: 'Category',
  pwdStatus: 'PwD status',
  homeState: 'Home state',
  preferredExamCities: 'Preferred exam cities',
}

/**
 * Read-only preview of the plan the extension last detected: which fields it
 * found, what each one would be filled with, and what it deliberately leaves
 * alone. The fill itself always happens only after the student approves the
 * same plan inside the extension popup.
 */
export function AgentPlanPreviewCard({
  plan,
  planAt,
}: {
  plan: AgentPlanPreview | null
  planAt: string | null
}) {
  return (
    <div className='bg-background border border-border rounded-2xl p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-3'>
        <h2 className='text-base font-semibold text-foreground'>Detected fields &amp; proposed mappings</h2>
        {plan ? (
          <span className='text-[11px] text-muted-foreground'>detected {formatWhen(plan.createdAt, planAt)}</span>
        ) : null}
      </div>

      {!plan ? (
        <p className='text-xs text-muted-foreground'>
          Nothing detected yet. Install and connect the extension, open the page with your form, and run
          &ldquo;Inspect this page&rdquo; from the extension popup — the detected fields and proposed mappings appear here
          and in the popup before anything is filled.
        </p>
      ) : (
        <div className='space-y-3'>
          {plan.adapter !== 'generic' && plan.adapterLabel ? (
            <div className='rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900'>
              <p className='font-semibold'>{plan.adapterLabel}{plan.adapterStatus ? ' · ' + plan.adapterStatus : ''}</p>
              <p className='mt-0.5'>
                Documentation-backed mapping of the official Personal Details / Qualification Details labels.
                Live portal structure is not verified. {plan.page?.kind ? 'Page: ' + pageKindLabel(plan.page.kind) + '.' : ''}
              </p>
              {plan.adapterNote ? <p className='mt-1'>{plan.adapterNote}</p> : null}
            </div>
          ) : null}

          <div className='flex flex-wrap gap-2 text-[11px] font-medium'>
            <span className='px-2 py-0.5 rounded-full border border-border bg-muted/50 text-foreground'>
              {plan.counts.detected} fields
            </span>
            <span className='px-2 py-0.5 rounded-full border border-green-300 bg-green-100 text-green-800'>
              {plan.counts.mapped} will fill
            </span>
            {plan.counts.ambiguous > 0 ? (
              <span className='px-2 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-900'>
                {plan.counts.ambiguous} ambiguous
              </span>
            ) : null}
            <span className='px-2 py-0.5 rounded-full border border-border bg-muted/50 text-muted-foreground'>
              {plan.counts.manual} manual
            </span>
            <span className='px-2 py-0.5 rounded-full border border-red-300 bg-red-100 text-red-800'>
              {plan.counts.unsafe} skipped for safety
            </span>
          </div>

          {plan.aiUsed ? null : plan.aiNote ? (
            <p className='text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2'>
              {plan.aiNote}
            </p>
          ) : null}

          <div className='border border-border rounded-xl divide-y divide-border max-h-[480px] overflow-y-auto'>
            {plan.items.map(item => {
              const style = STATUS_STYLES[item.status] ?? STATUS_STYLES.unmapped
              return (
                <div key={item.index} className='flex items-start gap-3 px-3.5 py-2.5'>
                  <span
                    className={'shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ' + style.className}
                  >
                    {style.label}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-xs font-medium text-foreground truncate'>
                      {item.label || '(no label detected)'}
                      <span className='ml-1.5 text-[10px] font-normal text-muted-foreground uppercase'>({item.kind})</span>
                      {item.required ? <span className='ml-1 text-red-500' aria-hidden>*</span> : null}
                    </p>
                    {item.group ? (
                      <p className='text-[10px] text-muted-foreground truncate'>group: {item.group}</p>
                    ) : null}
                    <p className='text-[11px] text-muted-foreground mt-0.5'>
                      {item.status === 'mapped' && item.canonical
                        ? '→ ' + (FIELD_LABELS[item.canonical] ?? item.canonical) + (item.firedByAi ? ' (local model)' : '')
                        : item.status === 'ambiguous'
                          ? '→ choose: ' + item.ambiguous.map(c => FIELD_LABELS[c] ?? c).join(' / ')
                          : item.reason}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {plan.items.some(item => item.status === 'unsafe') ? (
            <p className='text-[11px] text-muted-foreground'>
              Password, OTP, CAPTCHA, payment, identity-number and upload fields are never included in fills.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

function formatWhen(createdAt: string, planAt: string | null): string {
  void planAt
  try {
    return new Date(createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'just now'
  }
}

function pageKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    personal: 'Personal Details',
    qualification: 'Qualification Details',
    exam: 'Examination choices',
    documents: 'Document uploads',
    declaration: 'Declaration',
    login: 'Login / registration',
    unknown: 'unrecognised JEE Main page',
    generic: 'generic page',
  }
  return labels[kind] ?? kind
}
