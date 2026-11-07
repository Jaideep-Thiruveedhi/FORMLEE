import type { auth } from '@/lib/auth'

declare module 'better-auth' {
  interface SessionUser {
    role?: string
  }
}

export {}
