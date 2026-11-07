'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useAdminPartners,
  useAdminCommissions,
  useCreatePartner,
  useApproveCommission,
  useRejectCommission,
  useRecordPayout,
} from '@/lib/apply-ai/api-client'
import { authClient } from '@/lib/auth-client'

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

const TIER_OPTIONS = [
  { value: 'STUDENT_AMBASSADOR', label: 'Student Ambassador (5%)' },
  { value: 'CAMPUS_REPRESENTATIVE', label: 'Campus Representative (7.5%)' },
  { value: 'MARKETING_PARTNER', label: 'Marketing Partner (10%)' },
]

export default function AdminReferralsPage() {
  const { data: session } = authClient.useSession()
  const partnersQuery = useAdminPartners(true)
  const [commissionStatus, setCommissionStatus] = useState<string | null>('PENDING')
  const commissionsQuery = useAdminCommissions(commissionStatus, true)
  const createPartner = useCreatePartner()
  const approveCommission = useApproveCommission()
  const rejectCommission = useRejectCommission()
  const recordPayout = useRecordPayout()

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    tier: 'STUDENT_AMBASSADOR' as const,
    commissionBasisPoints: 500,
    holdingDays: 7,
    notes: '',
  })

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'ADMIN'

  const selectedCommissions = useMemo(() => {
    return (commissionsQuery.data as any[])?.filter((c: any) => c.status === 'APPROVED' && !c.payoutId) || []
  }, [commissionsQuery.data])

  if (!isAdmin) {
    return (
      <main className='min-h-screen bg-background flex items-center justify-center px-4'>
        <div className='max-w-md text-center space-y-3'>
          <h1 className='text-xl font-bold text-foreground'>Admin access required</h1>
          <p className='text-sm text-muted-foreground'>You do not have permission to manage referrals.</p>
          <Link href='/apply' className='text-sm text-primary hover:underline'>
            Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault()
    createPartner.mutate(form, {
      onSuccess: () => {
        setForm({ name: '', email: '', phone: '', tier: 'STUDENT_AMBASSADOR', commissionBasisPoints: 500, holdingDays: 7, notes: '' })
      },
    })
  }

  function handlePayout(partnerId: string) {
    const commissions = selectedCommissions.filter((c: any) => c.partnerId === partnerId)
    if (commissions.length === 0) return
    const total = commissions.reduce((sum: number, c: any) => sum + c.amountPaise, 0)
    recordPayout.mutate({
      partnerId,
      amountPaise: total,
      commissionIds: commissions.map((c: any) => c.id),
      method: 'manual',
    })
  }

  return (
    <main className='min-h-screen bg-background'>
      <header className='border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between'>
          <h1 className='font-semibold text-xl'>Referral Administration</h1>
          <Link href='/apply' className='text-sm text-muted-foreground hover:text-foreground'>
            Back to dashboard
          </Link>
        </div>
      </header>

      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10'>
        {/* Create partner */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Create partner</p>
          <form onSubmit={handleCreatePartner} className='mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <input
              required
              placeholder='Name'
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            />
            <input
              required
              type='email'
              placeholder='Email'
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            />
            <input
              placeholder='Phone'
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            />
            <select
              value={form.tier}
              onChange={e => {
                const tier = e.target.value as typeof form.tier
                const bp = tier === 'STUDENT_AMBASSADOR' ? 500 : tier === 'CAMPUS_REPRESENTATIVE' ? 750 : 1000
                setForm({ ...form, tier, commissionBasisPoints: bp })
              }}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            >
              {TIER_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type='number'
              placeholder='Holding days'
              value={form.holdingDays}
              onChange={e => setForm({ ...form, holdingDays: Number(e.target.value) })}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            />
            <input
              placeholder='Notes'
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className='px-3 py-2 rounded-lg border border-border bg-background text-sm'
            />
            <button
              type='submit'
              disabled={createPartner.isPending}
              className='px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50'
            >
              {createPartner.isPending ? 'Creating…' : 'Create partner'}
            </button>
          </form>
        </div>

        {/* Partners */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Partners</p>
          {partnersQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : (partnersQuery.data as any[])?.length > 0 ? (
            <div className='mt-4 overflow-x-auto'>
              <table className='w-full text-xs text-left'>
                <thead className='text-muted-foreground border-b border-border'>
                  <tr>
                    <th className='py-2 font-medium'>Name</th>
                    <th className='py-2 font-medium'>Email</th>
                    <th className='py-2 font-medium'>Tier</th>
                    <th className='py-2 font-medium'>Rate</th>
                    <th className='py-2 font-medium'>Clicks</th>
                    <th className='py-2 font-medium'>Regs</th>
                    <th className='py-2 font-medium'>Status</th>
                    <th className='py-2 font-medium'>Action</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {(partnersQuery.data as any[]).map((partner: any) => (
                    <tr key={partner.id}>
                      <td className='py-2'>{partner.name}</td>
                      <td className='py-2'>{partner.email}</td>
                      <td className='py-2'>{partner.tier.replace(/_/g, ' ')}</td>
                      <td className='py-2'>{partner.commissionBasisPoints / 100}%</td>
                      <td className='py-2'>{partner._count.clicks}</td>
                      <td className='py-2'>{partner._count.attributions}</td>
                      <td className='py-2'>{partner.isActive ? 'Active' : 'Inactive'}</td>
                      <td className='py-2 space-x-2'>
                        <button
                          type='button'
                          onClick={() => handlePayout(partner.id)}
                          disabled={selectedCommissions.filter((c: any) => c.partnerId === partner.id).length === 0}
                          className='text-primary hover:underline disabled:opacity-50'
                        >
                          Payout
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No partners yet.</p>
          )}
        </div>

        {/* Commissions */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p className='text-sm font-semibold text-foreground'>Commissions</p>
            <select
              value={commissionStatus ?? ''}
              onChange={e => setCommissionStatus(e.target.value || null)}
              className='px-3 py-1.5 rounded-lg border border-border bg-background text-xs'
            >
              <option value='PENDING'>Pending</option>
              <option value='APPROVED'>Approved</option>
              <option value='REJECTED'>Rejected</option>
              <option value='REVERSED'>Reversed</option>
              <option value=''>All</option>
            </select>
          </div>
          {commissionsQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : (commissionsQuery.data as any[])?.length > 0 ? (
            <div className='mt-4 overflow-x-auto'>
              <table className='w-full text-xs text-left'>
                <thead className='text-muted-foreground border-b border-border'>
                  <tr>
                    <th className='py-2 font-medium'>Partner</th>
                    <th className='py-2 font-medium'>Package</th>
                    <th className='py-2 font-medium'>Order amount</th>
                    <th className='py-2 font-medium'>Commission</th>
                    <th className='py-2 font-medium'>Status</th>
                    <th className='py-2 font-medium'>Date</th>
                    <th className='py-2 font-medium'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {(commissionsQuery.data as any[]).map((commission: any) => (
                    <tr key={commission.id}>
                      <td className='py-2'>{commission.partner.name}</td>
                      <td className='py-2'>{commission.paymentOrder.packageId}</td>
                      <td className='py-2'>{formatRupees(commission.paymentOrder.paidAmountPaise ?? 0)}</td>
                      <td className='py-2'>{formatRupees(commission.amountPaise)}</td>
                      <td className='py-2'>
                        {commission.status}
                        {commission.reversal ? ` (reversed)` : ''}
                      </td>
                      <td className='py-2'>{formatDate(commission.createdAt)}</td>
                      <td className='py-2 space-x-2'>
                        {commission.status === 'PENDING' && (
                          <>
                            <button
                              type='button'
                              onClick={() => approveCommission.mutate(commission.id)}
                              className='text-green-700 hover:underline'
                            >
                              Approve
                            </button>
                            <button
                              type='button'
                              onClick={() => rejectCommission.mutate(commission.id)}
                              className='text-red-700 hover:underline'
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No commissions found.</p>
          )}
        </div>
      </section>
    </main>
  )
}
