import { NextResponse } from 'next/server'
import { getStorageProviderId } from '@/lib/apply-ai/storage-provider'

export const dynamic = 'force-dynamic'

/**
 * Exposes the active storage provider so the client can choose the correct
 * upload workflow. No secrets are returned here.
 */
export async function GET() {
  return NextResponse.json({ provider: getStorageProviderId() })
}
