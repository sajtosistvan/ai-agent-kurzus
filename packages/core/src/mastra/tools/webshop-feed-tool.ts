import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { fetchFeedCandidates, type FeedDomain } from './webshop-feed/shopify-feed.js';

// webshop_feed tool — ezzel olvassa be a katalógus-szerkesztő ÉLŐBEN a webshop-feedet
// (Shopify products.json), hogy friss forrás-adatból (ár, akció, cserépméret, tag-ek, leírás)
// frissítse a katalógust. A letöltés/normalizálás motorja a webshop-feed/shopify-feed.ts;
// ez a fájl a tool-burok: séma + határvédelem + naplózás. Az adatbázisba NEM ez ír — arra
// a termek_mentes tool való.

const BemenetSchema = z.object({
  source: z.enum(['tropicalhome.hu', 'thesill.com']).optional(),
  filter: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  forras: z.string().nullable(),
  /** Az árfolyam-megjegyzés (fix kulcsok: USD=310, EUR=350) — a modell így tudja, mit lát. */
  arfolyamMegjegyzes: z.string().nullable(),
  osszesNoveny: z.number().nullable(),
  talalatok: z.number().nullable(),
  jeloltek: z.array(z.record(z.string(), z.unknown())),
  hiba: z.string().nullable(),
});

const URES = {
  forras: null,
  arfolyamMegjegyzes: null,
  osszesNoveny: null,
  talalatok: null,
  jeloltek: [] as Record<string, unknown>[],
};

export const webshopFeedTool = createTool({
  id: 'webshop_feed',
  description:
    'Beolvassa egy webshop élő termék-feedjét (Shopify products.json) és normalizált termék-jelölteket ' +
    'ad vissza: latin név, ár (már HUF-ra váltva), akciós ár, cserépméret, tag-ek, rövid leírás. ' +
    'A forrás a "source" enumból választandó — NE találd ki és NE állíts össze URL-t magadtól, a tool ' +
    'a source alapján maga építi fel a helyes feed-URL-t: ' +
    'tropicalhome.hu → https://tropicalhome.hu/products.json (alap), ' +
    'thesill.com → https://thesill.com/products.json. ' +
    'Szűrj a filter paraméterrel egy konkrét termékre (pl. "monstera mint"), hogy ne a teljes feed ' +
    'jöjjön vissza. A kapott adatból állítsd össze a magyar termék-mezőket, majd a termek_mentes ' +
    'toollal írd be.',
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
    limit: z.number().int().optional().describe('Max visszaadott találat (alap 20).'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra }) => {
    const logger = mastra?.getLogger();

    const ellenorzott = BemenetSchema.safeParse(bemenet);
    if (!ellenorzott.success) {
      const uzenet = ellenorzott.error.issues[0]?.message ?? 'ismeretlen';
      logger?.warn('webshop_feed — hibás tool-bemenet', { uzenet });
      return { sikeres: false, ...URES, hiba: `Hibás webshop_feed-bemenet: ${uzenet}` };
    }

    try {
      const eredmeny = await fetchFeedCandidates({
        source: ellenorzott.data.source as FeedDomain | undefined,
        filter: ellenorzott.data.filter,
        limit: ellenorzott.data.limit,
      });
      logger?.info('webshop_feed — feed beolvasva', {
        forras: eredmeny.source,
        talalatok: eredmeny.matched,
        osszesNoveny: eredmeny.totalPlants,
      });
      return {
        sikeres: true,
        forras: eredmeny.source,
        arfolyamMegjegyzes: eredmeny.fxNote,
        osszesNoveny: eredmeny.totalPlants,
        talalatok: eredmeny.matched,
        // A jelölt-alak a feed-oldal dolga (shopify-feed.ts); itt nem duplikáljuk sémaként.
        jeloltek: eredmeny.candidates as unknown as Record<string, unknown>[],
        hiba: null,
      };
    } catch (error: unknown) {
      const uzenet = error instanceof Error ? error.message : String(error);
      logger?.warn('webshop_feed — feed-hiba', { uzenet });
      return { sikeres: false, ...URES, hiba: `Feed-hiba: ${uzenet}` };
    }
  },
});
