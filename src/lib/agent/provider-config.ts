export type AgentProvider = 'ollama' | 'openrouter'

export interface AgentProviderConfig {
  provider: AgentProvider
  model: string
  apiKey?: string
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function validateOpenRouterModel(model: string | undefined): string {
  const value = model?.trim() ?? ''
  if (!MODEL_ID_PATTERN.test(value) || value.toLowerCase() === 'openrouter/auto') {
    throw new Error('OPENROUTER_MODEL must be an explicit provider/model identifier.')
  }
  return value
}

export function resolveAgentProvider(env: NodeJS.ProcessEnv = process.env): AgentProviderConfig {
  const configured = env.AGENT_MODEL_PROVIDER?.trim().toLowerCase()
  const provider: AgentProvider = configured
    ? configured === 'openrouter' || configured === 'ollama' ? configured : (() => { throw new Error('AGENT_MODEL_PROVIDER must be openrouter or ollama.') })()
    : env.NODE_ENV === 'production' ? 'openrouter' : 'ollama'

  if (env.NODE_ENV === 'production' && provider !== 'openrouter') {
    throw new Error('Production requires AGENT_MODEL_PROVIDER=openrouter.')
  }

  if (provider === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY?.trim()
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required when the OpenRouter provider is selected.')
    const model = validateOpenRouterModel(env.OPENROUTER_MODEL)
    return { provider, model, apiKey }
  }

  return { provider, model: env.OLLAMA_MODEL?.trim() || 'qwen3.8-8k:latest' }
}
