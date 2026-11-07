'use client'

import { useSyncExternalStore } from 'react'
import { ApplyHeader } from '@/components/apply/apply-header'
import { ProfileEditor } from '@/components/apply/student-profile'
import { DemoDataBadge } from '@/components/apply/status-badge'
import { useEnsureWorkspace } from '@/lib/apply-ai/api-client'
import { SaveWorkBanner } from '@/components/apply/save-work-banner'

const emptySubscribe = () => () => {}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}

export default function ApplyProfilePage() {
  const hydrated = useHydrated()
  const { ready: workspaceReady, status: workspaceStatus, rerun: rerunWorkspace } = useEnsureWorkspace()
  const dataBlocked = workspaceStatus === 'claimable' || workspaceStatus === 'unavailable'

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      <ApplyHeader active='profile' />

      <main className='flex-1'>
        <section className='relative py-10 sm:py-14 overflow-hidden'>
          <div className='absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10' />
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
            <div className='max-w-3xl'>
              <span className='inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mb-4'>
                Formlee · Profile
              </span>
              <h1 className='text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3'>
                Student profile
              </h1>
              <p className='text-lg text-muted-foreground max-w-2xl'>
                Fill it once and every examination application reuses it. Save a draft anytime — every entry is
                stored exactly as you typed it, and Formlee never fills in a value for you.
              </p>
              <p className='mt-3 text-xs text-muted-foreground max-w-2xl'>
                Everything here is <strong className='font-semibold'>self-entered and unverified</strong>: no
                examination body or Formlee has checked any of it. Spaces for official marks are only for values
                printed on your own documents — never pre-filled, never estimated.
              </p>
              <div className='mt-3'>
                <DemoDataBadge />
              </div>
            </div>
          </div>
        </section>

        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4'>
          <SaveWorkBanner status={workspaceStatus} onSaved={rerunWorkspace} />
        </section>

        <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'>
          <ProfileEditor profileReady={hydrated && workspaceReady && !dataBlocked} />
        </section>
      </main>

      <footer className='border-t border-border bg-background py-6'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground'>
          <p>
            Formlee never submits applications or shares your data with any examination body. Verification happens
            only on official portals.
          </p>
        </div>
      </footer>
    </div>
  )
}
