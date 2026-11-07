import { NextRequest, NextResponse } from 'next/server'
import { agentMapRequestSchema, buildAgentFillPlan, persistAgentPlan } from '@/lib/agent/mapper'
import { classifyUrl } from '@/lib/agent/registry'
import { isSanitizedPageUrl } from '@/lib/agent/jee-main'
import { resolveAgentSession } from '@/lib/agent/session'
import { collectWorkspaceSensitiveValues } from '@/lib/agent/privacy'

/**
 * Extension detection → redacted fill plan. Requires a valid agent session;
 * field VALUES are never accepted here and never returned here — only field
 * descriptors (labels/options/groups) come in and mapping decisions go out.
 *
 * Page context is optional for backwards compatibility with the generic
 * local demo, but when present it must be an approved origin. The central
 * adapter registry restricts each examination to its exact origin + path
 * prefix, and only documented Personal Details / Qualification Details pages
 * may be mapped.
 */
export async function POST(request: NextRequest) {
  const session = await resolveAgentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Agent session missing or expired — reconnect the extension.', code: 'AGENT_SESSION_INVALID' },
      { status: 401 }
    )
  }

  const body = (await request.json().catch(() => null)) as unknown
  const parsed = agentMapRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Detection payload is malformed.', code: 'MALFORMED_DETECTION' },
      { status: 400 }
    )
  }

  const page = parsed.data.page
  if (page) {
    if (!isSanitizedPageUrl(page.url)) {
      return NextResponse.json(
        {
          error: 'Page context must contain only the origin and pathname — query strings and fragments are not accepted.',
          code: 'UNSANITIZED_PAGE_URL',
        },
        { status: 400 }
      )
    }

    const registryResult = classifyUrl(page.url)
    const adapter = registryResult.adapter
    if (!adapter) {
      const adapterNames = ['JEE Main 2027', 'VITEEE 2027'].join(', ')
      return NextResponse.json(
        {
          error:
            'The Apply Agent only runs on Formly demo pages and supported examination portals (' + adapterNames + ').',
          code: 'UNSUPPORTED_ORIGIN',
        },
        { status: 422 }
      )
    }

    if (!adapter.isSupportedPageKind(page.kind)) {
      return NextResponse.json(
        {
          error: adapter.pageNotice(page.kind),
          code: 'UNSUPPORTED_PAGE',
        },
        { status: 422 }
      )
    }
  }

  const plan = await buildAgentFillPlan(parsed.data.fields, {
    page,
    sensitiveValues: await collectWorkspaceSensitiveValues(session.workspaceId),
  })
  await persistAgentPlan(session.workspaceId, plan)

  return NextResponse.json({ plan })
}
