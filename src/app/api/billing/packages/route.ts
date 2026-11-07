import { NextResponse } from 'next/server'
import { CREDIT_PACKAGES } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    packages: CREDIT_PACKAGES.map(pkg => ({
      code: pkg.code,
      name: pkg.name,
      credits: pkg.credits,
      amountPaise: pkg.amountPaise,
      currency: 'INR',
      // Human-readable helpers for the UI; source of truth is paise.
      amountRupees: pkg.amountPaise / 100,
      perCreditPaise: Math.round(pkg.amountPaise / pkg.credits),
    })),
  })
}
