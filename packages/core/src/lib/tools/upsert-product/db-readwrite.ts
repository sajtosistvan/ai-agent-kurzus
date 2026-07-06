import pg from 'pg';
import { z } from 'zod';
import {
  PRODUCT_COLUMNS,
  type ProductInput,
} from './product-schema.js';

// READ-WRITE adatkapcsolat az INGEST-agent upsertProduct-jához. KÜLÖN a query-agent read-only
// kapcsolatától (db-readonly.ts): az olvasás guardolt SELECT-only marad, írni KIZÁRÓLAG a szigorúan
// validált upsertProduct toolon keresztül lehet — nyers write-SQL-t az agent nem futtathat.
// A DATABASE_URL-t itt, lokálisan validáljuk (fail-fast), hogy a query-agent config.ts-ét ne bővítsük.

const { Pool } = pg;
const STATEMENT_TIMEOUT_MS = 5000;

const RwEnvSchema = z.object({ DATABASE_URL: z.string().min(1) });

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const parsed = RwEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        'Hiányzó DATABASE_URL (read-write). Az ingest-agent íráshoz ezt igényli — add meg a .env-ben.',
      );
    }
    pool = new Pool({
      connectionString: parsed.data.DATABASE_URL,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      application_name: 'plantbase-agent-ingest',
      max: 4,
    });
  }
  return pool;
}

export type UpsertAction = 'created' | 'updated';

export interface UpsertResult {
  action: UpsertAction;
  id: number;
  latinName: string;
}

/** Upsert latin név szerint (case-insensitive), paraméterezett lekérdezésekkel (nincs string-konkat).
 *  Meglévőt frissít, újat beszúr — idempotens. */
export async function upsertProduct(input: ProductInput): Promise<UpsertResult> {
  const values = PRODUCT_COLUMNS.map(([field]) => input[field]);
  const client = await getPool().connect();
  try {
    const found = await client.query<{ id: number }>(
      'SELECT id FROM products WHERE lower(latin_name) = lower($1) LIMIT 1',
      [input.latinName],
    );

    if (found.rows.length > 0) {
      const id = found.rows[0].id;
      const setClause = PRODUCT_COLUMNS.map(([, col], i) => `${col} = $${i + 1}`).join(', ');
      await client.query(
        `UPDATE products SET ${setClause} WHERE id = $${PRODUCT_COLUMNS.length + 1}`,
        [...values, id],
      );
      return { action: 'updated', id, latinName: input.latinName };
    }

    const cols = PRODUCT_COLUMNS.map(([, col]) => col).join(', ');
    const placeholders = PRODUCT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO products (${cols}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
    return { action: 'created', id: inserted.rows[0].id, latinName: input.latinName };
  } finally {
    client.release();
  }
}

/** A pool lezárása (a CLI a futás végén meghívja, hogy a folyamat tisztán kilépjen). */
export async function closeReadWritePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
