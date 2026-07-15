// Plantbase — Prisma seed script (az előre kész seed/-ből átemelve).
// Futtatás: `pnpm db:seed` (a root prisma.seed: `tsx packages/db/prisma/seed.ts`).
//
// A plants.ts adat snake_case kulcsú (a DB-oszlopok szerint), a Prisma modell mezői viszont
// camelCase-ek (@map). Ezért a createMany előtt a kész adatot a Prisma input alakjára képezzük
// — az adatot NEM változtatjuk, csak a kulcsneveket igazítjuk (lásd seed/README.md).

import { PrismaClient, type Prisma } from '../generated/client/index.js';
import { plants, type PlantSeed } from './plants';
import { customers, type CustomerSeed } from './customers';

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

function toCustomerInput(c: CustomerSeed): Prisma.CustomerCreateInput {
  return {
    code: c.code,
    name: c.name,
    contactName: c.contact_name,
    email: c.email,
    city: c.city,
    customerType: c.customer_type,
    budget: c.budget,
    expertiseLevel: c.expertise_level,
    petSafeRequired: c.pet_safe_required,
    kidSafeRequired: c.kid_safe_required,
    notes: c.notes,
  };
}

async function main() {
  // A mentett csomagok FK-val hivatkoznak a termékekre (package_items.product_id) —
  // előbb azokat töröljük, különben a product.deleteMany FK-hibára fut.
  await prisma.packageItem.deleteMany();
  await prisma.package.deleteMany();
  await prisma.product.deleteMany(); // idempotens újraseedeléshez
  const result = await prisma.product.createMany({
    data: plants.map(toProductInput),
  });
  console.log(`Seed kész: ${result.count} növény betöltve.`);

  // Ügyfelek: upsert code szerint — deleteMany helyett, mert a threads FK-val hivatkozik rájuk.
  for (const c of customers) {
    await prisma.customer.upsert({
      where: { code: c.code },
      create: toCustomerInput(c),
      update: toCustomerInput(c),
    });
  }
  console.log(`Seed kész: ${customers.length} ügyfél betöltve.`);
}

main()
  .catch((e) => {
    console.error('Seed hiba:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
