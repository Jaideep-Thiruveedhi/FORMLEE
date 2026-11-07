/** Parse the bounded task-creation fallback when a model emits JSON as text. */
export function parseTaskAction(text: string): { objective?: string; applicationId?: string } | null {
  const match = /\{\s*"action"\s*:\s*"CREATE_TASK"[^}]*\}/.exec(text)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    if (typeof parsed.objective === 'string') {
      return {
        objective: parsed.objective,
        applicationId: typeof parsed.applicationId === 'string' ? parsed.applicationId : undefined,
      }
    }
  } catch {
    // Ignore malformed inline JSON.
  }
  return null
}
