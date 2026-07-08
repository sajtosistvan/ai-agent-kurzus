import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { fetchFeedCandidates, type FeedDomain } from './shopify-feed.js';

// fetchFeed tool — az INGEST-agent ezzel olvassa be ÉLŐBEN a webshop-feedet (Shopify
// products.json), hogy a friss forrás-adat (ár, akció, cserépméret, tag-ek, leírás) alapján
// frissítse a katalógust. A letöltés/normalizálás motorja a shopify-feed.ts; ez a fájl a
// tool-héj: modell-séma + határvédelem + outcome. Az adatbázisba NEM ez ír (az upsertProduct).

const InputSchema = z.object({
  source: z.enum(['tropicalhome.hu', 'thesill.com']).optional(),
  filter: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

/** validál → letölt+normalizál (shopify-feed) → szövegesít. Soha nem dob. */
export async function executeFetchFeed(
  rawInput: unknown,
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Hibás fetchFeed-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}`,
      isError: true,
      summary: null,
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
      summary: `FETCH ${result.source} (${result.matched}/${result.totalPlants} találat)`,
      rowCount: result.candidates.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Feed-hiba: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

/** A modell-felé eső tool-definíció. Bekötés az agentbe: egy sor a toolset-ben. */
export const fetchFeedTool = (report?: ToolReporter) =>
  tool({
    description:
      'Beolvassa egy webshop élő termék-feedjét (Shopify products.json) és normalizált termék-jelölteket ' +
      'ad vissza: latin név, ár (már HUF-ra váltva), akciós ár, cserépméret, tag-ek, rövid leírás. ' +
      'A forrás a "source" enumból választandó — NE találd ki és NE állíts össze URL-t magadtól, a tool ' +
      'a source alapján maga építi fel a helyes feed-URL-t: ' +
      'tropicalhome.hu → https://tropicalhome.hu/products.json (alap), ' +
      'thesill.com → https://thesill.com/products.json. ' +
      'Szűrj a filter paraméterrel egy konkrét termékre (pl. "monstera mint"), hogy ne a teljes feed ' +
      'jöjjön vissza. A kapott adatból állítsd össze a magyar termék-mezőket, majd upsertProduct-tal írd be.',
    inputSchema: z.object({
      source: z
        .enum(['tropicalhome.hu', 'thesill.com'])
        .optional()
        .describe(
          'A feed forrása — pontosan ez a két érték választható, más nem: ' +
            '"tropicalhome.hu" (feed: https://tropicalhome.hu/products.json, ez az alap, ha nincs megadva) ' +
            'vagy "thesill.com" (feed: https://thesill.com/products.json).',
        ),
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
      const outcome = await executeFetchFeed(input);
      report?.(toolCallId, 'fetchFeed', input, outcome);
      return outcome.content;
    },
  });
