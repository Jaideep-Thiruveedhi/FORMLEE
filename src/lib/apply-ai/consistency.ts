import type { ConsistencyIssue, StudentProfileData } from './types'

/**
 * Detects differences between the canonical vault and an application's saved
 * snapshot or preferences. Formlee never silently rewrites either side; it
 * surfaces the mismatch and lets the student choose where to correct it.
 */

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.join(', ') || null
  return null
}

function compare(
  field: string,
  vaultValue: unknown,
  applicationValue: unknown,
  message: string
): ConsistencyIssue | null {
  const a = normalize(vaultValue)
  const b = normalize(applicationValue)
  if (a === null && b === null) return null
  if (a === b) return null
  return {
    field,
    vaultValue: a,
    applicationValue: b,
    message,
  }
}

export function checkProfileSnapshotConsistency(
  profile: StudentProfileData | null,
  snapshot: unknown
): ConsistencyIssue[] {
  if (!profile) return []
  const snap = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : null
  if (!snap) return []

  const values = snap.values && typeof snap.values === 'object' ? (snap.values as Record<string, unknown>) : snap

  const issues: ConsistencyIssue[] = []

  const push = (field: keyof StudentProfileData, label: string) => {
    const issue = compare(label, profile[field], values[field], `${label} differs from the vault snapshot used for this application.`)
    if (issue) issues.push(issue)
  }

  push('fullName', 'Full name')
  push('dateOfBirth', 'Date of birth')
  push('email', 'Email address')
  push('mobileNumber', 'Mobile number')
  push('class10PassingYear', 'Class 10 passing year')
  push('class12PassingYear', 'Class 12 passing year')
  push('category', 'Category')

  return issues
}

export function checkApplicationPreferenceConsistency(
  profile: StudentProfileData | null,
  preferences: Record<string, string>
): ConsistencyIssue[] {
  if (!profile) return []
  const issues: ConsistencyIssue[] = []

  if (preferences.category && preferences.category !== profile.category) {
    issues.push({
      field: 'category',
      vaultValue: profile.category,
      applicationValue: preferences.category,
      message: 'This application has a different category than your vault. Update the vault or keep this application-specific choice.',
    })
  }

  if (preferences.homeState && preferences.homeState !== profile.homeState) {
    issues.push({
      field: 'homeState',
      vaultValue: profile.homeState,
      applicationValue: preferences.homeState,
      message: 'This application has a different home state than your vault.',
    })
  }

  return issues
}
