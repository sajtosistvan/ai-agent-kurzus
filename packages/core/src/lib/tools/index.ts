import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  RUN_SQL_TOOL_NAME,
  RUN_SQL_DESCRIPTION,
  executeRunSql,
  type RunSqlOutcome,
} from './run-sql.js';
import {
  GET_CLIENT_PREFERENCES_TOOL_NAME,
  GET_CLIENT_PREFERENCES_DESCRIPTION,
  executeGetClientPreferences,
} from './client-preferences.js';
import {
  UPSERT_PRODUCT_TOOL_NAME,
  UPSERT_PRODUCT_DESCRIPTION,
  executeUpsertProduct,
} from './upsert-product.js';
import {
  FETCH_FEED_TOOL_NAME,
  FETCH_FEED_DESCRIPTION,
  executeFetchFeed,
} from './fetch-feed.js';
import { CATEGORY, LOCATION, LIGHT, WATERING, DIFFICULTY } from './product-schema.js';

// A modell-felé eső tool-felület: MILYEN toolok vannak, és hogyan futtatjuk őket.
// Két réteg:
//  - `executeTool`: a MI határvédelmünk (Zod + guard) — soha nem dob, a hibát is a modellnek
//    visszaadható szövegként adja vissza. Ez változatlan a 2–3. óra óta, és a tesztek is ezt fedik.
//  - `buildAiTools`: az AI SDK `tool()` definíciói — a séma, amit a modell lát. Az execute
//    ide van bekötve: AI SDK → executeTool → outcome. A modell PONTOSAN azt kapja vissza
//    (outcome.content), amit a kézi loopban is kapott.
// Új tool hozzáadása = új fájl ebben a mappában + felvétel az `executeTool` dispatchbe és a
// `buildAiTools` térképbe.

export {
  RUN_SQL_TOOL_NAME,
  RUN_SQL_DESCRIPTION,
  executeRunSql,
} from './run-sql.js';
export type { RunSqlOutcome } from './run-sql.js';
export {
  GET_CLIENT_PREFERENCES_TOOL_NAME,
  GET_CLIENT_PREFERENCES_DESCRIPTION,
  executeGetClientPreferences,
  CLIENT_PREFERENCES,
  CLIENT_CODES,
  CARE_LEVELS,
  type ClientCode,
  type CareLevel,
  type ClientPreference,
} from './client-preferences.js';
export { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';
export {
  runReadOnlyQuery,
  closeReadOnlyPool,
  type SqlResult,
} from './db-readonly.js';
export {
  UPSERT_PRODUCT_TOOL_NAME,
  UPSERT_PRODUCT_DESCRIPTION,
  executeUpsertProduct,
} from './upsert-product.js';
export {
  upsertProduct,
  closeReadWritePool,
  type UpsertResult,
  type UpsertAction,
} from './db-readwrite.js';
export {
  FETCH_FEED_TOOL_NAME,
  FETCH_FEED_DESCRIPTION,
  executeFetchFeed,
} from './fetch-feed.js';
export {
  fetchFeedCandidates,
  type FeedCandidate,
  type FeedDomain,
  type FetchFeedResult,
} from './feed-fetch.js';
export {
  ProductInputSchema,
  type ProductInput,
  CATEGORY,
  LOCATION,
  LIGHT,
  WATERING,
  DIFFICULTY,
} from './product-schema.js';

/**
 * A modell egy toolt kért (name + input) → lefuttatjuk. Ismeretlen toolra hibát
 * adunk vissza (a modellnek visszaadható szövegként), NEM dobunk.
 */
export async function executeTool(
  name: string,
  input: unknown,
): Promise<RunSqlOutcome> {
  if (name === RUN_SQL_TOOL_NAME) {
    return executeRunSql(input);
  }
  if (name === GET_CLIENT_PREFERENCES_TOOL_NAME) {
    return executeGetClientPreferences(input);
  }
  if (name === UPSERT_PRODUCT_TOOL_NAME) {
    return executeUpsertProduct(input);
  }
  if (name === FETCH_FEED_TOOL_NAME) {
    return executeFetchFeed(input);
  }
  return {
    content: `Ismeretlen tool: ${name}`,
    isError: true,
    executedSql: null,
    rowCount: null,
  };
}

/** A futás közben keletkező tool-eredmények megfigyelője (a Trace-nek). */
export type ToolOutcomeListener = (
  toolCallId: string,
  name: string,
  input: unknown,
  outcome: RunSqlOutcome,
) => void;

/**
 * Az AI SDK tool-készlete. A sémák szándékosan megengedőek (csak típus) — a SZIGORÚ
 * validáció az executeTool-ban marad (LLM-output megbízhatatlan → Zod a MI határunkon),
 * így a hibás bemenetre is a saját, magyar hibaszövegünk megy vissza a modellnek,
 * nem az SDK kivétele.
 */
// A tool-ok MODELL-felé eső sémái szándékosan megengedőek (típus + describe); a SZIGORÚ validáció
// az executeTool mögött marad, hogy hibás bemenetre a saját magyar üzenetünk menjen vissza. A `tool()`
// az inline inputSchema-ból inferálja az execute input típusát — ezért definiáljuk minden toolt inline.

const runSqlTool = (onOutcome?: ToolOutcomeListener) =>
  tool({
    description: RUN_SQL_DESCRIPTION,
    inputSchema: z.object({
      query: z
        .string()
        .describe('A futtatandó SQL SELECT lekérdezés a products táblán.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeTool(RUN_SQL_TOOL_NAME, input);
      onOutcome?.(toolCallId, RUN_SQL_TOOL_NAME, input, outcome);
      return outcome.content; // a modell ugyanazt kapja, mint a kézi loopban
    },
  });

/** A QUERY-agent (read-only) tool-készlete: katalógus-lekérdezés + ügyfél-preferenciák. */
export function buildAiTools(onOutcome?: ToolOutcomeListener): ToolSet {
  return {
    [RUN_SQL_TOOL_NAME]: runSqlTool(onOutcome),
    [GET_CLIENT_PREFERENCES_TOOL_NAME]: tool({
      description: GET_CLIENT_PREFERENCES_DESCRIPTION,
      inputSchema: z.object({
        clientCode: z
          .string()
          .describe('Az ügyfél kódja, amelyhez a preferenciákat kérjük.'),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeTool(GET_CLIENT_PREFERENCES_TOOL_NAME, input);
        onOutcome?.(toolCallId, GET_CLIENT_PREFERENCES_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
  };
}

// A modellnek megmutatott termék-alak: leíró, de megengedő (a szigorú Zod az executeUpsertProduct-ban
// fut, hogy hibás bemenetre a saját magyar üzenetünk menjen vissza, ne az SDK kivétele).
const upsertProductInputSchema = z.object({
  name: z.string().describe('MAGYAR termék-név.'),
  latinName: z.string().describe('Botanikai (latin) név — ez a termék kulcsa (dedup).'),
  category: z.string().describe(`Egy ezek közül: ${CATEGORY.join(' | ')}.`),
  location: z.string().describe(`Egy ezek közül: ${LOCATION.join(' | ')}.`),
  price: z.number().describe('Ár HUF-ban (> 0).'),
  salePrice: z.number().nullable().describe('Akciós ár HUF-ban, vagy null. Csak a price alatt lehet.'),
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
});

/** Az INGEST-agent tool-készlete: katalógus-olvasás (read-only runSql) + írás (upsertProduct).
 *  Írni KIZÁRÓLAG az upsertProduct szigorúan validált útján lehet — nyers write-SQL nincs. */
export function buildIngestAiTools(onOutcome?: ToolOutcomeListener): ToolSet {
  return {
    [RUN_SQL_TOOL_NAME]: runSqlTool(onOutcome),
    [FETCH_FEED_TOOL_NAME]: tool({
      description: FETCH_FEED_DESCRIPTION,
      inputSchema: z.object({
        source: z
          .enum(['tropicalhome.hu', 'thesill.com'])
          .optional()
          .describe('A feed forrása. Alap: tropicalhome.hu.'),
        filter: z
          .string()
          .optional()
          .describe('Szűrő névre/latin névre (részszó), pl. "monstera mint".'),
        limit: z
          .number()
          .int()
          .optional()
          .describe('Max visszaadott találat (alap 20).'),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeTool(FETCH_FEED_TOOL_NAME, input);
        onOutcome?.(toolCallId, FETCH_FEED_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
    [UPSERT_PRODUCT_TOOL_NAME]: tool({
      description: UPSERT_PRODUCT_DESCRIPTION,
      inputSchema: upsertProductInputSchema,
      execute: async (input, { toolCallId }) => {
        const outcome = await executeTool(UPSERT_PRODUCT_TOOL_NAME, input);
        onOutcome?.(toolCallId, UPSERT_PRODUCT_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
  };
}
