// Plantbase — Prisma seed script (az előre kész seed/-ből átemelve).
// Futtatás: `pnpm db:seed` (a root prisma.seed: `tsx packages/db/prisma/seed.ts`).
//
// A plants.ts adat snake_case kulcsú (a DB-oszlopok szerint), a Prisma modell mezői viszont
// camelCase-ek (@map). Ezért a createMany előtt a kész adatot a Prisma input alakjára képezzük
// — az adatot NEM változtatjuk, csak a kulcsneveket igazítjuk (lásd seed/README.md).

import { PrismaClient, type Prisma } from '../generated/client/index.js';
import { plants, type PlantSeed } from './plants';

const prisma = new PrismaClient();

function toProductInput(p: PlantSeed): Prisma.ProductCreateManyInput {
  return {
    name: p.name,
    latinName: p.latin_name,
    category: p.category,
    location: p.location,
    price: p.price,
    salePrice: p.sale_price,
    stock: p.stock,
    light: p.light,
    watering: p.watering,
    difficulty: p.difficulty,
    currentHeightCm: p.current_height_cm,
    maxHeightCm: p.max_height_cm,
    currentPotCm: p.current_pot_cm,
    petSafe: p.pet_safe,
    kidSafe: p.kid_safe,
    airPurifying: p.air_purifying,
    rating: p.rating,
    reviewsCount: p.reviews_count,
    description: p.description,
  };
}

async function main() {
  await prisma.product.deleteMany(); // idempotens újraseedeléshez
  const result = await prisma.product.createMany({
    data: plants.map(toProductInput),
  });
  console.log(`Seed kész: ${result.count} növény betöltve.`);
}

main()
  .catch((e) => {
    console.error('Seed hiba:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
