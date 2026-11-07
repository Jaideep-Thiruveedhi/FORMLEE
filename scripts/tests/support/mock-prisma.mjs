/** Database boundary for pure agent integration tests. */
export const prisma = new Proxy({}, {
  get(_target, operation) {
    return new Proxy(() => {
      throw new Error(`Unexpected database access in synthetic test: ${String(operation)}`)
    }, {
      get() {
        throw new Error(`Unexpected database access in synthetic test: ${String(operation)}`)
      },
    })
  },
})

export const Prisma = {
  JsonNull: null,
  DbNull: null,
}

export class PrismaClient {
  constructor() {
    return prisma
  }
}
