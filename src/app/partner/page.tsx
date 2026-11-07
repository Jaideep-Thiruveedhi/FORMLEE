'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  useReferralDashboard,
  useReferralCommissions,
  useReferralPayouts,
} from '@/lib/apply-ai/api-client'

function formatRupees(paise: number): string {
  return '₹' + (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function PartnerDashboardPage() {
  const dashboardQuery = useReferralDashboard(true)
  const commissionsQuery = useReferralCommissions(true)
  const payoutsQuery = useReferralPayouts(true)
  const [copied, setCopied] = useState(false)

  const dashboard = dashboardQuery.data
  const referralUrl = dashboard?.codes[0]
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${dashboard.codes[0]}`
    : ''

  async function copyLink() {
    if (!referralUrl) return
    await navigator.clipboard.writeText(referralUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (dashboardQuery.isLoading) {
    return (
      <main className='min-h-screen bg-background flex items-center justify-center'>
        <p className='text-sm text-muted-foreground'>Loading partner dashboard…</p>
      </main>
    )
  }

  if (!dashboard) {
    return <PartnerAccessRequired />
  }

  return (
    <main className='min-h-screen bg-background'>
      <header className='border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50'>
        <div className='max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between'>
          <Link href='/' className='flex items-center gap-2'>
            <div className='w-8 h-8 rounded-lg bg-primary flex items-center justify-center'>
              <span className='text-primary-foreground font-bold text-sm'>F</span>
            </div>
            <span className='font-semibold text-xl'>Formlee Partner</span>
          </Link>
          <Link href='/apply' className='text-sm text-muted-foreground hover:text-foreground'>
            Student dashboard
          </Link>
        </div>
      </header>

      <section className='max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8'>
        <div>
          <h1 className='text-2xl font-bold text-foreground'>{dashboard.partner.name}</h1>
          <p className='text-sm text-muted-foreground mt-1'>
            {dashboard.partner.tier.replace(/_/g, ' ')} · {formatRupees(dashboard.partner.commissionBasisPoints)} commission
          </p>
        </div>

        {/* Referral link */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Your referral link</p>
          <div className='mt-3 flex flex-wrap gap-3'>
            <input
              readOnly
              value={referralUrl}
              className='flex-1 min-w-[240px] px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm text-foreground'
            />
            <button
              type='button'
              onClick={copyLink}
              className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors'
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              type='button'
              onClick={() => {
                if (navigator.share && referralUrl) {
                  void navigator.share({ title: 'Formlee referral', url: referralUrl })
                }
              }}
              disabled={typeof window === 'undefined' || !navigator.share}
              className='px-4 py-2 text-xs font-semibold text-foreground bg-background border border-border rounded-lg hover:bg-muted/40 transition-colors disabled:opacity-50'
            >
              Share
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <StatCard label='Total clicks' value={dashboard.stats.clicks} />
          <StatCard label='Registrations' value={dashboard.stats.registrations} />
          <StatCard label='Conversions' value={dashboard.stats.conversions} />
          <StatCard label='Conversion rate' value={`${dashboard.stats.conversionRate.toFixed(1)}%`} />
          <StatCard label='Total commission' value={formatRupees(dashboard.stats.totalCommission)} />
          <StatCard label='Pending' value={formatRupees(dashboard.stats.pendingCommission)} />
          <StatCard label='Approved' value={formatRupees(dashboard.stats.approvedCommission)} />
          <StatCard label='Paid out' value={formatRupees(dashboard.stats.paidCommission)} />
        </div>

        {/* Commissions */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Commission history</p>
          {commissionsQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : (commissionsQuery.data as any[])?.length > 0 ? (
            <ul className='mt-4 divide-y divide-border'>
              {(commissionsQuery.data as any[]).map((commission: any) => (
                <li key={commission.id} className='py-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
                  <div>
                    <p className='font-medium text-foreground'>{commission.paymentOrder.packageId}</p>
                    <p className='text-muted-foreground'>
                      {commission.status} · {formatDate(commission.createdAt)}
                    </p>
                    {commission.reversal && (
                      <p className='text-red-700'>Reversed · {commission.reversal.reason}</p>
                    )}
                  </div>
                  <div className='text-right'>
                    <p className='font-semibold text-foreground'>{formatRupees(commission.amountPaise)}</p>
                    <p className='text-[11px] text-muted-foreground'>
                      {commission.basisPoints / 100}% of order
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No commissions yet.</p>
          )}
        </div>

        {/* Payouts */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Payout history</p>
          {payoutsQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : (payoutsQuery.data as any[])?.length > 0 ? (
            <ul className='mt-4 divide-y divide-border'>
              {(payoutsQuery.data as any[]).map((payout: any) => (
                <li key={payout.id} className='py-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
                  <div>
                    <p className='font-medium text-foreground'>{payout.status}</p>
                    <p className='text-muted-foreground'>{payout.method || 'Manual'} · {formatDate(payout.createdAt)}</p>
                    {payout.reference && <p className='text-[11px] text-muted-foreground'>Ref: {payout.reference}</p>}
                  </div>
                  <div className='text-right'>
                    <p className='font-semibold text-foreground'>{formatRupees(payout.amountPaise)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No payouts yet.</p>
          )}
        </div>
      </section>
    </main>
  )
}

function PartnerAccessRequired() {
  const [claiming, setClaiming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function claim() {
    setClaiming(true)
    setMessage(null)
    try {
      const res = await fetch('/api/partner/claim', { method: 'POST' })
      if (res.ok) {
        window.location.reload()
        return
      }
      const body = await res.json().catch(() => null)
      setMessage(body?.error || 'Could not claim partner account.')
    } catch {
      setMessage('Network error. Please try again.')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <main className='min-h-screen bg-background flex items-center justify-center px-4'>
      <div className='max-w-md text-center space-y-4'>
        <h1 className='text-xl font-bold text-foreground'>Partner access required</h1>
        <p className='text-sm text-muted-foreground'>
          This account is not linked to a Formlee marketing partner. If an admin has already created a
          partner record for your email, you can claim it below.
        </p>
        <button
          type='button'
          onClick={claim}
          disabled={claiming}
          className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
        >
          {claiming ? 'Claiming…' : 'Claim partner account'}
        </button>
        {message && <p className='text-xs text-red-700'>{message}</p>}
        <div>
          <Link href='/' className='text-sm text-primary hover:underline'>
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className='rounded-xl border border-border bg-muted/20 p-4'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='text-xl font-bold text-foreground mt-1'>{value}</p>
    </div>
  )
}
