/** Provider boundary for tests: no network or real model calls are allowed. */
export async function callAgentModel() {
  if (globalThis.__FORMLEE_MOCK_AGENT_RESPONSE__) {
    return globalThis.__FORMLEE_MOCK_AGENT_RESPONSE__
  }
  return {
    ok: false,
    text: null,
    toolCalls: [],
    nativeToolSupport: false,
    error: 'Synthetic model provider unavailable.',
  }
}
