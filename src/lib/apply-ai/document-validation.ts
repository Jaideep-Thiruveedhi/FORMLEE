import type { DocumentId, DocumentSpec, ReadinessIssue, UploadedDocumentDTO } from './types'

/**
 * Lightweight document validation for the readiness checker.
 *
 * Only checks specifications that Formly has verified from an official source.
 * Where no spec is configured, the document is accepted as "uploaded" and the
 * student is still told to verify it on the official portal.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

function mimeAllowed(mime: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true
  return allowed.includes(mime)
}

export function validateDocumentAgainstSpec(
  doc: UploadedDocumentDTO,
  spec?: DocumentSpec,
  dimensions?: { width: number; height: number } | null
): ReadinessIssue[] {
  if (!spec) return []
  const issues: ReadinessIssue[] = []

  if (spec.mimeTypes && spec.mimeTypes.length > 0 && !mimeAllowed(doc.mimeType, spec.mimeTypes)) {
    issues.push({
      severity: 'warning',
      code: 'DOC_WRONG_MIME',
      message: `This file is ${doc.mimeType}; the verified requirement is ${spec.mimeTypes.join(' or ')}.`,
      documentId: doc.documentType,
    })
  }

  if (typeof spec.minBytes === 'number' && doc.sizeBytes < spec.minBytes) {
    issues.push({
      severity: 'warning',
      code: 'DOC_TOO_SMALL',
      message: `File size (${formatBytes(doc.sizeBytes)}) is below the verified minimum ${formatBytes(spec.minBytes)}.`,
      documentId: doc.documentType,
    })
  }

  if (typeof spec.maxBytes === 'number' && doc.sizeBytes > spec.maxBytes) {
    issues.push({
      severity: 'warning',
      code: 'DOC_TOO_LARGE',
      message: `File size (${formatBytes(doc.sizeBytes)}) is above the verified maximum ${formatBytes(spec.maxBytes)}.`,
      documentId: doc.documentType,
    })
  }

  if (dimensions && (typeof spec.minWidth === 'number' || typeof spec.minHeight === 'number')) {
    if (typeof spec.minWidth === 'number' && dimensions.width < spec.minWidth) {
      issues.push({
        severity: 'warning',
        code: 'DOC_DIMENSION_WIDTH_LOW',
        message: `Width is ${dimensions.width}px; the verified minimum is ${spec.minWidth}px.`,
        documentId: doc.documentType,
      })
    }
    if (typeof spec.minHeight === 'number' && dimensions.height < spec.minHeight) {
      issues.push({
        severity: 'warning',
        code: 'DOC_DIMENSION_HEIGHT_LOW',
        message: `Height is ${dimensions.height}px; the verified minimum is ${spec.minHeight}px.`,
        documentId: doc.documentType,
      })
    }
    if (typeof spec.maxWidth === 'number' && dimensions.width > spec.maxWidth) {
      issues.push({
        severity: 'warning',
        code: 'DOC_DIMENSION_WIDTH_HIGH',
        message: `Width is ${dimensions.width}px; the verified maximum is ${spec.maxWidth}px.`,
        documentId: doc.documentType,
      })
    }
    if (typeof spec.maxHeight === 'number' && dimensions.height > spec.maxHeight) {
      issues.push({
        severity: 'warning',
        code: 'DOC_DIMENSION_HEIGHT_HIGH',
        message: `Height is ${dimensions.height}px; the verified maximum is ${spec.maxHeight}px.`,
        documentId: doc.documentType,
      })
    }
  }

  return issues
}

export function validateCertificateMetadata(
  doc: UploadedDocumentDTO,
  _profile: unknown
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  const cert = doc.certificate
  if (!cert) return issues

  if (cert.validUntil) {
    const validUntil = new Date(cert.validUntil)
    if (Number.isFinite(validUntil.getTime()) && validUntil < new Date()) {
      issues.push({
        severity: 'urgent',
        code: 'CERT_EXPIRED',
        message: `The certificate "${doc.originalName}" shows a validity date in the past (${cert.validUntil}). Upload a current certificate or confirm the date on the official portal.`,
        documentId: doc.documentType,
      })
    }
  }

  if (cert.issueDate) {
    const issueDate = new Date(cert.issueDate)
    if (Number.isFinite(issueDate.getTime()) && issueDate > new Date()) {
      issues.push({
        severity: 'warning',
        code: 'CERT_FUTURE_ISSUE',
        message: `The certificate "${doc.originalName}" shows an issue date in the future (${cert.issueDate}). Check the date you entered.`,
        documentId: doc.documentType,
      })
    }
  }

  if (doc.documentType === 'CATEGORY_CERTIFICATE' && !cert.certificateNumber) {
    issues.push({
      severity: 'info',
      code: 'CERT_NUMBER_MISSING',
      message: 'No certificate number is recorded. Some portals require it.',
      documentId: doc.documentType,
    })
  }

  return issues
}
