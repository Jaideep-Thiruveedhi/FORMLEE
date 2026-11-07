import { NextResponse } from 'next/server'

/**
 * Direct object-store uploads were intentionally replaced with the bounded,
 * server-mediated multipart endpoint so the server can validate file bytes
 * and no reusable upload bearer URL reaches the browser.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Direct uploads are not supported. Upload through /api/apply/documents.' },
    { status: 410 }
  )
}
