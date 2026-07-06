import { ProductInputSchema } from './product-schema.js';
import { upsertProduct } from './db-readwrite.js';
import type { RunSqlOutcome } from './run-sql.js';

// Az upsertProduct tool: az ingest-agent EGYETLEN írási útja a katalógusba. A modell egy teljes,
// sémára illesztett termék-objektumot ad; mi a rendszer-határon szigorúan validálunk (Zod), majd
// latin név szerint upsertelünk (paraméterezett SQL). Soha nem dob: a hibát is a modellnek
// visszaadható magyar szövegként adja vissza (mint a runSql), így az agent tud belőle javítani.

export const UPSERT_PRODUCT_TOOL_NAME = 'upsertProduct';

export const UPSERT_PRODUCT_DESCRIPTION =
  'Létrehoz vagy frissít EGY terméket a katalógusban, latin név szerint (case-insensitive). ' +
  'Teljes, sémára illesztett termék-objektumot vár (magyar name és description, HUF ár). ' +
  'Ha a latin név már létezik, FRISSÍTI; egyébként újat hoz létre. Használat előtt runSql-lel ' +
  'ellenőrizd a jelenlegi állapotot, hogy tudd, mit írsz felül.';

/** validál → upsert → szövegesített kimenet. A RunSqlOutcome alakot használja, hogy a Trace/loop
 *  plumbing (agent) változatlanul kezelje az eredményt. */
export async function executeUpsertProduct(rawInput: unknown): Promise<RunSqlOutcome> {
  const parsed = ProductInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    return {
      content: `Érvénytelen termék — nem írtam DB-be: ${issues}`,
      isError: true,
      executedSql: null,
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
      executedSql: `UPSERT products (${result.action})`,
      rowCount: 1,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Adatbázis-hiba az upsert során: ${message}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
}
