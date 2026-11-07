'use client'

import { useRef, useState } from 'react'
import {
  DOCUMENT_TYPES,
  DOCUMENT_CHECKLIST_NOTE,
  DOCUMENT_VERIFICATION_NOTE,
} from '@/lib/apply-ai/documents'
import { isDocumentApplicable, isDocumentUploaded } from '@/lib/apply-ai/requirements'
import {
  useDeleteDocument,
  useDocumentVersions,
  useDocuments,
  useRenameDocument,
  useUpdateDocumentMetadata,
  useUploadDocument,
} from '@/lib/apply-ai/api-client'
import { CERTIFICATE_DOCUMENT_TYPES } from '@/lib/apply-ai/documents'
import type { DocumentId, DocumentTypeDef, UploadedDocumentDTO } from '@/lib/apply-ai/types'
import type { ProfileLike } from '@/lib/apply-ai/requirements'
import { UnverifiedBadge } from './status-badge'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function mimeShort(mimeType: string): string {
  return mimeType.replace('image/', '').replace('application/', '')
}

/**
 * Server-backed document manager: upload, replace, rename and remove the
 * documents each application preparation requires. Uploaded files are private
 * (served only to the workspace owner through an authorized API route) and are
 * never treated as verified.
 */
export function DocumentManager({ documentsReady, profileLike }: { documentsReady: boolean; profileLike: ProfileLike }) {
  const documentsQuery = useDocuments(documentsReady)
  const documents = documentsQuery.data?.documents ?? []

  if (!documentsReady || documentsQuery.isLoading) {
    return <DocumentSkeleton />
  }

  if (documentsQuery.isError) {
    return (
      <div className='bg-red-50 border border-red-200 rounded-xl p-6 text-center'>
        <p className='text-sm font-semibold text-red-700 mb-1'>Could not load your documents</p>
        <p className='text-xs text-red-600 mb-4'>{(documentsQuery.error as Error).message}</p>
        <button
          type='button'
          onClick={() => void documentsQuery.refetch()}
          className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
        >
          Try again
        </button>
      </div>
    )
  }

  const coreTypes = DOCUMENT_TYPES.filter(doc => doc.id !== 'OTHER')
  const otherDocs = documents.filter(doc => doc.documentType === 'OTHER')

  return (
    <div>
      <ul className='border border-border rounded-xl overflow-hidden divide-y divide-border bg-background'>
        {coreTypes.map(docDef => {
          const activeDocs = documents.filter(doc => doc.documentType === docDef.id)
          const applicable = isDocumentApplicable(docDef.id, profileLike)
          return (
            <DocumentTypeRow
              key={docDef.id}
              docDef={docDef}
              documents={activeDocs}
              applicable={applicable}
            />
          )
        })}
      </ul>

      <div className='mt-8' id='document-type-OTHER'>
        <h3 className='text-sm font-semibold text-foreground'>Other examination-specific documents</h3>
        <p className='text-[11px] text-muted-foreground mt-0.5 mb-3 max-w-2xl'>
          For anything an official notification asks for beyond the list above. You name them — Formlee never
          invents or assumes additional requirements.
        </p>

        {otherDocs.length > 0 && (
          <ul className='border border-border rounded-xl divide-y divide-border bg-background mb-3'>
            {otherDocs.map(doc => (
              <UploadedOtherRow key={doc.id} doc={doc} />
            ))}
          </ul>
        )}

        <OtherUploadRow />
      </div>

      <p className='mt-5 text-[11px] leading-relaxed text-muted-foreground'>{DOCUMENT_CHECKLIST_NOTE}</p>
      <p className='mt-2 text-[11px] leading-relaxed text-muted-foreground'>{DOCUMENT_VERIFICATION_NOTE}</p>

      <div className='mt-4 bg-secondary border border-border rounded-xl p-4 text-[11px] text-secondary-foreground leading-relaxed'>
        <strong className='font-semibold'>Privacy:</strong> files are stored outside the website&apos;s public folder
        and are sent to nobody — including any AI — except you, through an authorized, no-cache download link.
        Accountless workspaces are a current limitation: whoever holds your browser cookie can download your documents.
      </div>
    </div>
  )
}

function DocumentSkeleton() {
  return (
    <div className='space-y-3'>
      {[0, 1, 2, 3, 4, 5].map(n => (
        <div key={n} className='h-20 rounded-xl bg-muted/40 animate-pulse' />
      ))}
    </div>
  )
}

function DocumentTypeRow({
  docDef,
  documents,
  applicable,
}: {
  docDef: DocumentTypeDef
  documents: UploadedDocumentDTO[]
  applicable: boolean
}) {
  const uploaded = isDocumentUploaded(docDef.id, documents)
  const activeDoc = documents[0]

  return (
    <li
      id={'document-type-' + docDef.id}
      className='p-4 scroll-mt-24'
      data-applicable={applicable}
      data-uploaded={uploaded}
    >
      <div className='flex flex-col gap-3'>
        <div className='flex items-start gap-3 min-w-0'>
          <div className={'w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-base ' + (uploaded ? 'bg-green-50' : 'bg-muted')}>
            {docDef.icon}
          </div>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-sm font-medium text-foreground'>{docDef.label}</p>
              {docDef.conditional && (
                <span className='px-2 py-0.5 text-[10px] font-semibold bg-accent/10 text-accent-foreground border border-accent/30 rounded'>
                  Only if it applies to you
                </span>
              )}
              {uploaded && <UnverifiedBadge />}
            </div>
            <p className='text-xs text-muted-foreground mt-0.5'>{docDef.description}</p>
            <p className='text-[11px] text-muted-foreground mt-1'>{docDef.guidance}</p>
          </div>
        </div>

        {uploaded && activeDoc && (
          <>
            <ActiveDocRow doc={activeDoc} />
            {CERTIFICATE_DOCUMENT_TYPES.includes(docDef.id) && (
              <CertificateMetadataEditor doc={activeDoc} />
            )}
            <VersionHistory doc={activeDoc} />
          </>
        )}
        <UploadControls documentType={docDef.id} replaceMode={uploaded} />
      </div>
    </li>
  )
}

function ActiveDocRow({ doc }: { doc: UploadedDocumentDTO }) {
  const deleteMutation = useDeleteDocument()

  return (
    <div className='pl-12'>
      <div className='flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3'>
        <span className='text-xs text-foreground truncate flex-1 min-w-0'>
          <span className='font-medium'>{doc.originalName}</span> · {mimeShort(doc.mimeType)} ·{' '}
          {formatBytes(doc.sizeBytes)} · uploaded {formatDate(doc.createdAt)}
          {doc.versions > 1 && ` · version ${doc.versions} (older versions kept)`}
        </span>
        <div className='flex items-center gap-2 shrink-0'>
          <a
            href={`/api/apply/documents/${encodeURIComponent(doc.id)}/file`}
            target='_blank'
            rel='noreferrer'
            className='px-2.5 py-1 text-[11px] font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors'
          >
            View
          </a>
          {doc.documentType === 'OTHER' && (
            <>
              <RenameButton doc={doc} />
              <button
                type='button'
                onClick={() => deleteMutation.mutate(doc.id)}
                disabled={deleteMutation.isPending}
                className='px-2.5 py-1 text-[11px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50'
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {deleteMutation.isError && (
        <p className='mt-2 text-[11px] text-destructive'>{(deleteMutation.error as Error).message}</p>
      )}
    </div>
  )
}

const CERTIFICATE_INPUT =
  'w-full px-2.5 py-1.5 border border-border rounded-lg bg-background text-xs focus:ring-2 focus:ring-primary focus:border-transparent outline-none'

/**
 * Editable certificate metadata. Values are student-entered and self-reported;
 * saving them never claims legal validity or official verification. The same
 * metadata is mirrored onto the linked Category & Certificates vault entry.
 */
function CertificateMetadataEditor({ doc }: { doc: UploadedDocumentDTO }) {
  const mutation = useUpdateDocumentMetadata()
  const [open, setOpen] = useState(false)
  const [certificateNumber, setCertificateNumber] = useState(doc.certificate.certificateNumber ?? '')
  const [issuingAuthority, setIssuingAuthority] = useState(doc.certificate.issuingAuthority ?? '')
  const [issuingState, setIssuingState] = useState(doc.certificate.issuingState ?? '')
  const [issueDate, setIssueDate] = useState(doc.certificate.issueDate ?? '')
  const [validUntil, setValidUntil] = useState(doc.certificate.validUntil ?? '')
  const [financialYear, setFinancialYear] = useState(doc.certificate.financialYear ?? '')
  const [verificationStatus, setVerificationStatus] = useState<'SELF_REPORTED' | 'STUDENT_CONFIRMED'>(
    doc.certificate.verificationStatus === 'STUDENT_CONFIRMED' ? 'STUDENT_CONFIRMED' : 'SELF_REPORTED'
  )

  if (!open) {
    return (
      <div className='pl-12'>
        <button
          type='button'
          onClick={() => setOpen(true)}
          className='px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors'
        >
          {doc.certificate.certificateNumber || doc.certificate.issuingAuthority
            ? 'Edit certificate details'
            : 'Add certificate details'}
        </button>
      </div>
    )
  }

  return (
    <div className='pl-12'>
      <div className='rounded-xl border border-border bg-muted/20 p-3'>
        <p className='text-[11px] font-semibold text-foreground'>Certificate details (optional)</p>
        <p className='text-[11px] text-muted-foreground mt-0.5'>
          Copy values exactly as printed. These are self-reported; Formlee does not verify certificates.
        </p>

        <div className='grid sm:grid-cols-2 gap-2 mt-2'>
          <label className='text-[11px] text-foreground'>
            Certificate number
            <input value={certificateNumber} onChange={e => setCertificateNumber(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground'>
            Issuing authority
            <input value={issuingAuthority} onChange={e => setIssuingAuthority(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground'>
            Issuing state / jurisdiction
            <input value={issuingState} onChange={e => setIssuingState(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground'>
            Financial year / validity period
            <input value={financialYear} onChange={e => setFinancialYear(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground'>
            Issue date
            <input type='date' value={issueDate} onChange={e => setIssueDate(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground'>
            Valid until (if stated)
            <input type='date' value={validUntil} onChange={e => setValidUntil(e.target.value)} className={CERTIFICATE_INPUT + ' mt-0.5'} />
          </label>
          <label className='text-[11px] text-foreground sm:col-span-2'>
            Certificate status
            <select
              value={verificationStatus}
              onChange={e =>
                setVerificationStatus(
                  e.target.value === 'STUDENT_CONFIRMED' ? 'STUDENT_CONFIRMED' : 'SELF_REPORTED'
                )
              }
              className={CERTIFICATE_INPUT + ' mt-0.5'}
            >
              <option value='SELF_REPORTED'>Self-reported — not yet checked by me</option>
              <option value='STUDENT_CONFIRMED'>I have checked the details against my certificate</option>
            </select>
          </label>
        </div>

        {mutation.isError && (
          <p className='mt-2 text-[11px] text-destructive'>
            {mutation.error instanceof Error ? mutation.error.message : 'Could not save certificate details'}
          </p>
        )}

        <div className='flex items-center gap-2 mt-2'>
          <button
            type='button'
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate(
                {
                  documentId: doc.id,
                  metadata: {
                    certificateNumber: certificateNumber.trim() || null,
                    issuingAuthority: issuingAuthority.trim() || null,
                    issuingState: issuingState.trim() || null,
                    issueDate: issueDate || null,
                    validUntil: validUntil || null,
                    financialYear: financialYear.trim() || null,
                    verificationStatus,
                  },
                },
                { onSuccess: () => setOpen(false) }
              )
            }}
            className='px-3 py-1.5 text-[11px] font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
          >
            {mutation.isPending ? 'Saving…' : 'Save certificate details'}
          </button>
          <button
            type='button'
            onClick={() => setOpen(false)}
            className='px-2.5 py-1.5 text-[11px] text-muted-foreground border border-border rounded-lg hover:bg-muted'
          >
            Cancel
          </button>
          {doc.certificate.lastConfirmedAt && (
            <span className='text-[11px] text-muted-foreground'>
              Last confirmed {formatDate(doc.certificate.lastConfirmedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Authorized history of retained private files for one document type. */
function VersionHistory({ doc }: { doc: UploadedDocumentDTO }) {
  const [open, setOpen] = useState(false)
  const query = useDocumentVersions(open ? doc.id : null, open)

  if (!doc.hasPreviousVersions) return null

  return (
    <div className='pl-12'>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        className='px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors'
      >
        {open ? 'Hide version history' : 'Version history'}
      </button>

      {open && (
        <div className='mt-2 rounded-xl border border-border bg-muted/20 p-3'>
          <p className='text-[11px] text-muted-foreground'>
            Replaced files stay in private storage. Deleting a version is blocked while your vault or a prepared
            application references it.
          </p>
          {query.isLoading && <p className='text-[11px] text-muted-foreground mt-2'>Loading versions…</p>}
          {query.isError && (
            <p className='text-[11px] text-destructive mt-2'>{(query.error as Error).message}</p>
          )}
          {query.data && (
            <ul className='mt-2 space-y-1.5'>
              {query.data.documents.map(version => (
                <li key={version.id} className='flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]'>
                  <span
                    className={
                      'px-1.5 py-0.5 rounded border font-semibold ' +
                      (version.isCurrent
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-muted text-muted-foreground border-border')
                    }
                  >
                    {version.isCurrent ? 'Current' : `v${version.versions}`}
                  </span>
                  <span className='text-foreground font-medium truncate max-w-[18ch]'>{version.originalName}</span>
                  <span className='text-muted-foreground'>
                    {formatDate(version.createdAt)} · {formatBytes(version.sizeBytes)}
                  </span>
                  <a
                    href={`/api/apply/documents/${encodeURIComponent(version.id)}/file`}
                    target='_blank'
                    rel='noreferrer'
                    className='font-semibold text-primary hover:underline'
                  >
                    View
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function RenameButton({ doc }: { doc: UploadedDocumentDTO }) {
  const renameMutation = useRenameDocument()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(doc.displayLabel ?? '')

  if (!open) {
    return (
      <button
        type='button'
        onClick={() => { setLabel(doc.displayLabel ?? ''); setOpen(true) }}
        disabled={renameMutation.isPending}
        className='px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors disabled:opacity-50'
      >
        Rename
      </button>
    )
  }

  return (
    <span className='flex items-center gap-1.5'>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        maxLength={80}
        className='w-36 px-2 py-1 border border-border rounded-lg text-[11px]'
        aria-label='Document name'
        onKeyDown={e => { if (e.key === 'Enter') renameMutation.mutate({ documentId: doc.id, displayLabel: label.trim() }) }}
      />
      <button
        type='button'
        onClick={() => {
          if (label.trim()) renameMutation.mutate({ documentId: doc.id, displayLabel: label.trim() })
          setOpen(false)
        }}
        className='px-2 py-1 text-[11px] font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90'
      >
        Save
      </button>
      {renameMutation.isError && (
        <span className='text-[11px] text-destructive'>{(renameMutation.error as Error).message}</span>
      )}
    </span>
  )
}

function UploadedOtherRow({ doc }: { doc: UploadedDocumentDTO }) {
  const deleteMutation = useDeleteDocument()

  return (
    <li className='p-4'>
      <div className='flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3'>
        <div className='flex items-start gap-3 min-w-0 flex-1'>
          <div className='w-9 h-9 shrink-0 rounded-lg bg-muted flex items-center justify-center text-base'>🗂️</div>
          <p className='text-xs text-foreground truncate min-w-0'>
            <span className='font-medium'>{doc.displayLabel}</span> — {doc.originalName} · {mimeShort(doc.mimeType)} ·{' '}
            {formatBytes(doc.sizeBytes)} · uploaded {formatDate(doc.createdAt)} · <UnverifiedBadge />
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <a
            href={`/api/apply/documents/${encodeURIComponent(doc.id)}/file`}
            target='_blank'
            rel='noreferrer'
            className='px-2.5 py-1 text-[11px] font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors'
          >
            View
          </a>
          <button
            type='button'
            onClick={() => deleteMutation.mutate(doc.id)}
            disabled={deleteMutation.isPending}
            className='px-2.5 py-1 text-[11px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50'
          >
            Delete
          </button>
        </div>
      </div>
      {deleteMutation.isError && (
        <p className='mt-2 text-[11px] text-destructive'>{(deleteMutation.error as Error).message}</p>
      )}
    </li>
  )
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const ACCEPT_ATTR = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf'

function UploadControls({ documentType, replaceMode }: { documentType: DocumentId; replaceMode: boolean }) {
  const uploadMutation = useUploadDocument()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const beginUpload = (file: File | undefined | null) => {
    setLocalError(null)
    if (!file) return
    if (file.size === 0) {
      setLocalError('That file appears to be empty.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError('File exceeds the 5 MB limit — replace or compress it first.')
      return
    }
    uploadMutation.mutate({ documentType, file })
  }

  const serverError = uploadMutation.isError ? (uploadMutation.error as Error).message : null
  const error = localError ?? serverError

  return (
    <div className='pl-12'>
      <div className='flex items-center gap-2'>
        <input
          ref={fileInputRef}
          type='file'
          accept={ACCEPT_ATTR}
          className='hidden'
          aria-label={replaceMode ? 'Replace document file' : 'Upload document file'}
          onChange={e => {
            beginUpload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className='px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60'
        >
          {uploadMutation.isPending ? 'Uploading…' : replaceMode ? 'Replace file' : 'Upload file'}
        </button>
        <span className='text-[11px] text-muted-foreground'>
          {replaceMode
            ? 'JPEG, PNG or PDF · up to 5 MB · the previous file stays in version history'
            : 'JPEG, PNG or PDF · up to 5 MB'}
        </span>
      </div>
      {error && <p className='mt-1.5 text-[11px] text-destructive'>{error}</p>}
    </div>
  )
}

function OtherUploadRow() {
  const uploadMutation = useUploadDocument()
  const [label, setLabel] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const beginUpload = (file: File | undefined | null) => {
    setLocalError(null)
    if (!file) return
    if (!label.trim()) {
      setLocalError('Give this document a label first (e.g., home-state domicile) so you remember what it is for.')
      return
    }
    uploadMutation.mutate(
      { documentType: 'OTHER', file, displayLabel: label.trim() },
      { onSuccess: () => setLabel('') }
    )
  }

  const serverError = uploadMutation.isError ? (uploadMutation.error as Error).message : null
  const error = localError ?? serverError

  return (
    <div>
      <div className='border border-dashed border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3'>
        <label className='sr-only' htmlFor='other-doc-label'>Label for other document</label>
        <input
          id='other-doc-label'
          value={label}
          onChange={e => { setLabel(e.target.value); setLocalError(null) }}
          maxLength={80}
          placeholder='What is this document? (e.g., domicile certificate)'
          className='flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background'
        />
        <input
          ref={fileInputRef}
          type='file'
          accept={ACCEPT_ATTR}
          className='hidden'
          aria-label='Upload other document'
          onChange={e => {
            beginUpload(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className='px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60'
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Add document'}
        </button>
      </div>
      {error && <p className='mt-1.5 text-[11px] text-destructive'>{error}</p>}
    </div>
  )
}
