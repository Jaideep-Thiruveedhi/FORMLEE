'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PROFILE_SECTIONS } from '@/lib/apply-ai/profile'
import { evaluateProfile, type ProfileLike } from '@/lib/apply-ai/requirements'
import {
  useDocuments,
  useProfile,
  useSaveProfile,
  useUpdateClass12Results,
} from '@/lib/apply-ai/api-client'
import { useApplyStore } from '@/lib/apply-ai/store'
import { splitCityInput, type InvalidField } from '@/lib/apply-ai/validation'
import type {
  ProfileSectionDef,
  ProfileSectionState,
  StudentProfileData,
  SubjectEntry,
  UploadedDocumentDTO,
} from '@/lib/apply-ai/types'
import { DemoDataBadge, ProfileStatusBadge } from './status-badge'

const inputClassName =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none disabled:opacity-60'

const EMPTY_FORM: Record<string, unknown> = {
  currentSameAsPermanent: false,
  categoryConfirmed: false,
  pwdStatus: false,
  pwdStatusConfirmed: false,
}

const SECTION_STATE_STYLES: Record<
  ProfileSectionState,
  { label: string; className: string }
> = {
  COMPLETE: {
    label: 'Complete',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  AWAITING_RESULTS: {
    label: 'Awaiting results',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  NEEDS_CONFIRMATION: {
    label: 'Needs confirmation',
    className: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  PARTIAL: {
    label: 'Needs attention',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    className: 'bg-muted text-muted-foreground border-border',
  },
}

const VERSION_REASON_LABELS: Record<string, string> = {
  PROFILE_UPDATE: 'Profile updated',
  CLASS12_RESULT_UPDATE: 'Class 12 result recorded',
  CLASS12_RESULT_CORRECTION: 'Class 12 result corrected',
}

/**
 * Full Student Information Vault editor, backed by the server. Every supported
 * examination reuses this one record. Drafts save at any time: the server
 * validates each field independently and reports invalid values; nothing is
 * auto-filled or invented, and "saved" never means "verified".
 */
export function ProfileEditor({ profileReady }: { profileReady: boolean }) {
  const query = useProfile(profileReady)
  const documentsQuery = useDocuments(profileReady)
  const saveProfile = useSaveProfile()
  const legacyProfileDraft = useApplyStore(state => state.legacyProfileDraft)
  const consumeLegacyDraft = useApplyStore(state => state.consumeLegacyDraft)
  const importMutation = useSaveProfile()

  const [form, setForm] = useState<Record<string, unknown>>({ ...EMPTY_FORM })
  const [invalidFields, setInvalidFields] = useState<InvalidField[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const hydratedIdRef = useRef<string | null>(null)

  // Seed the editor once per loaded server draft (not on every keystroke).
  useEffect(() => {
    const profile = query.data?.profile
    if (!profile || hydratedIdRef.current === profile.id) return
    hydratedIdRef.current = profile.id
    setForm(draftToForm(profile))
    setInvalidFields([])
    setIsDirty(false)
  }, [query.data])

  const evaluation = useMemo(() => evaluateProfile(form as ProfileLike), [form])
  const documents = documentsQuery.data?.documents ?? []
  const showLegacyBanner = profileReady && !!legacyProfileDraft && !query.data?.profile

  const setField = (fieldId: string, value: unknown) => {
    setForm(prev => ({ ...prev, [fieldId]: value }))
    setIsDirty(true)
    setInvalidFields(prev => prev.filter(issue => issue.field !== fieldId))
  }

  const handleSave = () => {
    setInvalidFields([])
    saveProfile.mutate(formToPayload(form), {
      onSuccess: data => {
        setInvalidFields(data.invalidFields ?? [])
        setSavedAt(data.savedAt)
        setIsDirty(false)
        if (data.profile) setForm(draftToForm(data.profile))
      },
    })
  }

  if (!profileReady || query.isLoading) {
    return (
      <div className='grid md:grid-cols-2 gap-4 sm:gap-5'>
        {PROFILE_SECTIONS.map(section => (
          <div key={section.id} className='h-64 rounded-xl bg-muted/40 animate-pulse' />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className='bg-red-50 border border-red-200 rounded-xl p-6 text-center'>
        <p className='text-sm font-semibold text-red-700 mb-1'>Could not load your vault</p>
        <p className='text-xs text-red-600 mb-4'>{(query.error as Error).message}</p>
        <button
          type='button'
          onClick={() => void query.refetch()}
          className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
        >
          Try again
        </button>
      </div>
    )
  }

  const profile = query.data?.profile ?? null
  const history = query.data?.history ?? []

  return (
    <div>
      {/* Status + save bar */}
      <div className='bg-background border border-border rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3'>
        <div className='flex flex-wrap items-center gap-3 flex-1'>
          <ProfileStatusBadge status={evaluation.status} />
          <span className='text-xs text-muted-foreground'>
            {evaluation.completedSections} of {evaluation.totalSections} sections ready
          </span>
          {evaluation.hasAwaitingResults && (
            <span className='text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5'>
              Class 12 results awaited
            </span>
          )}
          {evaluation.hasNeedsConfirmation && (
            <span className='text-[11px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-full px-2.5 py-0.5'>
              Confirmation needed
            </span>
          )}
          <DemoDataBadge />
          {savedAt && (
            <span className='text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5'>
              Draft saved {formatSavedAt(savedAt)}
            </span>
          )}
          {isDirty && (
            <span className='text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5'>
              Unsaved changes
            </span>
          )}
        </div>
        <button
          type='button'
          onClick={handleSave}
          disabled={saveProfile.isPending}
          className='self-start sm:self-auto px-5 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
        >
          {saveProfile.isPending ? 'Saving…' : 'Save vault'}
        </button>
      </div>

      {saveProfile.isError && (
        <div className='bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-xs text-red-700'>
          {saveProfile.error instanceof Error ? saveProfile.error.message : 'Could not save your vault'}
        </div>
      )}

      {importMutation.isError && (
        <div className='bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-xs text-red-700'>
          Import failed: {importMutation.error instanceof Error ? importMutation.error.message : 'error'}
        </div>
      )}

      {invalidFields.length > 0 && (
        <div className='bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-xs text-amber-800'>
          <strong className='font-semibold'>
            Valid fields were saved, but {invalidFields.length} field{invalidFields.length === 1 ? '' : 's'} need
            attention:
          </strong>{' '}
          {invalidFields.map(issue => issue.message).join(' · ')}
        </div>
      )}

      {showLegacyBanner && (
        <div className='bg-primary/5 border border-primary/20 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3'>
          <p className='text-xs text-foreground flex-1'>
            <strong className='font-semibold'>Local draft found.</strong> A profile draft from the earlier
            (browser-only) version of this dashboard exists on this device. Import it into your vault? It is
            self-entered and unverified, like everything else here.
          </p>
          <div className='flex gap-2'>
            <button
              type='button'
              onClick={() => importMutation.mutate(legacyProfileDraft as Record<string, unknown>, {
                onSuccess: () => {
                  consumeLegacyDraft()
                  setSavedAt(new Date().toISOString())
                  void query.refetch()
                },
              })}
              disabled={importMutation.isPending}
              className='px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
            >
              {importMutation.isPending ? 'Importing…' : 'Import draft'}
            </button>
            <button
              type='button'
              onClick={() => consumeLegacyDraft()}
              className='px-3 py-2 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted'
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {profile && (
        <p className='text-[11px] text-muted-foreground mb-4'>
          Vault version {profile.profileVersion}. Last server save:{' '}
          {new Date(profile.updatedAt).toLocaleString('en-IN')}. All entries are <strong>unverified</strong> —
          only examination bodies verify anything, on their own portals.
        </p>
      )}

      <div className='grid md:grid-cols-2 gap-4 sm:gap-5 items-start'>
        {PROFILE_SECTIONS.map(section => (
          <ProfileSectionEditor
            key={section.id}
            section={section}
            form={form}
            evaluation={evaluation}
            invalidFields={invalidFields}
            documents={documents}
            onSetField={setField}
            onClass12Updated={profileData => {
              setForm(prev => ({
                ...prev,
                class12Status: profileData.class12Status,
                class12PassingYear:
                  profileData.class12PassingYear === null ? '' : String(profileData.class12PassingYear),
                class12MarksKind: profileData.class12MarksKind ?? '',
                class12Marks: profileData.class12Marks ?? '',
                class12Percentage: profileData.class12Percentage ?? '',
                class12RollNumber: profileData.class12RollNumber ?? '',
                class12ResultDeclaredAt: profileData.class12ResultDeclaredAt ?? '',
                class12ResultUpdatedAt: profileData.class12ResultUpdatedAt ?? '',
              }))
              setSavedAt(new Date().toISOString())
              setIsDirty(false)
            }}
          />
        ))}
      </div>

      {history.length > 0 && (
        <details className='mt-5 bg-background border border-border rounded-xl p-4'>
          <summary className='text-sm font-semibold text-foreground cursor-pointer'>
            Vault history ({history.length} recent change{history.length === 1 ? '' : 's'})
          </summary>
          <p className='text-[11px] text-muted-foreground mt-2'>
            Earlier values are retained as append-only history. A Class 12 result update changes the same vault
            record — it never creates a second education profile.
          </p>
          <ul className='mt-3 space-y-2'>
            {history.map(version => (
              <li key={version.id} className='rounded-lg border border-border px-3 py-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-xs font-semibold text-foreground'>
                    v{version.version} · {VERSION_REASON_LABELS[version.reason] ?? version.reason}
                  </span>
                  <span className='text-[11px] text-muted-foreground'>
                    {new Date(version.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>
                {version.changedFields.length > 0 && (
                  <p className='text-[11px] text-muted-foreground mt-1'>
                    Changed: {version.changedFields.slice(0, 8).map(labelForField).join(', ')}
                    {version.changedFields.length > 8 ? ` +${version.changedFields.length - 8} more` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function formatSavedAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isFieldVisible(
  field: ProfileSectionDef['fields'][number],
  form: Record<string, unknown>
): boolean {
  if (!field.visibleWhen) return true
  const current = form[field.visibleWhen.field]
  return field.visibleWhen.equals.includes(String(current))
}

function documentOptions(
  fieldId: string,
  documents: UploadedDocumentDTO[]
): { value: string; label: string }[] | null {
  if (fieldId !== 'categoryCertificateDocumentId' && fieldId !== 'pwdCertificateDocumentId') return null
  const wanted = fieldId === 'pwdCertificateDocumentId' ? 'PWD_CERTIFICATE' : 'CATEGORY_CERTIFICATE'
  return documents
    .filter(doc => doc.documentType === wanted && doc.isCurrent !== false)
    .map(doc => ({
      value: doc.id,
      label: `${doc.originalName}${doc.versions > 1 ? ` (v${doc.versions})` : ''}`,
    }))
}

function ProfileSectionEditor({
  section,
  form,
  evaluation,
  invalidFields,
  documents,
  onSetField,
  onClass12Updated,
}: {
  section: ProfileSectionDef
  form: Record<string, unknown>
  evaluation: ReturnType<typeof evaluateProfile>
  invalidFields: InvalidField[]
  documents: UploadedDocumentDTO[]
  onSetField: (fieldId: string, value: unknown) => void
  onClass12Updated: (profile: StudentProfileData) => void
}) {
  const sectionStatus = evaluation.sections.find(s => s.sectionId === section.id)
  const style = sectionStatus ? SECTION_STATE_STYLES[sectionStatus.state] : SECTION_STATE_STYLES.PARTIAL
  const errorFor = (fieldId: string): string | null =>
    invalidFields.find(issue => issue.field === fieldId)?.message ?? null

  return (
    <section
      id={'profile-section-' + section.id}
      className={
        'bg-background border rounded-xl p-5 scroll-mt-24 ' +
        (sectionStatus?.done ? 'border-green-200' : 'border-border')
      }
    >
      <div className='flex items-center justify-between gap-3 mb-4'>
        <div className='flex items-center gap-2.5'>
          <span aria-hidden className='text-lg'>{section.icon}</span>
          <div>
            <h3 className='font-semibold text-foreground text-sm'>{section.title}</h3>
            <p className='text-[11px] text-muted-foreground mt-0.5 max-w-[40ch]'>{section.description}</p>
          </div>
        </div>
        <span className={'shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border ' + style.className}>
          {style.label}
        </span>
      </div>

      <div className='grid sm:grid-cols-2 gap-3'>
        {section.fields.map(field => {
          if (!isFieldVisible(field, form)) return null

          if (field.type === 'boolean') {
            return <BooleanField key={field.id} field={field} form={form} onSetField={onSetField} />
          }
          const extraOptions = documentOptions(field.id, documents)
          return (
            <div
              key={field.id}
              className={
                field.type === 'subjects' || field.type === 'address' || field.type === 'cities' || field.wide
                  ? 'sm:col-span-2'
                  : ''
              }
            >
              {field.type === 'subjects' && field.subjectListKey ? (
                <>
                  <SubjectListEditor
                    field={field}
                    rows={(form[field.subjectListKey] as SubjectEntry[] | undefined) ?? []}
                    onChange={rows => onSetField(field.subjectListKey!, rows)}
                    error={errorFor(field.id)}
                  />
                  {field.help && <p className='mt-2 text-[11px] text-muted-foreground'>{field.help}</p>}
                </>
              ) : (
                <FieldInput
                  field={field}
                  value={form[field.id]}
                  onChange={value => onSetField(field.id, value)}
                  error={errorFor(field.id)}
                  extraOptions={extraOptions}
                />
              )}
            </div>
          )
        })}
      </div>

      {section.id === 'class12' && (
        <Class12ResultUpdater
          status={typeof form.class12Status === 'string' ? form.class12Status : null}
          form={form}
          onUpdated={onClass12Updated}
        />
      )}

      {sectionStatus?.note && (
        <p
          className={
            'mt-3 text-[11px] rounded-lg px-3 py-2 border ' +
            (sectionStatus.state === 'AWAITING_RESULTS'
              ? 'text-indigo-800 bg-indigo-50 border-indigo-200'
              : sectionStatus.state === 'NEEDS_CONFIRMATION'
                ? 'text-sky-900 bg-sky-50 border-sky-200'
                : 'text-muted-foreground bg-muted/30 border-border')
          }
        >
          {sectionStatus.note}
        </p>
      )}

      {sectionStatus && sectionStatus.state === 'PARTIAL' && sectionStatus.missingLabels.length > 0 && (
        <p className='mt-3 text-[11px] text-amber-700'>
          Missing: {sectionStatus.missingLabels.join(', ')}
        </p>
      )}
    </section>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  extraOptions,
}: {
  field: ProfileSectionDef['fields'][number]
  value: unknown
  onChange: (value: unknown) => void
  error: string | null
  extraOptions?: { value: string; label: string }[] | null
}) {
  const displayName = field.label
  const options = extraOptions ?? field.options
  const isDocumentPicker = extraOptions !== undefined && extraOptions !== null

  return (
    <div>
      <label htmlFor={'profile-field-' + field.id} className='block text-xs font-medium text-foreground mb-1'>
        {displayName}
        {field.required && <span className='text-destructive'> *</span>}
      </label>

      {field.type === 'select' && (
        <select
          id={'profile-field-' + field.id}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          className={inputClassName}
        >
          <option value=''>{isDocumentPicker ? 'No document linked' : 'Not entered yet'}</option>
          {options?.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}

      {(field.type === 'text' || field.type === 'email' || field.type === 'tel' || field.type === 'date' || field.type === 'number' || field.type === 'address' || field.type === 'cities') && (
        <input
          id={'profile-field-' + field.id}
          // 'address' and 'cities' are our semantic types; they render as plain text inputs.
          type={field.type === 'address' || field.type === 'cities' ? 'text' : field.type}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputClassName}
        />
      )}

      {isDocumentPicker && (options?.length ?? 0) === 0 && (
        <p className='mt-1 text-[11px] text-amber-700'>
          No matching certificate is uploaded yet. Upload it on the Documents page, then link it here.
        </p>
      )}

      {field.help && <p className='mt-1 text-[11px] text-muted-foreground'>{field.help}</p>}

      {error && <p className='mt-1 text-[11px] text-destructive'>{error}</p>}
    </div>
  )
}

function BooleanField({
  field,
  form,
  onSetField,
}: {
  field: ProfileSectionDef['fields'][number]
  form: Record<string, unknown>
  onSetField: (fieldId: string, value: unknown) => void
}) {
  const checked = form[field.id] === true
  return (
    <div className={field.wide ? 'sm:col-span-2' : 'sm:col-span-2'}>
      <label
        htmlFor={'profile-field-' + field.id}
        className='flex items-start gap-2.5 px-3 py-2.5 border border-border rounded-lg bg-background cursor-pointer hover:bg-muted/40 transition-colors'
      >
        <input
          id={'profile-field-' + field.id}
          type='checkbox'
          checked={checked}
          onChange={e => onSetField(field.id, e.target.checked)}
          className='mt-0.5 h-4 w-4 accent-[#2563eb]'
        />
        <span className='text-sm text-foreground'>{field.label}</span>
      </label>
      {field.help && <p className='mt-1 text-[11px] text-muted-foreground'>{field.help}</p>}
    </div>
  )
}

/**
 * Explicit "Update Class 12 Results" action. It updates the SAME vault record
 * and records a version. Marks and percentage are optional and are never
 * computed: the student enters only what the official result states.
 */
function Class12ResultUpdater({
  status,
  form,
  onUpdated,
}: {
  status: string | null
  form: Record<string, unknown>
  onUpdated: (profile: StudentProfileData) => void
}) {
  const mutation = useUpdateClass12Results()
  const [open, setOpen] = useState(false)
  const [passingYear, setPassingYear] = useState('')
  const [resultDeclaredOn, setResultDeclaredOn] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [marksKind, setMarksKind] = useState('')
  const [marks, setMarks] = useState('')
  const [percentage, setPercentage] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!status) {
    return (
      <p className='mt-4 text-[11px] text-muted-foreground border-t border-border pt-3'>
        Select your Class 12 status and save the section before recording a declared result.
      </p>
    )
  }

  const alreadyPassed = status === 'PASSED'

  return (
    <div className='mt-4 border-t border-border pt-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <p className='text-xs font-semibold text-foreground'>
            {alreadyPassed ? 'Correct a recorded Class 12 result' : 'Update Class 12 Results'}
          </p>
          <p className='text-[11px] text-muted-foreground mt-0.5'>
            Updates this same vault record. The previous state is kept in vault history — no duplicate education
            profile is created.
          </p>
        </div>
        <button
          type='button'
          onClick={() => setOpen(value => !value)}
          className='px-3 py-1.5 text-[11px] font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/10'
        >
          {open ? 'Close' : alreadyPassed ? 'Correct result' : 'Update Class 12 Results'}
        </button>
      </div>

      {open && (
        <div className='mt-3 rounded-xl border border-border bg-muted/20 p-3'>
          <div className='grid sm:grid-cols-2 gap-3'>
            <label className='text-xs text-foreground'>
              Passing year <span className='text-destructive'>*</span>
              <input
                type='number'
                value={passingYear}
                onChange={event => setPassingYear(event.target.value)}
                placeholder='e.g., 2026'
                className={inputClassName + ' mt-1'}
              />
            </label>
            <label className='text-xs text-foreground'>
              Result declared on (optional)
              <input
                type='date'
                value={resultDeclaredOn}
                onChange={event => setResultDeclaredOn(event.target.value)}
                className={inputClassName + ' mt-1'}
              />
            </label>
            <label className='text-xs text-foreground'>
              Roll number (optional)
              <input
                value={rollNumber}
                onChange={event => setRollNumber(event.target.value)}
                placeholder={typeof form.class12RollNumber === 'string' ? form.class12RollNumber : 'As printed'}
                className={inputClassName + ' mt-1'}
              />
            </label>
            <label className='text-xs text-foreground'>
              Marks format (optional)
              <select
                value={marksKind}
                onChange={event => setMarksKind(event.target.value)}
                className={inputClassName + ' mt-1'}
              >
                <option value=''>Not specified</option>
                <option value='PERCENTAGE'>Percentage</option>
                <option value='GRADE'>Grade</option>
                <option value='CGPA'>CGPA</option>
              </select>
            </label>
            <label className='text-xs text-foreground'>
              Marks / grade (optional)
              <input
                value={marks}
                onChange={event => setMarks(event.target.value)}
                placeholder='Exactly as printed'
                className={inputClassName + ' mt-1'}
              />
            </label>
            <label className='text-xs text-foreground'>
              Percentage (optional)
              <input
                value={percentage}
                onChange={event => setPercentage(event.target.value)}
                placeholder='e.g., 91.8'
                className={inputClassName + ' mt-1'}
              />
            </label>
          </div>

          <p className='mt-2 text-[11px] text-muted-foreground'>
            Leave marks or percentage blank if you do not have them. Formlee never calculates or fills a missing
            result.
          </p>

          {error && <p className='mt-2 text-[11px] text-destructive'>{error}</p>}
          {mutation.isError && (
            <p className='mt-2 text-[11px] text-destructive'>
              {mutation.error instanceof Error ? mutation.error.message : 'Could not update the result'}
            </p>
          )}

          <button
            type='button'
            disabled={mutation.isPending}
            onClick={() => {
              setError(null)
              if (!/^\d{4}$/.test(passingYear)) {
                setError('Enter the 4-digit passing year declared on your result.')
                return
              }
              mutation.mutate(
                {
                  class12PassingYear: passingYear,
                  resultDeclaredOn: resultDeclaredOn || null,
                  class12RollNumber: rollNumber || null,
                  class12MarksKind: marksKind || null,
                  class12Marks: marks || null,
                  class12Percentage: percentage || null,
                },
                {
                  onSuccess: data => {
                    if (data.profile) onUpdated(data.profile)
                    setOpen(false)
                  },
                }
              )
            }}
            className='mt-3 px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
          >
            {mutation.isPending ? 'Updating…' : alreadyPassed ? 'Save corrected result' : 'Save declared result'}
          </button>
        </div>
      )}
    </div>
  )
}

function SubjectListEditor({
  field,
  rows,
  onChange,
  error,
}: {
  field: ProfileSectionDef['fields'][number]
  rows: SubjectEntry[]
  onChange: (rows: SubjectEntry[]) => void
  error: string | null
}) {
  return (
    <div>
      <div className='flex items-center justify-between mb-1'>
        <label className='text-xs font-medium text-foreground'>
          {field.label}
          {field.subjectRequired && <span className='text-destructive'> *</span>}
        </label>
        <button
          type='button'
          onClick={() => onChange([...rows, { name: '', kind: 'PERCENTAGE', value: '' }])}
          className='text-[11px] font-semibold text-primary hover:underline'
        >
          + Add subject
        </button>
      </div>

      {rows.length === 0 ? (
        <p className='px-3 py-2.5 border border-dashed border-border rounded-lg text-xs text-muted-foreground'>
          {field.subjectRequired
            ? 'Add at least one subject — enter names and marks exactly as printed on your marksheet.'
            : 'No subjects added yet — add the ones you studied, with marks/grades as printed if you need them.'}
        </p>
      ) : (
        <ul className='space-y-2'>
          {rows.map((row, index) => (
            <li key={index} className='grid grid-cols-12 gap-2 items-center'>
              <input
                aria-label={'Subject ' + (index + 1) + ' name'}
                value={row.name}
                onChange={e => updateRow(rows, index, onChange, { name: e.target.value })}
                placeholder={'Subject ' + (index + 1) + ' name'}
                className={inputClassName + ' col-span-6 sm:col-span-5'}
              />
              <select
                aria-label={'Subject ' + (index + 1) + ' marks format'}
                value={row.kind}
                onChange={e => updateRow(rows, index, onChange, { kind: e.target.value as SubjectEntry['kind'] })}
                className={inputClassName + ' col-span-3'}
              >
                <option value='PERCENTAGE'>%</option>
                <option value='GRADE'>Grade</option>
                <option value='CGPA'>CGPA</option>
              </select>
              <input
                aria-label={'Subject ' + (index + 1) + ' marks or grade'}
                value={row.value}
                onChange={e => updateRow(rows, index, onChange, { value: e.target.value })}
                placeholder='Marks/grade (optional)'
                className={inputClassName + ' col-span-2 sm:col-span-3'}
              />
              <button
                type='button'
                aria-label={'Remove subject ' + (index + 1)}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className='col-span-1 text-muted-foreground hover:text-destructive justify-self-center px-1'
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className='mt-1 text-[11px] text-destructive'>{error}</p>}
    </div>
  )
}

function updateRow(
  rows: SubjectEntry[],
  index: number,
  onChange: (rows: SubjectEntry[]) => void,
  patch: Partial<SubjectEntry>
) {
  onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
}

/* ---------------- form (de)serialization helpers ---------------- */

const METADATA_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'profileVersion',
  'lastMajorUpdateAt',
  'categoryConfirmedAt',
  'categoryCertificateLastConfirmedAt',
  'class12ResultDeclaredAt',
  'class12ResultUpdatedAt',
])

export function draftToForm(profile: StudentProfileData): Record<string, unknown> {
  const form: Record<string, unknown> = { ...EMPTY_FORM }
  for (const [key, value] of Object.entries(profile)) {
    if (METADATA_KEYS.has(key)) continue
    if (key === 'pwdStatus') form[key] = value === true
    else if (value === null) form[key] = ''
    else if (key === 'class10Subjects' || key === 'class12Subjects') form[key] = value as SubjectEntry[]
    // Passing/exam years are stored as numbers but edited as plain text inputs.
    else if (key === 'class10PassingYear' || key === 'class12PassingYear' || key === 'class12ExamYear') {
      form[key] = String(value)
    }
    // Preferred cities are edited as a single comma-separated line.
    else if (key === 'preferredExamCities') form[key] = (value as string[]).join(', ')
    else form[key] = value
  }
  return form
}

export function formToPayload(form: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(form)) {
    if (METADATA_KEYS.has(key)) continue
    if (key === 'class10Subjects' || key === 'class12Subjects') {
      const rows = (value as SubjectEntry[] | undefined) ?? []
      // Drop fully blank rows so an untouched template row never blocks saving.
      const meaningful = rows.filter(row => row.name.trim().length > 0 || row.value.trim().length > 0)
      payload[key] = meaningful
      continue
    }

    if (typeof value === 'string' && value.trim() === '') {
      payload[key] = ''
      continue
    }

    if (typeof value === 'string') {
      payload[key] = value.trim()
      continue
    }

    payload[key] = value
  }

  if (typeof payload.preferredExamCities === 'string') {
    payload.preferredExamCities = splitCityInput(payload.preferredExamCities)
  }

  return payload
}

export function labelForField(fieldId: string): string {
  for (const section of PROFILE_SECTIONS) {
    for (const field of section.fields) {
      if (field.id === fieldId) return field.label
    }
  }
  if (fieldId === 'documents') return 'Document references'
  return fieldId.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}
