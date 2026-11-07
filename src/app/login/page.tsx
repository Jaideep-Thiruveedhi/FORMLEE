'use client'

import type { FormEvent } from 'react'
import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { authClient } from '@/lib/auth-client'
import { FormleePetMark } from '@/components/brand/formlee-pet-mark'

async function claimReferralAfterSignup() {
  try {
    await fetch('/api/referrals/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  } catch {
    // Non-blocking: attribution failure must not break registration.
  }
}

type Mode = 'sign-in' | 'sign-up'

function subscribeToLocation(callback: () => void) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

function locationSearch() {
  return window.location.search
}

// Friendly copy for the common Better Auth server error codes.
const serverErrorMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email or password is incorrect.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'Your password is too long (maximum 200 characters).',
  FAILURE_TO_CREATE_USER: 'Could not create the account right now. Please try again.',
}

// Same validation rules the server enforces (Better Auth defaults).
const signInSchema = z.object({
  email: z.email({ error: 'Enter a valid email address' }).max(120),
  password: z.string().min(1, { error: 'Enter your password' }).max(200),
})

const signUpSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter your name' }).max(80),
  email: z.email({ error: 'Enter a valid email address' }).max(120),
  password: z.string().min(8, { error: 'Use at least 8 characters for your password' }).max(200),
})

/**
 * Milestone 3 — email/password registration and sign-in.
 *
 * Honesty rules:
 *  - There is no email delivery in this milestone, so nothing here may claim
 *    that an email was sent or that an address was verified.
 *  - The account "name" is display-only: the student profile inside Formlee
 *    is a separate, user-entered workspace and is never auto-filled from it.
 */
export default function LoginPage() {
  const router = useRouter()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const search = useSyncExternalStore(subscribeToLocation, locationSearch, () => '')

  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const mode = modeOverride ?? (new URLSearchParams(search).get('mode') === 'sign-up' ? 'sign-up' : 'sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    setModeOverride(next)
    setError(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError(null)

    const schema = mode === 'sign-up' ? signUpSchema : signInSchema
    const parsed = schema.safeParse({ name, email, password })
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      setError(firstIssue?.message ?? 'Check the form and try again.')
      return
    }

    setBusy(true)
    // Both schemas share email/password; the sign-up schema additionally owns
    // `name` and already guaranteed it is a non-empty trimmed string.
    const values = parsed.data as { name?: unknown; email: string; password: string }
    const authResponse = await (mode === 'sign-up'
      ? authClient.signUp.email({
          name: String(values.name ?? ''),
          email: values.email,
          password: values.password,
        })
      : authClient.signIn.email({ email: values.email, password: values.password }))

    const serverError = (authResponse as unknown as {
      error?: { code?: string; message?: string } | null
    }).error

    if (serverError) {
      setBusy(false)
      setError(
        (serverError.code && serverErrorMessages[serverError.code]) ||
          serverError.message ||
          'Something went wrong. Please try again.'
      )
      return
    }

    // Session cookie is set by the server; land on the dashboard. If this
    // browser holds an unclaimed anonymous workspace, the dashboard offers
    // the explicit "Save my work" claim there.
    if (mode === 'sign-up') {
      await claimReferralAfterSignup()
    }
    router.push('/apply')
    router.refresh()
  }

  const signedInUser = session?.user ?? null

  return (
    <div className='auth-page'>
      <header className='auth-header'>
        <div className='auth-header-inner'>
          <Link href='/' className='brand-lockup' aria-label='Formlee home'>
            <FormleePetMark size={36} /><span>formlee<span className='brand-period'>.</span></span>
          </Link>
          <Link href='/apply'>Open workspace <span aria-hidden>↗</span></Link>
        </div>
      </header>

      <main className='auth-main'>
        <section className='auth-story'>
          <p className='eyebrow'><span className='eyebrow-line' /> YOUR APPLICATION WORKSPACE</p>
          <h1>Keep the details.<br /><em>Lose the repeat work.</em></h1>
          <p>Sign in to reach your Student Information Vault, application trackers and preparation tools.</p>
          <div className='auth-proof'><span className='auth-proof-mark'><FormleePetMark size={27} /></span><span>Careful assistance. Your choices stay yours.</span></div>
        </section>
        <div className='w-full max-w-md'>
          <div className='auth-card'>
            {sessionPending ? (
              <div className='h-64 flex items-center justify-center'>
                <div className='w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin' aria-label='Checking your session' />
              </div>
            ) : signedInUser ? (
              <div className='text-center space-y-4'>
                <h1 className='text-2xl font-bold text-foreground'>You are signed in</h1>
                <p className='text-sm text-muted-foreground'>
                  Signed in as <span className='font-medium text-foreground'>{signedInUser.name || signedInUser.email}</span>.
                </p>
                  <Link
                  href='/apply'
                  className='inline-flex w-full justify-center px-4 py-2.5 text-sm font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
                >
                  Open Formlee
                </Link>
                <button
                  type='button'
                  onClick={() => {
                    void authClient.signOut()
                  }}
                  className='text-xs text-muted-foreground hover:text-red-600'
                >
                  Not you? Sign out
                </button>
              </div>
            ) : (
              <>
                {/* Mode switch */}
                <div className='grid grid-cols-2 gap-1 bg-muted/50 border border-border rounded-xl p-1 mb-6'>
                  <button
                    type='button'
                    aria-pressed={mode === 'sign-in'}
                    onClick={() => switchMode('sign-in')}
                    className={
                      'px-3 py-2 rounded-lg text-sm font-semibold transition-colors ' +
                      (mode === 'sign-in'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    Sign in
                  </button>
                  <button
                    type='button'
                    aria-pressed={mode === 'sign-up'}
                    onClick={() => switchMode('sign-up')}
                    className={
                      'px-3 py-2 rounded-lg text-sm font-semibold transition-colors ' +
                      (mode === 'sign-up'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    Create account
                  </button>
                </div>

                <h1 className='text-2xl font-bold text-foreground mb-1'>
                  {mode === 'sign-in' ? 'Welcome back' : 'Keep your application work'}
                </h1>
                <p className='text-sm text-muted-foreground mb-6'>
                  {mode === 'sign-in'
                    ? 'Sign in to reach the profile and documents saved to your account.'
                    : 'Accounts save your Formlee profile and documents across sign-ins and devices.'}
                </p>

                <form onSubmit={e => { void handleSubmit(e) }} noValidate className='space-y-4'>
                  {mode === 'sign-up' && (
                    <div>
                      <label htmlFor='login-name' className='block text-xs font-semibold text-foreground mb-1.5'>
                        Your name
                      </label>
                      <input
                        id='login-name'
                        type='text'
                        autoComplete='name'
                        maxLength={80}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className='w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'
                        placeholder='Shown only in your account menu'
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor='login-email' className='block text-xs font-semibold text-foreground mb-1.5'>
                      Email
                    </label>
                    <input
                      id='login-email'
                      type='email'
                      autoComplete='email'
                      maxLength={120}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className='w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'
                      placeholder='you@example.com'
                    />
                  </div>

                  <div>
                    <label htmlFor='login-password' className='block text-xs font-semibold text-foreground mb-1.5'>
                      Password
                    </label>
                    <input
                      id='login-password'
                      type='password'
                      autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                      maxLength={200}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className='w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'
                      placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your password'}
                    />
                  </div>

                  {error && (
                    <div className='bg-red-50 border border-red-200 rounded-lg px-3 py-2.5' role='alert'>
                      <p className='text-xs text-red-700 font-medium'>{error}</p>
                    </div>
                  )}

                  <button
                    type='submit'
                    disabled={busy}
                    className='w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 text-sm font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
                  >
                    {busy && <span className='w-3.5 h-3.5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin' aria-hidden />}
                    {busy
                      ? (mode === 'sign-up' ? 'Creating your account…' : 'Signing in…')
                      : (mode === 'sign-up' ? 'Create account' : 'Sign in')}
                  </button>
                </form>

                {mode === 'sign-up' ? (
                  <p className='mt-6 text-xs text-muted-foreground leading-relaxed'>
                    Worked anonymously in this browser before? After creating an account, the Formlee
                    dashboard offers <span className='font-semibold text-foreground'>{'Save my work'}</span> to link
                    that existing profile and those documents to it. We never send email in this milestone —
                    registration is immediate and nothing is presented as verified.
                  </p>
                ) : (
                  <p className='mt-6 text-xs text-muted-foreground leading-relaxed'>
                    Files and profile details you stored anonymously on this device are not touched by
                    signing in; you choose whether and where to save them from the dashboard.
                  </p>
                )}
              </>
            )}
          </div>

        </div>
      </main>
      <footer className='auth-footer'>Formlee never submits applications, fills CAPTCHAs or OTPs, or makes payments on your behalf.</footer>
    </div>
  )
}
