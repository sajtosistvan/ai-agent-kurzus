import { z } from 'zod';

// plant-search-sql.ts — a DETERMINISZTIKUS kereső magja: strukturált szűrőkből paraméterezett
// SELECT. Itt NINCS modell: ugyanaz a bemenet mindig ugyanazt az SQL-t adja, ezért unit-tesztelhető.
//
// Ez a tool a párja az ask_plantbase-nek (agent-as-tool): a kettő szemlélteti a két MCP-stílust —
//   search_plants  → ADAT: a hívó modell (Claude) gondolkodik, mi csak kiszolgáljuk sorokkal,
//   ask_plantbase  → AGENT: a MI agentünk gondolkodik, a hívó csak a végeredményt kapja.
//
// BIZTONSÁG: az értékek soha nem kerülnek bele az SQL szövegébe — minden szűrő $n placeholder,
// az értékek külön tömbben mennek a pg-nek. Az oszlop- és irány-nevek nem jöhetnek a hívótól
// szabad szövegként: fix listákból (SORT_COLUMNS) képezzük őket.

/** A products enum-értékei — a séma (schema.prisma) másolata. Ami nincs a listán, azt a Zod eldobja. */
export const CATEGORIES = [
  'szobanövény',
  'kerti',
  'pozsgás',
  'kaktusz',
  'fűszer',
  'fa-cserje',
  'lógó',
  'virágzó',
] as const;

export const LIGHT_LEVELS = [
  'árnyék',
  'alacsony',
  'közepes',
  'erős',
  'direkt nap',
] as const;

export const DIFFICULTIES = ['kezdő', 'haladó', 'profi'] as const;

/** Rendezés: a hívó egy KULCSOT ad, az oszlopnevet mi tesszük hozzá. Így nem lehet oszlopnevet
 *  injektálni (a placeholder ORDER BY-ban nem működne). */
export const SORT_KEYS = ['ár', '-ár', 'értékelés', 'készlet', 'név'] as const;

const SORT_COLUMNS: Record<(typeof SORT_KEYS)[number], string> = {
  ár: 'COALESCE(sale_price, price) ASC',
  '-ár': 'COALESCE(sale_price, price) DESC',
  értékelés: 'rating DESC, reviews_count DESC',
  készlet: 'stock DESC',
  név: 'name ASC',
};

export const MAX_LIMIT = 50;

export const PlantSearchSchema = z.object({
  keres: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Szabad szöveg: a magyar névben, a latin névben és a leírásban keres.'),
  kategoria: z.enum(CATEGORIES).optional(),
  feny: z.enum(LIGHT_LEVELS).optional(),
  nehezseg: z.enum(DIFFICULTIES).optional(),
  maxAr: z.number().int().positive().optional().describe('Felső árhatár HUF-ban (akciós árral számol).'),
  minAr: z.number().int().nonnegative().optional(),
  petSafe: z.boolean().optional().describe('Csak háziállatra biztonságos növények.'),
  kidSafe: z.boolean().optional(),
  csakRaktaron: z.boolean().optional().describe('Csak a raktáron lévő tételek (stock > 0).'),
  rendezes: z.enum(SORT_KEYS).optional().describe('Rendezési kulcs; alap: értékelés szerint.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

export type PlantSearch = z.infer<typeof PlantSearchSchema>;

export interface PreparedQuery {
  sql: string;
  params: unknown[];
}

const SELECTED_COLUMNS = [
  'id',
  'name',
  'latin_name',
  'category',
  'price',
  'sale_price',
  'stock',
  'light',
  'watering',
  'difficulty',
  'pet_safe',
  'kid_safe',
  'rating',
].join(', ');

/** Szűrőkből paraméterezett SELECT. Tiszta függvény: se DB, se modell — ezért tesztelhető. */
export function buildPlantSearchSql(filters: PlantSearch): PreparedQuery {
  const conditions: string[] = [];
  const params: unknown[] = [];

  /** Egy feltétel hozzáadása: az ÉRTÉK mindig paraméterként megy, a szöveg fix. */
  const where = (fragment: (placeholder: string) => string, value: unknown): void => {
    params.push(value);
    conditions.push(fragment(`$${params.length}`));
  };

  if (filters.keres !== undefined) {
    where(
      (p) => `(name ILIKE ${p} OR latin_name ILIKE ${p} OR description ILIKE ${p})`,
      `%${filters.keres}%`,
    );
  }
  if (filters.kategoria !== undefined) {
    where((p) => `category = ${p}`, filters.kategoria);
  }
  if (filters.feny !== undefined) {
    where((p) => `light = ${p}`, filters.feny);
  }
  if (filters.nehezseg !== undefined) {
    where((p) => `difficulty = ${p}`, filters.nehezseg);
  }
  if (filters.maxAr !== undefined) {
    where((p) => `COALESCE(sale_price, price) <= ${p}`, filters.maxAr);
  }
  if (filters.minAr !== undefined) {
    where((p) => `COALESCE(sale_price, price) >= ${p}`, filters.minAr);
  }
  if (filters.petSafe === true) {
    conditions.push('pet_safe = TRUE');
  }
  if (filters.kidSafe === true) {
    conditions.push('kid_safe = TRUE');
  }
  if (filters.csakRaktaron === true) {
    conditions.push('stock > 0');
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = SORT_COLUMNS[filters.rendezes ?? 'értékelés'];
  const limit = filters.limit ?? 10;

  return {
    sql: `SELECT ${SELECTED_COLUMNS} FROM products${whereClause} ORDER BY ${orderBy} LIMIT ${limit}`,
    params,
  };
}
