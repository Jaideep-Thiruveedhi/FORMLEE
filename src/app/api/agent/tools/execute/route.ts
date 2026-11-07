import { NextRequest, NextResponse } from 'next/server'
import { executeTool } from '@/lib/agent/tools/executor'

/**
 * Central execution gateway for agent tools.
 *
 * The model (local Ollama or future provider) proposes a tool call; the
 * extension posts it here. The server validates the call, resolves the agent
 * session, checks permissions, executes the handler, records an audit entry,
 * and returns a structured result. Browser-only tools return a browserAction
 * envelope that the extension must execute — the server never touches tabs or
 * DOM.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as unknown
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.', code: 'MALFORMED_REQUEST' }, { status: 400 })
  }
  const { tool, args, studentAction } = body as { tool?: unknown; args?: unknown; studentAction?: unknown }
  if (typeof tool !== 'string' || tool.length === 0) {
    return NextResponse.json({ error: 'Field "tool" is required and must be a string.', code: 'MALFORMED_TOOL' }, { status: 400 })
  }

  const result = await executeTool({
    request,
    toolName: tool,
    args: args ?? {},
    studentAction: studentAction === true,
  })
  const status = result.ok ? 200 : mapErrorCodeToStatus(result.code)
  return NextResponse.json(result, { status })
}

function mapErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case 'AGENT_SESSION_INVALID':
    case 'CREDIT_AUTH_REQUIRED':
      return 401
    case 'PERMISSION_DENIED':
    case 'CROSS_WORKSPACE':
    case 'FORBIDDEN':
      return 403
    case 'INSUFFICIENT_CREDITS':
      return 402
    case 'UNKNOWN_TOOL':
    case 'VALIDATION_ERROR':
    case 'MALFORMED_TOOL':
      return 400
    case 'NOT_FOUND':
    case 'APPROVAL_NOT_FOUND':
    case 'RESERVATION_NOT_FOUND':
      return 404
    case 'APPROVAL_EXPIRED':
    case 'APPROVAL_REVOKED':
    case 'APPROVAL_USED':
    case 'APPROVAL_INVALID':
    case 'APPROVAL_NOT_VERIFIED':
    case 'VERIFICATION_RECEIPT_REQUIRED':
    case 'PAGE_CHANGED':
    case 'MAPPING_CHANGED':
    case 'VALUES_CHANGED':
    case 'ADAPTER_MISMATCH':
    case 'SESSION_MISMATCH':
    case 'RESERVATION_NOT_PENDING':
    case 'STUDENT_ACTION_REQUIRED':
    case 'APPROVAL_CONTEXT_INVALID':
      return 409
    default:
      return 500
  }
}
