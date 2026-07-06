import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from './tool-outcome.js';
import {
  ProductInputSchema,
  CATEGORY,
  LOCATION,
  LIGHT,
  WATERING,
  DIFFICULTY,
} from './product-schema.js';
import { upsertProduct } from './db-readwrite.js';

// upsertProduct tool — az INGEST-agent EGYETLEN írási útja a katalógusba. A modell egy teljes,
// sémára illesztett termék-objektumot ad; mi a rendszer-határon szigorúan validálunk (Zod,
// product-schema.ts), majd latin név szerint upsertelünk (paraméterezett SQL, db-readwrite.ts).
// Soha nem dob: a hibát is a modellnek visszaadható magyar szövegként adja vissza, így az
// agent tud belőle javítani. Nyers write-SQL NINCS — ez a read/write szétválasztás tool-oldala.

/** validál → upsert → szövegesített kimenet. Soha nem dob. */
export async function executeUpsertProduct(
  rawInput: unknown,
): Promise<ToolOutcome> {
  const parsed = ProductInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Az ÖSSZES hibát egyben adjuk vissza, hogy a modell egy körben pótolja, ne pingpongozzon.
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    return {
      content: `Érvénytelen termék — nem írtam DB-be: ${issues}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }

  try {
    const result = await upsertProduct(parsed.data);
    const verb = result.action === 'created' ? 'létrehozva' : 'frissítve';
    return {
      content: JSON.stringify({
        ok: true,
        action: result.action,
        id: result.id,
        latinName: result.latinName,
        message: `"${parsed.data.name}" (${result.latinName}) ${verb}. id=${result.id}`,
      }),
      isError: false,
      summary: `UPSERT products (${result.action}) · ${result.latinName}`,
      rowCount: 1,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Adatbázis-hiba az upsert során: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

/** A modell-felé eső tool-definíció: leíró, de megengedő termék-alak (a szigorú Zod az
 *  executeUpsertProduct-ban fut, hogy hibára a saját magyar üzenetünk menjen vissza). */
export const upsertProductTool = (report?: ToolReporter) =>
  tool({
    description:
      'Létrehoz vagy frissít EGY terméket a katalógusban, latin név szerint (case-insensitive). ' +
      'Teljes, sémára illesztett termék-objektumot vár (magyar name és description, HUF ár). ' +
      'Ha a latin név már létezik, FRISSÍTI; egyébként újat hoz létre. Használat előtt runSql-lel ' +
      'ellenőrizd a jelenlegi állapotot, hogy tudd, mit írsz felül.',
    inputSchema: z.object({
      name: z.string().describe('MAGYAR termék-név.'),
      latinName: z
        .string()
        .describe('Botanikai (latin) név — ez a termék kulcsa (dedup).'),
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
      difficulty: z
        .string()
        .describe(`Egy ezek közül: ${DIFFICULTY.join(' | ')}.`),
      currentHeightCm: z.number().int().describe('Jelenlegi magasság cm.'),
      maxHeightCm: z.number().int().describe('Kifejlett magasság cm.'),
      currentPotCm: z.number().int().describe('Cserép átmérő cm.'),
      petSafe: z.boolean().describe('Háziállat-barát.'),
      kidSafe: z.boolean().describe('Gyerekbiztos.'),
      airPurifying: z.boolean().describe('Légtisztító.'),
      rating: z.number().describe('Értékelés 0–5. Frissen felvett terméknél 0.'),
      reviewsCount: z
        .number()
        .int()
        .describe('Értékelések száma. Frissen felvett terméknél 0.'),
      description: z.string().describe('MAGYAR leírás a termékről.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeUpsertProduct(input);
      report?.(toolCallId, 'upsertProduct', input, outcome);
      return outcome.content;
    },
  });
