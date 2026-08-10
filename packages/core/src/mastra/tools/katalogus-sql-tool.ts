import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { ensureReadOnlySelect, SqlGuardError } from './katalogus-sql/sql-guard.js';
import { runReadOnlyQuery } from './katalogus-sql/db-readonly.js';

// katalogus_sql tool — a kérdés-válasz úton EZZEL futtat a modell SELECT-et a katalóguson.
//
// NFR1 (a legfontosabb szabály): ez az út SOHA nem írhat. Három egymástól független réteg
// védi: (1) a plantbase_ro Postgres-szerepkör, (2) a sql-guard.ts (csak SELECT/WITH…SELECT,
// egy utasítás, kötelező LIMIT), (3) START TRANSACTION READ ONLY (db-readonly.ts).
//
// Az inputSchema szándékosan MEGENGEDŐ (csak típus): a szigorú ellenőrzés az execute-ban fut,
// így hibás modell-bemenetre is a SAJÁT magyar hibaszövegünk megy vissza, nem SDK-kivétel.
// Az execute EZÉRT soha nem dob — a hibát a `sikeres: false` + `hiba` mezőben adja vissza.

const MAX_RESULT_ROWS = 100;

const BemenetSchema = z.object({ query: z.string().min(1) });

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  /** A ténylegesen lefuttatott, guardolt SQL (LIMIT-tel kiegészítve) — ez látszik a trace-ben. */
  futtatottSql: z.string().nullable(),
  oszlopok: z.array(z.string()),
  sorok: z.array(z.record(z.string(), z.unknown())),
  sorokSzama: z.number().nullable(),
  csonkolt: z.boolean(),
  hiba: z.string().nullable(),
});

export type KatalogusSqlKimenet = z.infer<typeof KimenetSchema>;

const URES_EREDMENY = {
  oszlopok: [] as string[],
  sorok: [] as Record<string, unknown>[],
  sorokSzama: null,
  csonkolt: false,
};

export const katalogusSqlTool = createTool({
  id: 'katalogus_sql',
  description:
    'Lefuttat EGY read-only SQL SELECT-et a products katalógus táblán, és visszaadja a sorokat. ' +
    'Csak SELECT (vagy WITH ... SELECT) engedélyezett; mindig tegyél LIMIT-et.',
  inputSchema: z.object({
    query: z.string().describe('A futtatandó SQL SELECT lekérdezés a products táblán.'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra }) => {
    const logger = mastra?.getLogger();

    const ellenorzott = BemenetSchema.safeParse(bemenet);
    if (!ellenorzott.success) {
      const uzenet = ellenorzott.error.issues[0]?.message ?? 'ismeretlen';
      logger?.warn('katalogus_sql — hibás tool-bemenet', { uzenet });
      return { sikeres: false, futtatottSql: null, ...URES_EREDMENY, hiba: `Hibás tool-bemenet: ${uzenet}` };
    }

    let sql: string;
    try {
      sql = ensureReadOnlySelect(ellenorzott.data.query);
    } catch (error: unknown) {
      const uzenet = error instanceof SqlGuardError ? error.message : String(error);
      // Szándékosan warn: a Logs fülön így látszik, mikor akart a modell tiltott SQL-t futtatni.
      logger?.warn('katalogus_sql — az SQL-guard elutasította', { query: ellenorzott.data.query, uzenet });
      return { sikeres: false, futtatottSql: null, ...URES_EREDMENY, hiba: `SQL elutasítva: ${uzenet}` };
    }

    try {
      const eredmeny = await runReadOnlyQuery(sql);
      const sorok = eredmeny.rows.slice(0, MAX_RESULT_ROWS);
      logger?.info('katalogus_sql — lekérdezés lefutott', { sql, sorokSzama: eredmeny.rowCount });
      return {
        sikeres: true,
        futtatottSql: sql,
        oszlopok: eredmeny.columns,
        sorok,
        sorokSzama: eredmeny.rowCount,
        csonkolt: eredmeny.rows.length > MAX_RESULT_ROWS,
        hiba: null,
      };
    } catch (error: unknown) {
      const uzenet = error instanceof Error ? error.message : String(error);
      logger?.warn('katalogus_sql — adatbázis-hiba', { sql, uzenet });
      return { sikeres: false, futtatottSql: sql, ...URES_EREDMENY, hiba: `Adatbázis-hiba: ${uzenet}` };
    }
  },
});
