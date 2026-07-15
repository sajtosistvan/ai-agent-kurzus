import { PrismaClient } from '@plantbase/db';

// prisma-client.ts — EGY közös Prisma-kliens a tool-rétegnek (queryCustomers és a későbbi
// csomag-toolok). A runSql tudatosan NEM ezt használja: az a nyers, READ-ONLY pg-úton fut
// (három védelmi réteg) — a Prisma a "rendes" adatelérés, ahol nem az SQL a tananyag.
// Lazy: csak az első használatkor jön létre, és hiányzó DATABASE_URL-nél magyarul hal meg.

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (client === null) {
    if (!process.env['DATABASE_URL']) {
      throw new Error('Hiányzó DATABASE_URL — a Prisma-alapú toolokhoz kötelező.');
    }
    client = new PrismaClient();
  }
  return client;
}

/** Tiszta leálláshoz (CLI/szerver shutdown). Ha nem jött létre kliens, nem csinál semmit. */
export async function closePrisma(): Promise<void> {
  if (client !== null) {
    await client.$disconnect();
    client = null;
  }
}
