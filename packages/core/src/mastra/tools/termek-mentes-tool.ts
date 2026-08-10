import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  ProductInputSchema,
  CATEGORY,
  LOCATION,
  LIGHT,
  WATERING,
  DIFFICULTY,
} from './termek-mentes/product-schema.js';
import { upsertProduct } from './termek-mentes/db-readwrite.js';

// termek_mentes tool — az EGYETLEN írási út a katalógusba (NFR1 írás-oldala). A modell egy
// teljes termék-objektumot ad; mi a rendszer-határon szigorúan validálunk (Zod, product-schema.ts),
// majd latin név szerint upsertelünk paraméterezett SQL-lel, KÜLÖN read-write pool-on
// (db-readwrite.ts). Nyers write-SQL-t a modell nem futtathat — arra nincs tool.
//
// Az inputSchema megengedő (string + describe), a szigorú Zod az execute-ban fut: így hibás
// bemenetre a modell a saját magyar hibalistánkat kapja vissza, és egy körben tud javítani.

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  muvelet: z.enum(['created', 'updated']).nullable(),
  id: z.number().nullable(),
  latinNev: z.string().nullable(),
  uzenet: z.string(),
  hiba: z.string().nullable(),
});

const URES = { muvelet: null, id: null, latinNev: null, uzenet: '' };

export const termekMentesTool = createTool({
  id: 'termek_mentes',
  description:
    'Létrehoz vagy frissít EGY terméket a katalógusban, latin név szerint (case-insensitive). ' +
    'Teljes, sémára illesztett termék-objektumot vár (magyar name és description, HUF ár). ' +
    'Ha a latin név már létezik, FRISSÍTI; egyébként újat hoz létre. Használat előtt a ' +
    'katalogus_sql toollal ellenőrizd a jelenlegi állapotot, hogy tudd, mit írsz felül.',
  inputSchema: z.object({
    name: z.string().describe('MAGYAR termék-név.'),
    latinName: z.string().describe('Botanikai (latin) név — ez a termék kulcsa (dedup).'),
    category: z.string().describe(`Egy ezek közül: ${CATEGORY.join(' | ')}.`),
    location: z.string().describe(`Egy ezek közül: ${LOCATION.join(' | ')}.`),
    price: z.number().describe('Ár HUF-ban (> 0).'),
    salePrice: z
      .number()
      .nullable()
      .describe('Akciós ár HUF-ban, vagy null. Csak a price alatt lehet.'),
    stock: z.number().int().describe('Raktárkészlet (db), >= 0.'),
    light: z.string().describe(`Egy ezek közül: ${LIGHT.join(' | ')}.`),
    watering: z.string().describe(`Egy ezek közül: ${WATERING.join(' | ')}.`),
    difficulty: z.string().describe(`Egy ezek közül: ${DIFFICULTY.join(' | ')}.`),
    currentHeightCm: z.number().int().describe('Jelenlegi magasság cm.'),
    maxHeightCm: z.number().int().describe('Kifejlett magasság cm.'),
    currentPotCm: z.number().int().describe('Cserép átmérő cm.'),
    petSafe: z.boolean().describe('Háziállat-barát.'),
    kidSafe: z.boolean().describe('Gyerekbiztos.'),
    airPurifying: z.boolean().describe('Légtisztító.'),
    rating: z.number().describe('Értékelés 0–5. Frissen felvett terméknél 0.'),
    reviewsCount: z.number().int().describe('Értékelések száma. Frissen felvett terméknél 0.'),
    description: z.string().describe('MAGYAR leírás a termékről.'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra }) => {
    const logger = mastra?.getLogger();

    const ellenorzott = ProductInputSchema.safeParse(bemenet);
    if (!ellenorzott.success) {
      // Az ÖSSZES hibát egyben adjuk vissza, hogy a modell egy körben pótolja, ne pingpongozzon.
      const problemak = ellenorzott.error.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      logger?.warn('termek_mentes — érvénytelen termék, nem írtam DB-be', { problemak });
      return { sikeres: false, ...URES, hiba: `Érvénytelen termék — nem írtam DB-be: ${problemak}` };
    }

    try {
      const eredmeny = await upsertProduct(ellenorzott.data);
      const ige = eredmeny.action === 'created' ? 'létrehozva' : 'frissítve';
      logger?.info('termek_mentes — upsert kész', {
        muvelet: eredmeny.action,
        id: eredmeny.id,
        latinNev: eredmeny.latinName,
      });
      return {
        sikeres: true,
        muvelet: eredmeny.action,
        id: eredmeny.id,
        latinNev: eredmeny.latinName,
        uzenet: `"${ellenorzott.data.name}" (${eredmeny.latinName}) ${ige}. id=${eredmeny.id}`,
        hiba: null,
      };
    } catch (error: unknown) {
      const uzenet = error instanceof Error ? error.message : String(error);
      logger?.warn('termek_mentes — adatbázis-hiba', { uzenet });
      return { sikeres: false, ...URES, hiba: `Adatbázis-hiba az upsert során: ${uzenet}` };
    }
  },
});
