import { prisma } from '@/lib/prisma'
import { CREDIT_PACKAGES } from './credits'

/**
 * Seed the server-controlled credit packages. Safe to run multiple times:
 * existing packages are left unchanged, missing ones are created.
 *
 * Run manually after applying the credits migration:
 *   npx tsx src/lib/billing/seed.ts
 */
export async function seedCreditPackages() {
  for (const pkg of CREDIT_PACKAGES) {
    await prisma.creditPackage.upsert({
      where: { code: pkg.code },
      update: {},
      create: {
        code: pkg.code,
        name: pkg.name,
        credits: pkg.credits,
        amountPaise: pkg.amountPaise,
        currency: 'INR',
        isActive: true,
      },
    })
  }
}

if (require.main === module) {
  seedCreditPackages()
    .then(() => {
      console.log('Credit packages seeded.')
      process.exit(0)
    })
    .catch(error => {
      console.error(error)
      process.exit(1)
    })
}
