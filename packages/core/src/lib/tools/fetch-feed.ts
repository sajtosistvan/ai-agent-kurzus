import { z } from 'zod';
import { fetchFeedCandidates, type FeedDomain } from './feed-fetch.js';
import type { RunSqlOutcome } from './run-sql.js';

// A fetchFeed tool: az ingest-agent ezzel olvassa be ÉLŐBEN a webshop-feedet (Shopify products.json),
// hogy a friss forrás-adat (ár, akció, cserépméret, tag-ek, leírás) alapján frissítse a katalógust.
// Read-only a külső forrásra nézve: csak letölt és normalizál; az adatbázisba az upsertProduct ír.
// A visszaadott candidate-ek ára már HUF (USD 310 / EUR 350 váltva); a magyar név/leírás + gondozási
// mezők kitöltése az agent dolga, mielőtt upsertProduct-tal ír.

export const FETCH_FEED_TOOL_NAME = 'fetchFeed';

export const FETCH_FEED_DESCRIPTION =
  'Beolvassa egy webshop élő termék-feedjét (Shopify products.json) és normalizált termék-jelölteket ' +
  'ad vissza: latin név, ár (már HUF-ra váltva), akciós ár, cserépméret, tag-ek, rövid leírás. ' +
  'Forrás: tropicalhome.hu (alap) vagy thesill.com. Szűrj a filter paraméterrel egy konkrét termékre ' +
  '(pl. "monstera mint"), hogy ne a teljes feed jöjjön vissza. A kapott adatból állítsd össze a ' +
  'magyar termék-mezőket, majd upsertProduct-tal írd be.';

const InputSchema = z.object({
  source: z.enum(['tropicalhome.hu', 'thesill.com']).optional(),
  filter: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export async function executeFetchFeed(rawInput: unknown): Promise<RunSqlOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Hibás fetchFeed-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }

  try {
    const result = await fetchFeedCandidates({
      source: parsed.data.source as FeedDomain | undefined,
      filter: parsed.data.filter,
      limit: parsed.data.limit,
    });
    return {
      content: JSON.stringify(result),
      isError: false,
      executedSql: `FETCH ${result.source} (${result.matched}/${result.totalPlants} találat)`,
      rowCount: result.candidates.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Feed-hiba: ${message}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
}
