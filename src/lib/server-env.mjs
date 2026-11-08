const REQUIRED_PRODUCTION_VARIABLES = [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'DOCUMENT_STORAGE_PROVIDER',
  'AGENT_MODEL_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
]

const OPENROUTER_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function parseUrl(name, value, allowedProtocols) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`)
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${allowedProtocols.join(' or ')}.`)
  }
  return parsed
}

function isLoopback(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function requireTlsDatabaseUrl(name, value) {
  const parsed = parseUrl(name, value, ['postgres:', 'postgresql:'])
  if (!parsed.hostname || isLoopback(parsed.hostname)) {
    throw new Error(`${name} must point to the configured remote production database, not a local development database.`)
  }
  const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase()
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode ?? '')) {
    throw new Error(`${name} must require TLS with sslmode=require, verify-ca, or verify-full.`)
  }
}

/** Validate production-only settings without printing values or connecting to services. */
export function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') return

  const missing = REQUIRED_PRODUCTION_VARIABLES.filter(name => !env[name]?.trim())
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`)
  }

  requireTlsDatabaseUrl('DATABASE_URL', env.DATABASE_URL)
  requireTlsDatabaseUrl('DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL)

  if ((env.BETTER_AUTH_SECRET ?? '').length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters in production.')
  }

  const authUrl = parseUrl('BETTER_AUTH_URL', env.BETTER_AUTH_URL, ['https:'])
  if (isLoopback(authUrl.hostname)) {
    throw new Error('BETTER_AUTH_URL must use the public HTTPS application origin in production.')
  }

  const storageProvider = env.DOCUMENT_STORAGE_PROVIDER.toLowerCase()
  if (!['local', 'r2'].includes(storageProvider)) {
    throw new Error('DOCUMENT_STORAGE_PROVIDER must be either local or r2.')
  }

  if (env.AGENT_MODEL_PROVIDER !== 'openrouter') {
    throw new Error('AGENT_MODEL_PROVIDER must be openrouter in production.')
  }
  if (!OPENROUTER_MODEL_PATTERN.test(env.OPENROUTER_MODEL.trim()) || env.OPENROUTER_MODEL.trim().toLowerCase() === 'openrouter/auto') {
    throw new Error('OPENROUTER_MODEL must be an explicit provider/model identifier in production.')
  }

  if (storageProvider === 'local' && !env.FORMLEE_STORAGE_DIR?.trim()) {
    throw new Error('FORMLEE_STORAGE_DIR must be explicitly set when production uses local document storage.')
  }

  if (storageProvider === 'r2') {
    const missingR2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
      .filter(name => !env[name]?.trim())
    if (missingR2.length) {
      throw new Error(`Missing required R2 environment variables: ${missingR2.join(', ')}`)
    }
    if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID.trim())) {
      throw new Error('R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.')
    }
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME.trim())) {
      throw new Error('R2_BUCKET_NAME must be a valid lowercase R2 bucket name.')
    }
  }

  const paymentVariables = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'NEXT_PUBLIC_RAZORPAY_KEY_ID']
  const configuredPayments = paymentVariables.filter(name => env[name]?.trim())
  if (configuredPayments.length > 0 && configuredPayments.length !== paymentVariables.length) {
    const missingPayments = paymentVariables.filter(name => !env[name]?.trim())
    throw new Error(`Razorpay configuration is incomplete. Set all payment variables or leave billing disabled: ${missingPayments.join(', ')}`)
  }
  if (configuredPayments.length === paymentVariables.length && env.NEXT_PUBLIC_RAZORPAY_KEY_ID !== env.RAZORPAY_KEY_ID) {
    throw new Error('NEXT_PUBLIC_RAZORPAY_KEY_ID must match the server-side RAZORPAY_KEY_ID.')
  }
}
