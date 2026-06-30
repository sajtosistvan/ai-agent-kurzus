import pg from 'pg';
import { loadConfig } from '../config.js';

// READ-ONLY adatkapcsolat az agent runSql-jéhez. A jog a DB-szerepkörből (plantbase_ro) jön;
// itt extra védőkorlátok: statement_timeout és read-only session. Az agent NEM Prismán kérdez
// (architektura.md 2. pont) — közvetlen pg kapcsolat a katalógus felett.

const { Pool } = pg;
const STATEMENT_TIMEOUT_MS = 5000;

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const { databaseUrlReadonly } = loadConfig();
    pool = new Pool({
      connectionString: databaseUrlReadonly,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      application_name: 'plantbase-agent-readonly',
      max: 4,
    });
  }
  return pool;
}

/** Lefuttat egy (már guarddal ellenőrzött) SELECT-et a read-only kapcsolaton. */
export async function runReadOnlyQuery(sql: string): Promise<SqlResult> {
  const client = await getPool().connect();
  try {
    // Read-only tranzakció: harmadik védelmi réteg a szerepkör + guard mellett.
    await client.query('START TRANSACTION READ ONLY');
    try {
      const result = await client.query(sql);
      await client.query('COMMIT');
      return {
        columns: result.fields.map((f) => f.name),
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

/** A pool lezárása (a CLI a futás végén meghívja, hogy a folyamat tisztán kilépjen). */
export async function closeReadOnlyPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
