'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { EXAMS, OFFICIAL_SOURCE_NOTE } from '@/lib/apply-ai/exams'
import { useApplyStore } from '@/lib/apply-ai/store'
import {
  evaluateExamRequirements,
  getApplicationStatus,
  isDocumentApplicable,
  isDocumentUploaded,
} from '@/lib/apply-ai/requirements'
import { DOCUMENT_TYPES } from '@/lib/apply-ai/documents'
import {
  useAgentState,
  useDocuments,
  useEnsureWorkspace,
  useProfile,
} from '@/lib/apply-ai/api-client'
import type { ApplicationStatus, ExamId } from '@/lib/apply-ai/types'
import {
  JEE_MAIN_ADAPTER_VERSION,
  JEE_MAIN_DOCUMENT_SPECS,
  JEE_MAIN_FILLS,
  JEE_MAIN_MANUAL,
  JEE_MAIN_PORTAL_ORIGIN,
  JEE_MAIN_PORTAL_PATH_PREFIX,
  JEE_MAIN_SOURCES,
  JEE_MAIN_STATUS_LABEL,
  JEE_MAIN_UPLOAD_RULES,
  JEE_MAIN_VERIFIED_ON,
  jeeUploadGuidance,
} from '@/lib/agent/jee-main'
import {
  VITEEE_ADAPTER_VERSION,
  VITEEE_DOCUMENT_SPECS,
  VITEEE_FILLABLE_CANONICALS,
  VITEEE_OFFICIAL_ORIGIN,
  VITEEE_FIXTURE_PATH,
  VITEEE_SOURCES,
  VITEEE_STATUS_LABEL,
  VITEEE_VERIFIED_ON,
} from '@/lib/agent/viteee'
import { ApplyHeader } from '@/components/apply/apply-header'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'
import { PreparationWorkflow } from '@/components/apply/preparation-workflow'
import { AgentConnectionCard } from '@/components/apply/agent/agent-connection-card'
import { AgentPlanPreviewCard } from '@/components/apply/agent/agent-plan-preview'
import { AgentReadinessCard } from '@/components/apply/agent/agent-readiness-card'

const emptySubscribe = () => () => {}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

const AGENT_CAPABILITIES = [
  'Reads the labels of visible form fields on the page you are working on — never the page content around them.',
  'Proposes which saved profile field matches each form field, and shows the plan before anything happens.',
  'Fills supported inputs, selects, radios and checkboxes only after you approve the plan inside the extension.',
  'Never touches passwords, OTPs, CAPTCHAs, payments, file uploads or consent checkboxes.',
  'Stops before submission — you always press Submit on the official portal yourself.',
]

/**
 * Formlee Apply Agent (V1) — control center.
 *
 * Readiness/preparation reuse the existing profile, document and
 * examination-requirements logic; the page adds pairing, connection state and
 * the detection-plan preview. The extension popup remains the single place
 * where a fill is reviewed and approved.
 */
export default function ApplyAgentPage() {
  const hydrated = useHydrated()
  const { ready: workspaceReady, status: workspaceStatus, rerun: rerunWorkspace } = useEnsureWorkspace()

  const dataBlocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'
  const agentEnabled = workspaceReady && !dataBlocked
  const profileQuery = useProfile(agentEnabled)
  const documentsQuery = useDocuments(agentEnabled)
  const agentStateQuery = useAgentState(agentEnabled)

  const applications = useApplyStore(state => state.applications)
  const [selectedExamId, setSelectedExamId] = useState<ExamId>('JEE_MAIN')

  const profile = profileQuery.data?.profile ?? null
  const documents = useMemo(() => documentsQuery.data?.documents ?? [], [documentsQuery.data])
  const evaluation = profileQuery.data?.evaluation ?? null

  const requirementsByExam = useMemo(() => {
    const map = {} as Record<string, { requirement: ReturnType<typeof evaluateExamRequirements>; status: ApplicationStatus }>
    for (const exam of EXAMS) {
      const requirement = evaluateExamRequirements(exam.id, profile, documents)
      map[exam.id] = {
        requirement,
        status: getApplicationStatus(requirement, !!applications[exam.id]).status,
      }
    }
    return map
  }, [profile, documents, applications])

  const jeeDocumentChecks = useMemo(
    () =>
      JEE_MAIN_UPLOAD_RULES.map(rule => ({
        ...rule,
        guidance: jeeUploadGuidance(
          rule.documentType,
          documents.find(document => document.documentType === rule.documentType) ?? null
        ),
      })),
    [documents]
  )

  const loading =
    !hydrated ||
    !workspaceReady ||
    (!dataBlocked && (profileQuery.isLoading || documentsQuery.isLoading || agentStateQuery.isLoading))
  const errored = !dataBlocked && (profileQuery.isError || documentsQuery.isError)

  const selectedExam = EXAMS.find(exam => exam.id === selectedExamId) ?? EXAMS[0]
  const selectedRequirement = requirementsByExam[selectedExamId]

  const applicableDocs = useMemo(() => DOCUMENT_TYPES.filter(doc => doc.id !== 'OTHER' && isDocumentApplicable(doc.id, profile)), [profile])
  const uploadedDocs = applicableDocs.filter(doc => isDocumentUploaded(doc.id, documents)).length

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='agent' />

      <main className='flex-1'>
        <section className='relative py-10 sm:py-14 overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10' />
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
            <div className='max-w-3xl'>
              <span className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mb-4'>
                Apply Agent V1
              </span>
              <h1 className='text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3'>
                Fill application forms <span className='text-primary'>with your review in the loop</span>
              </h1>
              <p className='text-sm text-muted-foreground max-w-2xl'>
                The browser agent proposes how the form fields in front of you map to your saved profile. You check
                the plan, approve it inside the extension, and it types the answers in — skipping everything that
                must stay human: submissions, payments, CAPTCHAs and OTPs.
              </p>
              <p className='mt-2 text-xs text-muted-foreground max-w-2xl'>{OFFICIAL_SOURCE_NOTE}</p>
            </div>
          </div>
        </section>

        {loading ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='grid gap-4 lg:grid-cols-3'>
              <div className='h-40 rounded-xl bg-muted/40 animate-pulse' />
              <div className='h-40 rounded-xl bg-muted/40 animate-pulse' />
              <div className='h-40 rounded-xl bg-muted/40 animate-pulse' />
            </div>
          </section>
        ) : dataBlocked ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
          <SaveWorkBanner status={workspaceStatus} onSaved={rerunWorkspace} />
          </section>
        ) : errored ? (
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
            <div className='bg-red-50 border border-red-200 rounded-xl p-6 max-w-lg mx-auto text-center'>
              <p className='text-sm font-semibold text-red-700 mb-2'>Could not load your data</p>
              <p className='text-xs text-red-600'>
                {(profileQuery.error as Error | null)?.message ?? (documentsQuery.error as Error | null)?.message ?? 'An unexpected error occurred.'}
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <SaveWorkBanner status={workspaceStatus} onSaved={rerunWorkspace} />
            </section>

            {/* Capabilities */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <div className='bg-background border border-border rounded-2xl p-5'>
                <h2 className='text-base font-semibold text-foreground mb-2'>What the agent does — and never does</h2>
                <ul className='grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground'>
                  {AGENT_CAPABILITIES.map(item => (
                    <li key={item} className='flex gap-2'>
                      <span aria-hidden className='text-primary'>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className='text-[11px] text-muted-foreground mt-3 border-t border-border pt-3'>
                  Field matching runs on your machine with deterministic rules; a local model is consulted only for
                  labels that rules cannot classify, and only labels/option texts are ever sent to it — never your
                  actual answers. Cloud AI is not used in this milestone.
                </p>
              </div>
            </section>

            {/* Readiness + connection side by side */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 grid gap-4 lg:grid-cols-2'>
              <AgentReadinessCard evaluation={evaluation} loading={profileQuery.isLoading} />
              <AgentConnectionCard state={agentStateQuery.data} loading={agentStateQuery.isLoading} />
            </section>

            {/* Demo entry */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <div className='bg-background border border-border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-3'>
                <span aria-hidden className='text-lg'>🧪</span>
                <div className='flex-1'>
                  <p className='text-sm font-semibold text-foreground'>Demonstration form</p>
                  <p className='text-xs text-muted-foreground'>
                    A clearly-labeled local page with synthetic fields to try the whole flow safely: detection,
                    mapping, preview, approval, dropdown/radio handling, missing &amp; unsafe field behaviour.
                    It is not an official portal and it never submits anywhere.
                  </p>
                </div>
                <Link
                  href='/apply/agent/demo-form'
                  className='self-start sm:self-auto px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
                >
                  Open demo form
                </Link>
              </div>
            </section>

            {/* JEE Main 2027 adapter */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <div className='bg-background border border-border rounded-2xl p-5 space-y-4'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='text-base font-semibold text-foreground'>JEE Main 2027 (Session 1)</h2>
                      <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300'>
                        Beta
                      </span>
                      <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border'>
                        Live portal not verified
                      </span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1 max-w-2xl'>
                      {JEE_MAIN_STATUS_LABEL}. The adapter only recognises the verified official application area
                      {' '}
                      <span className='font-mono text-[11px]'>{JEE_MAIN_PORTAL_ORIGIN}{JEE_MAIN_PORTAL_PATH_PREFIX}</span>
                      {' '}and maps labels documented in the official Information Bulletin. You log in, complete CAPTCHA/OTP,
                      review every field and submit on the official portal yourself.
                    </p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Link
                      href='/apply/agent/jee-main-2027-demo'
                      className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
                    >
                      Open synthetic JEE fixture
                    </Link>
                    <a
                      href='https://jeemain.nta.nic.in/online-application-form-for-jee-main-2027-session-1/'
                      target='_blank'
                      rel='noreferrer noopener'
                      className='px-4 py-2 text-xs font-semibold text-foreground bg-background border border-border rounded-lg hover:bg-muted/40 transition-colors'
                    >
                      Official application page
                    </a>
                  </div>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div className='rounded-xl border border-border bg-muted/20 p-3'>
                    <p className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2'>
                      Documented fields the adapter can propose
                    </p>
                    <ul className='space-y-1 text-[11px] text-muted-foreground'>
                      {JEE_MAIN_FILLS.map(item => (
                        <li key={item} className='flex gap-2'>
                          <span aria-hidden className='text-primary'>•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className='rounded-xl border border-red-200 bg-red-50/50 p-3'>
                    <p className='text-[11px] font-semibold uppercase tracking-wide text-red-700 mb-2'>
                      Always left for you (never automated)
                    </p>
                    <ul className='space-y-1 text-[11px] text-red-800/90'>
                      {JEE_MAIN_MANUAL.map(item => (
                        <li key={item} className='flex gap-2'>
                          <span aria-hidden>•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className='rounded-xl border border-border p-3'>
                  <p className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2'>
                    Official document specifications
                  </p>
                  <dl className='grid gap-2 sm:grid-cols-2 text-[11px]'>
                    {JEE_MAIN_DOCUMENT_SPECS.map(doc => (
                      <div key={doc.label} className='rounded-lg bg-muted/30 border border-border/70 p-2'>
                        <dt className='font-semibold text-foreground'>{doc.label}</dt>
                        <dd className='text-muted-foreground mt-0.5'>{doc.spec}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className='mt-3 border-t border-border/70 pt-3'>
                    <p className='text-[11px] font-semibold text-foreground'>
                      Your private Formlee documents — advisory check
                    </p>
                    <ul className='mt-1 space-y-1.5 text-[11px]'>
                      {jeeDocumentChecks.map(check => (
                        <li key={check.documentType} className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
                          <span className='font-medium text-foreground'>{check.label}</span>
                          <span
                            className={
                              check.guidance.status === 'ok'
                                ? 'text-emerald-700'
                                : check.guidance.status === 'outside-guidance'
                                  ? 'text-amber-800'
                                  : 'text-muted-foreground'
                            }
                          >
                            {check.guidance.status === 'ok'
                              ? 'appears within published format/size limits'
                              : check.guidance.status === 'outside-guidance'
                                ? 'appears outside published format/size limits'
                                : 'not uploaded'}
                          </span>
                          <span className='basis-full text-muted-foreground'>{check.guidance.message}</span>
                        </li>
                      ))}
                    </ul>
                    <p className='text-[10px] text-muted-foreground mt-2'>
                      Advisory only — Formlee does not verify documents and never attaches them to the portal. The
                      official portal&apos;s own validator is final.
                    </p>
                  </div>
                  <p className='text-[11px] text-muted-foreground mt-2'>
                    Formlee never attaches documents to a portal or sends them to AI. Select and upload each file yourself on the
                    official page after checking these limits.
                  </p>
                </div>

                <div className='border-t border-border pt-3'>
                  <p className='text-[11px] font-semibold text-foreground'>Official sources verified {JEE_MAIN_VERIFIED_ON}</p>
                  <ul className='mt-1 space-y-1 text-[11px]'>
                    {JEE_MAIN_SOURCES.map(source => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target='_blank'
                          rel='noreferrer noopener'
                          className='text-primary hover:underline'
                        >
                          {source.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className='text-[10px] text-muted-foreground mt-2'>
                    Adapter {JEE_MAIN_ADAPTER_VERSION}. The synthetic fixture uses documented labels but is not an official page
                    and never submits anywhere.
                  </p>
                </div>
              </div>
            </section>

            {/* VITEEE 2027 adapter */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <div className='bg-background border border-border rounded-2xl p-5 space-y-4'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='text-base font-semibold text-foreground'>VITEEE 2027</h2>
                      <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300'>
                        Documentation-backed
                      </span>
                      <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border'>
                        Demo only
                      </span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1 max-w-2xl'>
                      {VITEEE_STATUS_LABEL}. The adapter recognises the public VITEEE website
                      {' '}
                      <span className='font-mono text-[11px]'>{VITEEE_OFFICIAL_ORIGIN}</span>
                      {' '}and a synthetic local demo. Because the live application portal was not inspected, it is
                      deliberately limited to common Personal Details / Qualification Details labels.
                    </p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Link
                      href={VITEEE_FIXTURE_PATH}
                      className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
                    >
                      Open synthetic VITEEE fixture
                    </Link>
                    <a
                      href='https://viteee.vit.ac.in/'
                      target='_blank'
                      rel='noreferrer noopener'
                      className='px-4 py-2 text-xs font-semibold text-foreground bg-background border border-border rounded-lg hover:bg-muted/40 transition-colors'
                    >
                      VITEEE official website
                    </a>
                  </div>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <div className='rounded-xl border border-border bg-muted/20 p-3'>
                    <p className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2'>
                      Documented fields the adapter can propose
                    </p>
                    <ul className='space-y-1 text-[11px] text-muted-foreground'>
                      {VITEEE_FILLABLE_CANONICALS.map(canonical => (
                        <li key={canonical} className='flex gap-2'>
                          <span aria-hidden className='text-primary'>•</span>
                          <span>{canonical}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className='rounded-xl border border-red-200 bg-red-50/50 p-3'>
                    <p className='text-[11px] font-semibold uppercase tracking-wide text-red-700 mb-2'>
                      Always left for you (never automated)
                    </p>
                    <ul className='space-y-1 text-[11px] text-red-800/90'>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Login, OTP and CAPTCHA</span></li>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Parent/guardian confirmation details</span></li>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Address components and PIN code</span></li>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Exam preferences, slot booking and city choices</span></li>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Photograph, signature and certificate uploads</span></li>
                      <li className='flex gap-2'><span aria-hidden>•</span><span>Declaration, payment and final submission</span></li>
                    </ul>
                  </div>
                </div>

                <div className='rounded-xl border border-border p-3'>
                  <p className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2'>
                    Official document specifications
                  </p>
                  <dl className='grid gap-2 sm:grid-cols-2 text-[11px]'>
                    {VITEEE_DOCUMENT_SPECS.map(doc => (
                      <div key={doc.label} className='rounded-lg bg-muted/30 border border-border/70 p-2'>
                        <dt className='font-semibold text-foreground'>{doc.label}</dt>
                        <dd className='text-muted-foreground mt-0.5'>{doc.spec}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className='border-t border-border pt-3'>
                  <p className='text-[11px] font-semibold text-foreground'>Official sources verified {VITEEE_VERIFIED_ON}</p>
                  <ul className='mt-1 space-y-1 text-[11px]'>
                    {VITEEE_SOURCES.map(source => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target='_blank'
                          rel='noreferrer noopener'
                          className='text-primary hover:underline'
                        >
                          {source.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className='text-[10px] text-muted-foreground mt-2'>
                    Adapter {VITEEE_ADAPTER_VERSION}. The synthetic fixture uses documented labels but is not an official page
                    and never submits anywhere.
                  </p>
                </div>
              </div>
            </section>

            {/* Fill plan preview */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <AgentPlanPreviewCard plan={agentStateQuery.data?.plan ?? null} planAt={agentStateQuery.data?.planAt ?? null} />
            </section>

            {/* Preparation workflow (reuses the dashboard component + requirement engine) */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
              <div className='bg-background border border-border rounded-2xl p-5'>
                <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
                  <div>
                    <h2 className='text-base font-semibold text-foreground'>Application preparation workflow</h2>
                    <p className='text-xs text-muted-foreground mt-0.5'>
                      The same readiness engine as the dashboard: make each exam&apos;s requirements green, and the
                      agent simply speeds up the final form-filling step.
                    </p>
                  </div>
                  <label className='flex items-center gap-2 text-xs font-medium text-foreground'>
                    <span className='text-muted-foreground'>Exam</span>
                    <select
                      value={selectedExamId}
                      onChange={e => setSelectedExamId(e.target.value as ExamId)}
                      className='px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
                      aria-label='Choose an examination for the preparation workflow'
                    >
                      {EXAMS.map(exam => (
                        <option key={exam.id} value={exam.id}>{exam.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <PreparationWorkflow
                  examId={selectedExam.id}
                  examName={selectedExam.name}
                  requirement={selectedRequirement.requirement}
                  started={!!applications[selectedExam.id]}
                  startedAt={applications[selectedExam.id]?.startedAt ?? null}
                  status={selectedRequirement.status}
                />
                <p className='text-[11px] text-muted-foreground mt-4'>
                  {uploadedDocs} of {applicableDocs.length} applicable core documents uploaded on the
                  {' '}
                  <Link href='/apply/documents' className='text-primary hover:underline font-medium'>Documents page</Link>.
                </p>
              </div>
            </section>

            {/* Safety notice */}
            <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
              <div className='bg-secondary border border-border rounded-2xl p-5 text-xs text-secondary-foreground leading-relaxed'>
                <strong className='font-semibold'>Safety boundaries (V1):</strong> the agent never bypasses CAPTCHAs or
                OTP verification, never automates payment, never submits an application, never uploads your documents
                to any site, and never selects an ambiguous category or eligibility option without asking you.
                Connections are short-lived and revocable. Nothing was validated against an official examination
                portal yet — treat every fill as a demonstration until an official integration is announced.
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
