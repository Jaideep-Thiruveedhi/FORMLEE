import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'

// Milestone 3 — core authentication only.
//  - Email/password (no OAuth, no 2FA, no email delivery plugins this milestone).
//  - Secret/base URL are read from BETTER_AUTH_SECRET / BETTER_AUTH_URL in .env
//    (never hardcoded, never committed).
//  - The adapter reuses the existing Prisma client; the generated models live in
//    prisma/schema.prisma and were added by `@better-auth/cli generate`.
function createAuth() {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL: process.env.BETTER_AUTH_URL!,
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'USER',
          required: false,
        },
      },
    },
  })
}

let authInstance: ReturnType<typeof createAuth> | undefined

export function getAuth(): ReturnType<typeof createAuth> {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters in production.')
    }
    if (!process.env.BETTER_AUTH_URL?.startsWith('https://')) {
      throw new Error('BETTER_AUTH_URL must be configured as a public HTTPS origin in production.')
    }
  }

  if (!authInstance) authInstance = createAuth()
  return authInstance
}

export async function handleAuthRequest(request: Request) {
  return getAuth().handler(request)
}
