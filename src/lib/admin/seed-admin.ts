import { prisma } from '@/lib/prisma'

/**
 * Promote a user to ADMIN by email. Run manually:
 *   npx tsx src/lib/admin/seed-admin.ts admin@example.com
 */
async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx src/lib/admin/seed-admin.ts <email>')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user) {
    console.error('User not found:', email)
    process.exit(1)
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
  console.log('Promoted to ADMIN:', email)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
