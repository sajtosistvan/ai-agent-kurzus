// Plantbase — Prisma seed script (előre kész, nem kell élőben generálni).
// Futtatás: `pnpm prisma db seed`  (vagy közvetlenül: `pnpm tsx seed.ts`)
//
// Feltételezés: van egy `products` tábla, Prisma `Product` modellként, és a mezőnevek
// megegyeznek a `plants.ts`-ben használtakkal (snake_case). Ha a Prisma modellben más a
// névadás, csak igazítsd a `createMany` hívást, vagy a séma @map-jeit.

import { PrismaClient } from '@prisma/client'
import { plants } from './plants'

const prisma = new PrismaClient()

async function main() {
  await prisma.product.deleteMany() // idempotens újraseedeléshez
  const result = await prisma.product.createMany({ data: plants })
  console.log(`Seed kész: ${result.count} növény betöltve.`)
}

main()
  .catch((e) => {
    console.error('Seed hiba:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
