// shopify-feed.ts — a Shopify products.json feedek DETERMINISZTIKUS olvasása/normalizálása.
// Ez a fetch-feed tool MOTORJA (nem tool): sima kliens-kód, LLM nélkül. Ugyanaz a logika, mint a product-ingest skill fetch-feeds.mjs-e,
// TS-ként a termékbe portolva: letölt + lapoz, kiszűri a nem-növényeket, kinyeri a biztonságosan
// kinyerhető mezőket, HUF-ra vált (USD 310, EUR 350), és dedupál latin név szerint.
// A nyelvi + gondozási enrichment (magyar név/leírás, fény/öntözés...) NEM itt van: azt az agent
// tölti ki a candidate.bodyHtml + tags alapján, mielőtt upsertProduct-tal ír.

export type FeedDomain = 'tropicalhome.hu' | 'thesill.com';

interface SourceConfig {
  domain: FeedDomain;
  currency: 'HUF' | 'USD';
  latinFrom: 'title' | 'botanical-tag';
}

const SOURCES: Record<FeedDomain, SourceConfig> = {
  'tropicalhome.hu': { domain: 'tropicalhome.hu', currency: 'HUF', latinFrom: 'title' },
  'thesill.com': { domain: 'thesill.com', currency: 'USD', latinFrom: 'botanical-tag' },
};

const FX_TO_HUF: Record<string, number> = { HUF: 1, USD: 310, EUR: 350 };

const NON_PLANT_TYPES = new Set([
  'accessory', 'accessories', 'planter', 'consumable', 'faux', 'soil', 'tool', 'tools', 'care', '',
]);
const FT_TO_CM = 30.48;
const MAX_PAGES = 20;

export interface FeedCandidate {
  source: FeedDomain;
  handle: string;
  url: string;
  rawTitle: string;
  latinName: string | null;
  productType: string;
  tags: string[];
  bodyHtml: string;
  image: string | null;
  priceHuf: number | null;
  salePriceHuf: number | null;
  currentPotCm: number | null;
  maxHeightCm: number | null;
  available: boolean;
  sourceCurrency: string;
}

// Shopify products.json — csak a felhasznált mezők; a külső adat megbízhatatlan, ezért defenzív olvasás.
interface ShopifyVariant {
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
}
interface ShopifyProduct {
  handle?: string;
  title?: string;
  product_type?: string;
  tags?: string[] | string;
  body_html?: string;
  variants?: ShopifyVariant[];
  images?: { src?: string }[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(url: string, attempt = 1): Promise<{ products?: ShopifyProduct[] }> {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 plantbase-ingest' },
    });
    if (res.status === 429 || res.status >= 500 || !res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as { products?: ShopifyProduct[] };
  } catch (error: unknown) {
    if (attempt >= MAX_ATTEMPTS) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    await sleep(500 * 2 ** (attempt - 1));
    return fetchPage(url, attempt + 1);
  }
}

async function fetchAllProducts(domain: FeedDomain): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${domain}/products.json?limit=250&page=${page}`;
    const { products } = await fetchPage(url);
    if (!products || products.length === 0) break;
    all.push(...products);
    if (products.length < 250) break;
  }
  return all;
}

const tagList = (p: ShopifyProduct): string[] =>
  (Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(','))
    .map((t) => t.trim())
    .filter((t) => !/^rs_[a-z]{2}$/i.test(t)); // szállítási-zóna zaj kiszűrve

function extractLatin(source: SourceConfig, p: ShopifyProduct): string | null {
  const title = p.title ?? '';
  if (source.latinFrom === 'botanical-tag') {
    const tag = tagList(p).find((t) => /^botanical name\s*:/i.test(t));
    if (!tag) return null;
    return tag.split(':').slice(1).join(':').trim() || null;
  }
  // title-alapú (tropicalhome): a cím a latin név, a cserépméret-suffixet levágjuk.
  return (
    title
      .replace(/\s*[-–]\s*\d+([.,]\d+)?\s*cm.*$/i, '')
      .replace(/\s+\d+([.,]\d+)?\s*cm\b/gi, '')
      .trim() || null
  );
}

function dedupKey(latin: string): string {
  return latin
    .toLowerCase()
    .replace(/["'“”‘’]/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*cm\b/g, ' ')
    .replace(/[^a-zàáâäãåæçèéêëìíîïñòóôöõùúûü\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePotCm(p: ShopifyProduct): number | null {
  for (const t of tagList(p)) {
    const m = t.match(/(\d+([.,]\d+)?)\s*cm/i);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')));
  }
  return null;
}

function parseMaxHeightCm(p: ShopifyProduct): number | null {
  const tag = tagList(p).find((t) => /mature height/i.test(t));
  if (!tag) return null;
  const ft = tag.match(/(\d+([.,]\d+)?)\s*ft/i);
  if (ft) return Math.round(parseFloat(ft[1].replace(',', '.')) * FT_TO_CM);
  const cm = tag.match(/(\d+([.,]\d+)?)\s*cm/i);
  return cm ? Math.round(parseFloat(cm[1].replace(',', '.'))) : null;
}

function toHuf(amount: string, currency: string): number {
  const rate = FX_TO_HUF[currency];
  if (rate == null) throw new Error(`Ismeretlen pénznem: ${currency}`);
  return Math.round(parseFloat(amount) * rate);
}

function toCandidate(source: SourceConfig, p: ShopifyProduct): FeedCandidate {
  const latin = extractLatin(source, p);
  const v = p.variants?.[0] ?? {};
  const price = v.price != null ? toHuf(v.price, source.currency) : null;
  const compareAt =
    v.compare_at_price != null ? toHuf(v.compare_at_price, source.currency) : null;
  const onSale = compareAt != null && price != null && compareAt > price;
  return {
    source: source.domain,
    handle: p.handle ?? '',
    url: `https://${source.domain}/products/${p.handle ?? ''}`,
    rawTitle: p.title ?? '',
    latinName: latin,
    productType: p.product_type ?? '',
    tags: tagList(p),
    bodyHtml: (p.body_html ?? '').slice(0, 1200),
    image: p.images?.[0]?.src ?? null,
    priceHuf: onSale ? compareAt : price,
    salePriceHuf: onSale ? price : null,
    currentPotCm: parsePotCm(p),
    maxHeightCm: parseMaxHeightCm(p),
    available: Boolean(v.available),
    sourceCurrency: source.currency,
  };
}

const richness = (c: FeedCandidate): number =>
  (c.available ? 4 : 0) +
  (c.maxHeightCm ? 1 : 0) +
  (c.currentPotCm ? 1 : 0) +
  (c.bodyHtml ? 1 : 0);

export interface FetchFeedOptions {
  /** Alap: tropicalhome.hu. */
  source?: FeedDomain;
  /** Szűrő névre/latin névre (részszó, kis/nagybetű-független). */
  filter?: string;
  /** Max visszaadott találat (a kontextus védelmére). */
  limit?: number;
}

export interface FetchFeedResult {
  source: FeedDomain;
  fxNote: string;
  matched: number;
  totalPlants: number;
  candidates: FeedCandidate[];
}

/** Letölti és normalizálja a feedet, dedupál latin név szerint, majd (opcionális) szűrő + limit. */
export async function fetchFeedCandidates(
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const source = SOURCES[options.source ?? 'tropicalhome.hu'];
  const products = await fetchAllProducts(source.domain);

  const byKey = new Map<string, FeedCandidate>();
  for (const p of products) {
    const type = String(p.product_type ?? '').toLowerCase().trim();
    if (NON_PLANT_TYPES.has(type)) continue;
    const candidate = toCandidate(source, p);
    if (!candidate.latinName) continue; // latin nélkül nincs kulcs → kihagyva
    const key = dedupKey(candidate.latinName);
    const prev = byKey.get(key);
    if (!prev || richness(candidate) > richness(prev)) byKey.set(key, candidate);
  }

  const all = [...byKey.values()];
  const filter = options.filter?.trim().toLowerCase();
  const filtered = filter
    ? all.filter(
        (c) =>
          (c.latinName ?? '').toLowerCase().includes(filter) ||
          c.rawTitle.toLowerCase().includes(filter),
      )
    : all;

  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  return {
    source: source.domain,
    fxNote: 'árfolyam: USD=310, EUR=350, HUF=1 (fix)',
    matched: filtered.length,
    totalPlants: all.length,
    candidates: filtered.slice(0, limit),
  };
}
