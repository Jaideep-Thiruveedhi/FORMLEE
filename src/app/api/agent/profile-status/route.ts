import { NextResponse } from 'next/server'
import { resolveAgentSession } from '@/lib/agent/session'
import { loadWorkspaceVault } from '@/lib/apply-ai/server-data'
import { evaluateProfile } from '@/lib/apply-ai/requirements'

/**
 * Redacted profile status for the floating assistant panel.
 *
 * Returns section-level completion, counts and missing/confirmation labels
 * only. No field values, documents or certificate contents are sent, so the
 * pet can show actionable guidance without exposing the student's data.
 */
export async function GET(request: Request) {
  const session = await resolveAgentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Agent session missing or expired.', code: 'AGENT_SESSION_INVALID' },
      { status: 401 }
    )
  }

  const { profile, documents } = await loadWorkspaceVault(session.workspaceId)
  const evaluation = evaluateProfile(profile)

  return NextResponse.json({
    ok: true,
    evaluation: {
      status: evaluation.status,
      completedSections: evaluation.completedSections,
      totalSections: evaluation.totalSections,
      hasAwaitingResults: evaluation.hasAwaitingResults,
      hasNeedsConfirmation: evaluation.hasNeedsConfirmation,
      missingLabels: evaluation.missingLabels,
      needsConfirmationLabels: evaluation.needsConfirmationLabels,
      awaitingResultsLabels: evaluation.awaitingResultsLabels,
      sections: evaluation.sections.map(section => ({
        sectionId: section.sectionId,
        state: section.state,
        missingLabels: section.missingLabels,
        note: section.note,
      })),
      documentsUploaded: documents.length,
    },
  })
}
