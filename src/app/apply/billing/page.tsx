'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useCreditAccount,
  useCreditPackages,
  useCreditTransactions,
  useCreatePaymentOrder,
  useEnsureWorkspace,
  usePaymentOrders,
  useVerifyPayment,
  type CreditPackageDTO,
  type PaymentOrderDTO,
} from '@/lib/apply-ai/api-client'
import { ApplyHeader } from '@/components/apply/apply-header'

function formatRupees(paise: number): string {
  return '₹' + (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type CheckoutStatus =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'ready'; order: PaymentOrderDTO; package: CreditPackageDTO }
  | { kind: 'processing' }
  | { kind: 'success'; order: PaymentOrderDTO }
  | { kind: 'error'; message: string }

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  handler: (response: RazorpayResponse) => void
  modal: {
    ondismiss: () => void
    escape: boolean
    animation: boolean
  }
  prefill?: {
    name?: string
    email?: string
    contact?: string
  }
  theme?: {
    color?: string
  }
}

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open: () => void
  on: (event: string, handler: () => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(false)
    if (window.Razorpay) return resolve(true)
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(!!window.Razorpay))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT
    script.async = true
    script.onload = () => resolve(!!window.Razorpay)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function BillingPage() {
  const { ready: workspaceReady } = useEnsureWorkspace()
  const accountQuery = useCreditAccount(workspaceReady)
  const packagesQuery = useCreditPackages()
  const transactionsQuery = useCreditTransactions(workspaceReady)
  const ordersQuery = usePaymentOrders(workspaceReady)
  const createOrder = useCreatePaymentOrder()
  const verifyPayment = useVerifyPayment()

  const [checkout, setCheckout] = useState<CheckoutStatus>({ kind: 'idle' })
  const [scriptReady, setScriptReady] = useState(false)
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null)

  const paymentConfigured = serverConfigured ?? !!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID

  useEffect(() => {
    if (paymentConfigured) {
      loadRazorpayScript().then(setScriptReady)
    }
  }, [paymentConfigured])

  const selectedPackage = useMemo(() => {
    if (checkout.kind !== 'ready' && checkout.kind !== 'creating' && checkout.kind !== 'processing') return null
    return packagesQuery.data?.find(p => p.code === (checkout as { order?: PaymentOrderDTO }).order?.packageCode) ?? null
  }, [checkout, packagesQuery.data])

  async function startCheckout(pkg: CreditPackageDTO) {
    if (!scriptReady || !window.Razorpay) {
      setCheckout({ kind: 'error', message: 'Razorpay checkout is not ready. Please try again.' })
      return
    }
    setCheckout({ kind: 'creating' })
    try {
      const { order, keyId, configured } = await createOrder.mutateAsync(pkg.code)
      setServerConfigured(configured)
      if (!configured || !keyId) {
        setCheckout({ kind: 'error', message: 'Payment gateway is not configured.' })
        return
      }

      setCheckout({ kind: 'ready', order, package: pkg })

      const razorpay = new window.Razorpay({
        key: keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Formlee AI',
        description: `${pkg.credits} application credit${pkg.credits === 1 ? '' : 's'}`,
        order_id: order.providerOrderId!,
        handler: response => {
          setCheckout({ kind: 'processing' })
          verifyPayment
            .mutateAsync({
              internalOrderId: order.id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            })
            .then(verifiedOrder => {
              setCheckout({ kind: 'success', order: verifiedOrder })
            })
            .catch(error => {
              setCheckout({
                kind: 'error',
                message: error instanceof Error ? error.message : 'Payment verification failed.',
              })
            })
        },
        modal: {
          ondismiss: () => {
            // If the user closes the modal before a successful payment, keep
            // the order in CREATED state so they can retry.
            if (checkout.kind === 'ready' || checkout.kind === 'processing') {
              setCheckout({ kind: 'idle' })
            }
          },
          escape: true,
          animation: true,
        },
        theme: {
          color: '#0f172a',
        },
      })

      razorpay.on('payment.failed', () => {
        setCheckout({ kind: 'error', message: 'Payment failed. You can try again.' })
      })

      razorpay.open()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start checkout.'
      setCheckout({ kind: 'error', message })
    }
  }

  return (
    <main className='min-h-screen bg-background'>
      <ApplyHeader active='billing' />

      <section className='max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold text-foreground'>Credits & Billing</h1>
            <p className='text-sm text-muted-foreground mt-1'>
              One application credit = assistance with one examination application.
            </p>
          </div>
          <Link
            href='/apply'
            className='px-4 py-2 text-xs font-semibold text-foreground bg-background border border-border rounded-lg hover:bg-muted/40 transition-colors'
          >
            Back to dashboard
          </Link>
        </div>

        {/* Status banner */}
        {checkout.kind === 'success' && (
          <div className='rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-green-900 text-xs'>
            <p className='font-semibold'>Payment successful!</p>
            <p className='mt-0.5'>
              {checkout.order.credits} credit{checkout.order.credits === 1 ? '' : 's'} have been added to your wallet.
            </p>
          </div>
        )}
        {checkout.kind === 'error' && (
          <div className='rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 text-xs'>
            <p className='font-semibold'>Payment issue</p>
            <p className='mt-0.5'>{checkout.message}</p>
          </div>
        )}
        {checkout.kind === 'creating' && (
          <div className='rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900 text-xs'>
            Creating secure payment order…
          </div>
        )}
        {checkout.kind === 'processing' && (
          <div className='rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900 text-xs'>
            Verifying payment with the gateway…
          </div>
        )}

        {/* Balance card */}
        <div className='grid gap-4 md:grid-cols-3'>
          <div className='md:col-span-2 rounded-2xl border border-border bg-background p-5'>
            <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Available credits</p>
            <p className='text-5xl font-bold text-foreground mt-2'>
              {accountQuery.isLoading ? '…' : accountQuery.data?.balance ?? 0}
            </p>
            <p className='text-sm text-muted-foreground mt-2'>
              {accountQuery.data && accountQuery.data.activeReservations > 0
                ? `${accountQuery.data.activeReservations} reserved for an in-progress fill`
                : 'No active reservations'}
            </p>
            <div className='mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground'>
              <span>Earned: {accountQuery.data?.totalEarned ?? 0}</span>
              <span>Spent: {accountQuery.data?.totalSpent ?? 0}</span>
            </div>
          </div>

          <div className='rounded-2xl border border-border bg-muted/20 p-5'>
            <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>How credits work</p>
            <ul className='mt-3 space-y-2 text-xs text-muted-foreground'>
              <li>• Scanning and preview are free.</li>
              <li>• One credit is reserved when you approve a fill.</li>
              <li>• The credit is consumed only after a field is verified filled.</li>
              <li>• Unused reservations are released automatically.</li>
            </ul>
          </div>
        </div>

        {/* Packages */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Buy application credits</p>

          {!paymentConfigured && (
            <div className='mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-xs'>
              <p className='font-semibold'>Payments are not configured yet.</p>
              <p className='mt-0.5'>
                Razorpay has not been configured for this environment. Ask the administrator to set
                NEXT_PUBLIC_RAZORPAY_KEY_ID and the server-side Razorpay credentials.
              </p>
            </div>
          )}

          <div className='mt-4 grid gap-4 sm:grid-cols-3'>
            {packagesQuery.data?.map(pkg => (
              <div
                key={pkg.code}
                className='rounded-xl border border-border bg-muted/20 p-4 flex flex-col'
              >
                <div className='flex-1'>
                  <p className='text-base font-bold text-foreground'>{pkg.name}</p>
                  <p className='text-2xl font-bold text-primary mt-1'>
                    {pkg.credits} credit{pkg.credits === 1 ? '' : 's'}
                  </p>
                  <p className='text-sm text-muted-foreground mt-1'>{formatRupees(pkg.amountPaise)}</p>
                  <p className='text-[11px] text-muted-foreground mt-1'>
                    {formatRupees(pkg.perCreditPaise)} per credit
                  </p>
                </div>
                <button
                  type='button'
                  disabled={!paymentConfigured || createOrder.isPending || checkout.kind === 'creating'}
                  onClick={() => startCheckout(pkg)}
                  className='mt-4 w-full px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                >
                  {createOrder.isPending || checkout.kind === 'creating'
                    ? 'Preparing checkout…'
                    : 'Buy now'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Transactions */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Transaction history</p>
          {transactionsQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : transactionsQuery.data && transactionsQuery.data.length > 0 ? (
            <ul className='mt-4 divide-y divide-border'>
              {transactionsQuery.data.map((entry: any) => (
                <li key={entry.id} className='py-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
                  <div>
                    <p className='font-medium text-foreground'>{entry.type}</p>
                    <p className='text-muted-foreground'>{entry.description || '—'}</p>
                    <p className='text-[11px] text-muted-foreground'>{formatDate(entry.createdAt)}</p>
                  </div>
                  <div className='text-right'>
                    <p className={`font-semibold ${entry.amount >= 0 ? 'text-green-700' : 'text-foreground'}`}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount} credit{Math.abs(entry.amount) === 1 ? '' : 's'}
                    </p>
                    <p className='text-[11px] text-muted-foreground'>balance {entry.balanceAfter}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No transactions yet.</p>
          )}
        </div>

        {/* Orders */}
        <div className='rounded-2xl border border-border bg-background p-5'>
          <p className='text-sm font-semibold text-foreground'>Payment orders</p>
          {ordersQuery.isLoading ? (
            <p className='mt-4 text-xs text-muted-foreground'>Loading…</p>
          ) : ordersQuery.data && ordersQuery.data.length > 0 ? (
            <ul className='mt-4 divide-y divide-border'>
              {ordersQuery.data.map((order: PaymentOrderDTO) => (
                <li key={order.id} className='py-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
                  <div>
                    <p className='font-medium text-foreground'>
                      {order.packageCode} · {order.credits} credits
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      {order.provider} · {order.status}
                      {order.providerPaymentId ? ` · ${order.providerPaymentId}` : ''}
                    </p>
                    {order.paidAt && (
                      <p className='text-[11px] text-muted-foreground'>Paid {formatDate(order.paidAt)}</p>
                    )}
                  </div>
                  <div className='text-right'>
                    <p className='font-semibold text-foreground'>{formatRupees(order.amountPaise)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className='mt-4 text-xs text-muted-foreground'>No payment orders yet.</p>
          )}
        </div>
      </section>
    </main>
  )
}
