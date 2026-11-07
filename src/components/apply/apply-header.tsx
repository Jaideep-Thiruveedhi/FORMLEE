'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'
import { FormleePetMark } from '@/components/brand/formlee-pet-mark'

const TABS = [
  { href: '/apply', label: 'Dashboard' },
  { href: '/apply/applications', label: 'Applications' },
  { href: '/apply/profile', label: 'Profile' },
  { href: '/apply/documents', label: 'Documents' },
  { href: '/apply/agent', label: 'Agent' },
  { href: '/apply/billing', label: 'Credits' },
]

/**
 * Formlee workspace header with the account menu: shows the current
 * authentication state (sign-in entry point when signed out, name/email menu
 * with sign-out when signed in). Signing out also drops cached workspace data
 * so nothing from the previous workspace lingers on screen.
 *
 * Navigation is inline on desktop and a horizontally scrollable second row on
 * small screens, so five workspace sections never squeeze the account menu.
 */
export function ApplyHeader({
  active,
}: {
  active: 'dashboard' | 'applications' | 'profile' | 'documents' | 'agent' | 'billing'
}) {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user ?? null
  const router = useRouter()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  async function handleSignOut() {
    setMenuOpen(false)
    await authClient.signOut()
    // Cached profile/document data belongs to the signed-out workspace: drop
    // it so the next visitor (or the signed-out owner) starts from truth.
    queryClient.removeQueries({ queryKey: ['apply-ai'] })
    router.refresh()
  }

  const menuLabel = user?.name || user?.email || 'Account'
  const initials = (user?.name || user?.email || 'A').slice(0, 2).toUpperCase()

  return (
    <header className='workspace-header sticky top-0 z-50'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex h-16 items-center justify-between gap-4'>
          <div className='flex items-center gap-3 shrink-0'>
            <Link href='/' className='flex items-center gap-2'>
              <FormleePetMark size={34} />
              <span className='font-semibold text-xl hidden sm:block'>Formlee</span>
            </Link>
            <span className='text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1 hidden sm:inline-flex'>
              Application workspace
            </span>
          </div>

          <nav className='hidden md:flex items-center gap-1.5 lg:gap-2'>
            {TABS.map(tab => {
              const isActive = tab.href === '/apply' ? active === 'dashboard' : tab.href.endsWith(active)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ' +
                    (isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted')}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>

          <div className='flex items-center gap-2 shrink-0' ref={menuRef}>
            {isPending ? (
              <div className='w-8 h-8 rounded-full bg-muted animate-pulse' aria-hidden />
            ) : user ? (
              <div className='relative'>
                <button
                  type='button'
                  aria-haspopup='menu'
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(open => !open)}
                  className='flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors max-w-[14rem]'
                >
                  <span className='w-6 h-6 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center'>
                    {initials}
                  </span>
                  <span className='hidden sm:inline truncate'>{menuLabel}</span>
                </button>
                {menuOpen && (
                  <div className='absolute right-0 mt-2 w-60 bg-background border border-border rounded-xl shadow-lg p-2 z-50'>
                    <p className='px-2.5 py-2 text-xs text-muted-foreground truncate border-b border-border mb-1'>
                      {user.email}
                    </p>
                    {(user as any).role === 'ADMIN' && (
                      <Link
                        href='/admin/referrals'
                        onClick={() => setMenuOpen(false)}
                        className='block px-2.5 py-2 text-sm rounded-lg text-foreground hover:bg-muted transition-colors'
                      >
                        Admin: Referrals
                      </Link>
                    )}
                    <Link
                      href='/partner'
                      onClick={() => setMenuOpen(false)}
                      className='block px-2.5 py-2 text-sm rounded-lg text-foreground hover:bg-muted transition-colors'
                    >
                      Partner dashboard
                    </Link>
                    <button
                      type='button'
                      onClick={() => { void handleSignOut() }}
                      className='w-full text-left px-2.5 py-2 text-sm rounded-lg text-red-600 hover:bg-red-50 transition-colors'
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href='/login'
                className='px-3 py-1.5 rounded-lg text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors'
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        <nav className='flex md:hidden items-center gap-1 overflow-x-auto pb-2 -mt-1'>
          {TABS.map(tab => {
            const isActive = tab.href === '/apply' ? active === 'dashboard' : tab.href.endsWith(active)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={'px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ' +
                  (isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted')}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
