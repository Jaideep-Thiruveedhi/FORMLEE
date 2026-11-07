export function logInternalApiError(scope: string, error: unknown) {
  const rawName = error instanceof Error ? error.name : ''
  const name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(rawName) ? rawName : 'UnknownError'
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  const code = /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined
  console.error(`[api] ${scope} failed`, { name, code })
  return { error: 'Internal server error.' }
}
