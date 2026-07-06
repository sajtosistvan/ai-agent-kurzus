import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { RunSqlOutcome } from '../tools/run-sql.js';
import type { ToolOutcomeListener } from '../tools/index.js';
import { upsertProductRows, type ProductRow } from './db-readwrite.js';

// Az ingest-agent SAJÁT tool-készlete: fetchFeed (webshop-feed letöltés) + upsertProducts
// (írás a DB-be, read-write kapcsolaton). Ugyanaz a kétrétegű minta, mint a termék-agentnél:
// megengedő modell-séma + szigorú Zod-határvédelem, outcome-alakú (soha nem dobó) eredmény.

/** A támogatott források — a host az EGYETLEN, amit a forrásnév meghatároz. */
const FEED_SOURCES = {
  thesill: 'www.thesill.com',
  tropicalhome: 'tropicalhome.hu',
} as const;
export type FeedSource = keyof typeof FEED_SOURCES;
export const FEED_SOURCE_NAMES = Object.keys(FEED_SOURCES) as [
  FeedSource,
  ...FeedSource[],
];

const MAX_FEED_ITEMS = 50;

/** A feed nyers rekordjából a modellnek szánt, tömörített kivonat (token-takarékos). */
interface FeedDigest {
  title: string;
  productType: string;
  tags: string[];
  priceRaw: string;
  compareAtRaw: string | null;
  available: boolean;
  descriptionExcerpt: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FetchFeedInput = z.object({
  source: z.enum(FEED_SOURCE_NAMES),
  limit: z.number().int().min(1).max(MAX_FEED_ITEMS).default(20),
});

/** Letölti és tömöríti a products.json feedet. Outcome-alakú, nem dob. */
export async function executeFetchFeed(
  rawInput: unknown,
): Promise<RunSqlOutcome> {
  const parsed = FetchFeedInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        `Hibás tool-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}. ` +
        `Érvényes források: ${FEED_SOURCE_NAMES.join(' | ')}.`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
  const { source, limit } = parsed.data;
  const url = `https://${FEED_SOURCES[source]}/products.json?limit=${limit}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        content: `A feed nem elérhető (${url}): HTTP ${response.status}`,
        isError: true,
        executedSql: null,
        rowCount: null,
      };
    }
    const data = (await response.json()) as {
      products?: Array<{
        title?: string;
        product_type?: string;
        tags?: string[];
        body_html?: string;
        variants?: Array<{
          price?: string;
          compare_at_price?: string | null;
          available?: boolean;
        }>;
      }>;
    };
    const digests: FeedDigest[] = (data.products ?? []).map((p) => {
      const variant = p.variants?.[0];
      return {
        title: p.title ?? '',
        productType: p.product_type ?? '',
        tags: p.tags ?? [],
        priceRaw: variant?.price ?? '',
        compareAtRaw: variant?.compare_at_price ?? null,
        available: variant?.available ?? false,
        descriptionExcerpt: stripHtml(p.body_html ?? '').slice(0, 300),
      };
    });
    return {
      content: JSON.stringify({ source, count: digests.length, items: digests }),
      isError: false,
      executedSql: null,
      rowCount: digests.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Feed-letöltési hiba (${url}): ${message}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
}

/** Egy teljes, normalizált termék-sor — a séma enumjai a prompts.ts-sel összhangban. */
const ProductRowSchema = z.object({
  name: z.string().min(1),
  latinName: z.string().min(1),
  category: z.enum([
    'szobanövény',
    'kerti',
    'pozsgás',
    'kaktusz',
    'fűszer',
    'fa-cserje',
    'lógó',
    'virágzó',
  ]),
  location: z.enum(['beltéri', 'kültéri', 'mindkettő']),
  price: z.number().positive(),
  salePrice: z.number().positive().nullable(),
  stock: z.number().int().min(0),
  light: z.enum(['árnyék', 'alacsony', 'közepes', 'erős', 'direkt nap']),
  watering: z.enum(['ritka', 'közepes', 'gyakori', 'állandóan nedves']),
  difficulty: z.enum(['kezdő', 'haladó', 'profi']),
  currentHeightCm: z.number().int().positive(),
  maxHeightCm: z.number().int().positive(),
  currentPotCm: z.number().int().positive(),
  petSafe: z.boolean(),
  kidSafe: z.boolean(),
  airPurifying: z.boolean(),
  rating: z.number().min(0).max(5),
  reviewsCount: z.number().int().min(0),
  description: z.string().min(10),
});

const UpsertInput = z.object({ rows: z.array(ProductRowSchema).min(1).max(10) });

/** Beírja a normalizált sorokat a DB-be (név szerinti upsert). Outcome-alakú, nem dob. */
export async function executeUpsertProducts(
  rawInput: unknown,
): Promise<RunSqlOutcome> {
  const parsed = UpsertInput.safeParse(rawInput);
  if (!parsed.success) {
    // Az ÖSSZES hibát visszaadjuk egyben — így a modell egy körben tudja pótolni mindet,
    // nem mezőnként pingpongozik.
    const issues = parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      content: `Hibás termék-sor(ok): ${issues}. Minden mező kötelező — pótold egyszerre az összes hiányzót.`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
  try {
    const result = await upsertProductRows(parsed.data.rows as ProductRow[]);
    return {
      content: JSON.stringify(result),
      isError: false,
      executedSql: null,
      rowCount: result.inserted + result.updated,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Adatbázis-hiba (upsert): ${message}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }
}

export const FETCH_FEED_TOOL_NAME = 'fetchFeed';
export const UPSERT_PRODUCTS_TOOL_NAME = 'upsertProducts';

/** Az ingest-agent AI SDK tool-készlete — a termék-agent buildAiTools mintájára. */
export function buildIngestTools(onOutcome?: ToolOutcomeListener): ToolSet {
  return {
    [FETCH_FEED_TOOL_NAME]: tool({
      description:
        'Letölti egy webshop publikus Shopify products.json feedjét, és tömörített ' +
        `kivonatot ad vissza. Források: ${FEED_SOURCE_NAMES.join(' | ')}.`,
      inputSchema: z.object({
        source: z
          .string()
          .describe(`A forrás webshop: ${FEED_SOURCE_NAMES.join(' | ')}`),
        limit: z
          .number()
          .optional()
          .describe(`Hány terméket kérjünk le (1-${MAX_FEED_ITEMS}, alapból 20)`),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeFetchFeed(input);
        onOutcome?.(toolCallId, FETCH_FEED_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
    [UPSERT_PRODUCTS_TOOL_NAME]: tool({
      description:
        'Beírja a NORMALIZÁLT termék-sorokat a products táblába (név szerinti upsert). ' +
        'Minden mező kötelező a Plantbase séma szerint; a description saját magyar jellemzés.',
      inputSchema: z.object({
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .describe('A teljes, normalizált termék-sorok a Plantbase séma szerint.'),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeUpsertProducts(input);
        onOutcome?.(toolCallId, UPSERT_PRODUCTS_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
  };
}
