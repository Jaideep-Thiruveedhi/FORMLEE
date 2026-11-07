'use client'

import { useEffect, useState } from 'react'
import { useAgentState, useCreatePairingTicket, useRevokeAgent } from '@/lib/apply-ai/api-client'

/**
 * Extension connection control for the agent page.
 *
 *  - Pairing: the page creates a single-use code locally scoped to THIS
 *    browser's workspace; the student types it into the extension popup.
 *    The httpOnly workspace cookie never becomes extension-visible: the
 *    server resolves it server-side and issues the short-lived session.
 *  - Cancel: revokes every live agent session for the workspace.
 */
export function AgentConnectionCard({ state, loading }: { state: ReturnType<typeof useAgentState>['data']; loading: boolean }) {
  const ticketMutation = useCreatePairingTicket()
  const revokeMutation = useRevokeAgent()
  const [ticket, setTicket] = useState<{ code: string; expiresAt: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const connected = state?.connected === true

  const secondsLeft = ticket ? Math.max(0, Math.floor((new Date(ticket.expiresAt).getTime() - now) / 1000)) : 0
  const ticketExpired = ticket !== null && secondsLeft === 0

  const copyCode = () => {
    if (!ticket) return
    void navigator.clipboard?.writeText(ticket.code).catch(() => {})
  }

  return (
    <div className='bg-background border border-border rounded-2xl p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-3'>
        <h2 className='text-base font-semibold text-foreground'>Browser extension connection</h2>
        {loading ? (
          <span className='text-[11px] font-medium text-muted-foreground'>Checking…</span>
        ) : connected ? (
          <span className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-100 text-green-800 border border-green-300'>
            <span className='w-2 h-2 rounded-full bg-green-600' aria-hidden />
            Connected
          </span>
        ) : (
          <span className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-muted text-muted-foreground border border-border'>
            <span className='w-2 h-2 rounded-full bg-muted-foreground/50' aria-hidden />
            Not connected
          </span>
        )}
      </div>

      {loading ? (
        <div className='h-20 bg-muted/50 rounded-xl animate-pulse' />
      ) : connected ? (
        <div className='space-y-3'>
          <p className='text-xs text-muted-foreground'>
            Paired at {formatTime(state?.pairedAt)} · agent session valid until {formatTime(state?.expiresAt)}.
          </p>
          <p className='text-xs text-foreground bg-green-50 border border-green-200 text-green-900 rounded-xl p-3'>
            Open the <span className='font-semibold'>Formlee Apply Agent</span> popup on the page holding your form to
            run detection, review the plan and approve the fill. Filling always starts from an explicit click inside
            the extension.
          </p>
          <button
            type='button'
            disabled={revokeMutation.isPending}
            onClick={() => {
              revokeMutation.mutate(undefined, { onSuccess: () => setTicket(null) })
            }}
            className='inline-flex px-3.5 py-2 text-xs font-semibold text-red-700 border border-red-300 bg-white rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60'
          >
            {revokeMutation.isPending ? 'Disconnecting…' : 'Cancel agent connection'}
          </button>
        </div>
      ) : (
        <div className='space-y-3'>
          <ol className='text-xs text-muted-foreground space-y-1 list-decimal list-inside'>
            <li>Click below to create a one-time pairing code for this browser&apos;s workspace.</li>
            <li>Open the Formlee Apply Agent extension popup (toolbar icon) within 15 minutes.</li>
            <li>Paste the code there — the extension then holds a short-lived, workspace-scoped session only.</li>
          </ol>

          {!ticket || ticketExpired ? (
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                disabled={ticketMutation.isPending}
                onClick={() => ticketMutation.mutate(undefined, {
                  onSuccess: issued => setTicket(issued),
                })}
                className='inline-flex px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60'
              >
                {ticketMutation.isPending ? 'Creating code…' : 'Generate pairing code'}
              </button>
              {ticketExpired && (
                <span className='text-[11px] text-red-600 font-medium'>The last code expired — please generate a new one.</span>
              )}
              {ticketMutation.isError && (
                <span className='text-[11px] text-red-600 font-medium' role='alert'>
                  {(ticketMutation.error as Error).message}
                </span>
              )}
            </div>
          ) : (
            <div className='bg-primary/5 border border-primary/30 rounded-xl p-4'>
              <p className='text-[11px] font-semibold text-foreground mb-2'>Your one-time pairing code</p>
              <div className='flex flex-wrap items-center gap-3'>
                <code className='text-lg font-bold tracking-widest text-primary' aria-label='Pairing code'>
                  {ticket.code}
                </code>
                <button
                  type='button'
                  onClick={copyCode}
                  className='px-2.5 py-1 text-[11px] font-semibold text-primary border border-primary/40 rounded-md hover:bg-primary/10 transition-colors'
                >
                  Copy
                </button>
                <span className='text-[11px] text-muted-foreground'>
                  expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  } catch {
    return '—'
  }
}
