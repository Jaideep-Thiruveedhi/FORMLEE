'use client'

import { useSyncExternalStore } from 'react'
import { ApplyHeader } from '@/components/apply/apply-header'
import { DocumentManager } from '@/components/apply/document-checklist'
import { UnverifiedBadge } from '@/components/apply/status-badge'
import { useDocuments, useEnsureWorkspace, useProfile } from '@/lib/apply-ai/api-client'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'

const emptySubscribe = () => () => {}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

export default function ApplyDocumentsPage() {
  const hydrated = useHydrated()
  const { ready: workspaceReady, status: workspaceStatus, rerun: rerunWorkspace } = useEnsureWorkspace()
  const dataBlocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'
  const profileQuery = useProfile(workspaceReady && !dataBlocked)
  const profileLike = profileQuery.data?.profile ?? null

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='documents' />

      <main className='flex-1'>
        <section className='relative py-10 sm:py-14 overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10' />
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
            <div className='max-w-3xl'>
              <span className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mb-4'>
                Formlee · Documents
              </span>
              <h1 className='text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3'>
                Document manager
              </h1>
              <p className='text-lg text-muted-foreground max-w-2xl'>
                Upload each document once — photograph, signature, marksheets — and every examination application
                reuses it. Replace an incorrect file anytime; only exam-specific extras are added per exam.
              </p>
              <p className='mt-3 text-xs text-muted-foreground max-w-2xl flex flex-wrap items-center gap-2'>
                <UnverifiedBadge />
                <span>
                  Uploaded never means verified. No examination body or Formlee checks these files here — only the
                  official portal can verify anything, and the checklist below is a general preparation aid, not an
                  official requirement list of any exam.
                </span>
              </p>
            </div>
          </div>
        </section>

        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
          <SaveWorkBanner status={workspaceStatus} onSaved={rerunWorkspace} />
        </section>

        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
          <div className='mb-5 bg-secondary border border-border rounded-xl p-4 text-[11px] text-secondary-foreground leading-relaxed max-w-3xl'>
            <strong className='font-semibold'>Privacy of your files:</strong> uploads never live in the public web
            folder. They are stored privately and served only to this workspace through an authorized link that is
            never cached. Document contents are never sent to any AI model.
          </div>

          <DocumentManager documentsReady={hydrated && workspaceReady && !dataBlocked} profileLike={profileLike} />
        </section>
      </main>

      <footer className='border-t border-border bg-background py-6'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground'>
          <p>
            Category and PwD checklists adapt to the answers in your{' '}
            <a href='/apply/profile#profile-section-preferences' className='text-primary hover:underline'>
              profile preferences
            </a>{' '}
            — Formlee decides nothing about eligibility on your behalf.
          </p>
        </div>
      </footer>
    </div>
  )
}
