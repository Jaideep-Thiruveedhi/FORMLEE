'use client'

import { useEffect } from 'react'

export function ReferralTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('ref')
    if (!code) return

    // Report the click once per page load. The server sets an httpOnly cookie
    // that will be read when the user later registers.
    void fetch(`/api/referrals/click?code=${encodeURIComponent(code)}`, { method: 'GET' })
  }, [])

  return null
}
