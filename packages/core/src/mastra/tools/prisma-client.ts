import { createRequire } from 'node:module';
import type { PrismaClient } from '@plantbase/db';

// prisma-client.ts — EGY közös Prisma-kliens a tool-rétegnek (ügyfél-lekérdezés, csomag-toolok).
// A katalógus-SQL tool tudatosan NEM ezt használja: az a nyers, READ-ONLY pg-úton fut
// (három védelmi réteg) — a Prisma a „rendes" adatelérés, ahol nem az SQL a tananyag.
// Lazy: csak az első használatkor jön létre, és hiányzó DATABASE_URL-nél magyarul hal meg.
//
// MIÉRT `createRequire` ÉS NEM `import { PrismaClient }`: a Prisma GENERÁLT kliense CommonJS.
// A Mastra CLI (`pnpm mastra:dev`) Rollup-pal bundle-öli ezt a mappát, és a nevesített importot
// nem tudja kiolvasni a CJS-modulból („PrismaClient is not exported by …/generated/client").
// A típus-import erre nem hat (fordításkor eltűnik), a futásidejű betöltés pedig a Node
// require-jén megy — ugyanaz a példány, csak a bundler nem akad el rajta.

const requireCjs = createRequire(import.meta.url);

type PrismaModule = { PrismaClient: new () => PrismaClient };

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (client === null) {
    if (!process.env['DATABASE_URL']) {
      throw new Error('Hiányzó DATABASE_URL — a Prisma-alapú toolokhoz kötelező.');
    }
    const { PrismaClient } = requireCjs('@plantbase/db') as PrismaModule;
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
