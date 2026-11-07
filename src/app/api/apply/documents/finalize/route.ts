import { NextResponse } from 'next/server'

/**
 * Retained as a clear compatibility response for clients from the earlier
 * direct-upload flow. Uploads now complete in one authenticated multipart
 * request to /api/apply/documents.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Upload finalization is no longer used. Upload through /api/apply/documents.' },
    { status: 410 }
  )
}
