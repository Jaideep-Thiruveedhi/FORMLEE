import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveAgentSession } from '@/lib/agent/session'
import { withEvaluation } from '@/lib/apply-ai/applications'
import { loadWorkspaceVaultWithDimensions } from '@/lib/apply-ai/server-data'

/**
 * Redacted application readiness summary for the Formlee pet.
 *
 * Returns enough detail for the pet to explain what is missing, why it matters,
 * and which part of Formly to open next — without leaking document contents,
 * certificate numbers or field values.
 */
export async function GET(request: Request) {
  const session = await resolveAgentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Agent session missing or expired.', code: 'AGENT_SESSION_INVALID' },
      { status: 401 }
    )
  }

  const [rows, vault] = await Promise.all([
    prisma.examApplication.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: [{ updatedAt: 'desc' }],
    }),
    loadWorkspaceVaultWithDimensions(session.workspaceId),
  ])

  const applications = rows.map(row => withEvaluation(row, vault.profile, vault.documents, vault.documentDimensions))

  const summaries = applications.map(app => ({
    id: app.id,
    examId: app.examId,
    examName: app.examName,
    examIcon: app.examIcon,
    sessionLabel: app.sessionLabel,
    readinessState: app.evaluation.readinessState,
    progressPercent: app.evaluation.progressPercent,
    missingProfileLabels: app.evaluation.missingProfileLabels,
    missingDocumentLabels: app.evaluation.missingDocumentLabels,
    needsConfirmationLabels: app.evaluation.needsConfirmationLabels,
    awaitingResultsCount: app.evaluation.awaitingResultsCount,
    attentionRequiredCount: app.evaluation.attentionRequiredCount,
    documentIssues: app.evaluation.documentIssues.map(issue => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
    })),
    certificateIssues: app.evaluation.certificateIssues.map(issue => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
    })),
    consistencyIssues: app.evaluation.consistencyIssues.map(issue => ({
      field: issue.field,
      message: issue.message,
    })),
    snapshotStale: app.evaluation.snapshotStale,
    nextAction: app.evaluation.nextAction,
    officialWebsite: app.officialWebsite,
  }))

  return NextResponse.json({ ok: true, applications: summaries })
}
