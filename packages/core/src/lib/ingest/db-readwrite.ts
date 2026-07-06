import { Pool } from 'pg';
import { z } from 'zod';

// Az ingest-agent ÍR is a DB-be — ezért KÜLÖN, read-write kapcsolaton fut (DATABASE_URL),
// nem a termék-agent read-only poolján. A két kapcsolat szétválasztása szándékos határ:
// a kérdés-válasz agent SOHA nem kap írási jogot.

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        'Hiányzó konfiguráció (DATABASE_URL): az ingest-agent read-write kapcsolatot igényel. ' +
          'Másold a .env.example-t .env-be, és add meg a DATABASE_URL-t.',
      );
    }
    pool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 3 });
  }
  return pool;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

export interface ProductRow {
  name: string;
  latinName: string;
  category: string;
  location: string;
  price: number;
  salePrice: number | null;
  stock: number;
  light: string;
  watering: string;
  difficulty: string;
  currentHeightCm: number;
  maxHeightCm: number;
  currentPotCm: number;
  petSafe: boolean;
  kidSafe: boolean;
  airPurifying: boolean;
  rating: number;
  reviewsCount: number;
  description: string;
}

/** Upsert név alapján: ha van már ilyen nevű termék, frissítjük; ha nincs, beszúrjuk. */
export async function upsertProductRows(
  rows: ProductRow[],
): Promise<UpsertResult> {
  const db = getPool();
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await db.query<{ id: number }>(
      'SELECT id FROM products WHERE name = $1 LIMIT 1',
      [row.name],
    );
    if (existing.rows[0]) {
      await db.query(
        `UPDATE products SET
           latin_name = $2, category = $3, location = $4, price = $5, sale_price = $6,
           stock = $7, light = $8, watering = $9, difficulty = $10,
           current_height_cm = $11, max_height_cm = $12, current_pot_cm = $13,
           pet_safe = $14, kid_safe = $15, air_purifying = $16,
           rating = $17, reviews_count = $18, description = $19
         WHERE id = $1`,
        [
          existing.rows[0].id,
          row.latinName,
          row.category,
          row.location,
          row.price,
          row.salePrice,
          row.stock,
          row.light,
          row.watering,
          row.difficulty,
          row.currentHeightCm,
          row.maxHeightCm,
          row.currentPotCm,
          row.petSafe,
          row.kidSafe,
          row.airPurifying,
          row.rating,
          row.reviewsCount,
          row.description,
        ],
      );
      updated += 1;
    } else {
      await db.query(
        `INSERT INTO products (
           name, latin_name, category, location, price, sale_price, stock,
           light, watering, difficulty, current_height_cm, max_height_cm,
           current_pot_cm, pet_safe, kid_safe, air_purifying, rating,
           reviews_count, description
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          row.name,
          row.latinName,
          row.category,
          row.location,
          row.price,
          row.salePrice,
          row.stock,
          row.light,
          row.watering,
          row.difficulty,
          row.currentHeightCm,
          row.maxHeightCm,
          row.currentPotCm,
          row.petSafe,
          row.kidSafe,
          row.airPurifying,
          row.rating,
          row.reviewsCount,
          row.description,
        ],
      );
      inserted += 1;
    }
  }
  return { inserted, updated };
}

/** A read-write pool lezárása (a CLI hívja kilépés előtt). */
export async function closeReadWritePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
