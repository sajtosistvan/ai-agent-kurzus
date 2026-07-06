import { z } from 'zod';
import { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';
import { runReadOnlyQuery } from './db-readonly.js';

// A runSql tool: a modell ezzel futtatja a generált SELECT-et a katalóguson (read-only).
// Az LLM-output megbízhatatlan → Zod-validáció a határon, majd a SELECT-only guard, majd a
// read-only kapcsolat. Az eredmény vagy a hiba szövegként megy vissza a modellnek.
// A modell-felé eső séma (AI SDK `tool()`) a tools/index.ts-ben áll össze — itt a név,
// a leírás és a végrehajtás él.

export const RUN_SQL_TOOL_NAME = 'runSql';

export const RUN_SQL_DESCRIPTION =
  'Lefuttat EGY read-only SQL SELECT-et a products katalógus táblán, és visszaadja a sorokat. ' +
  'Csak SELECT (vagy WITH ... SELECT) engedélyezett; mindig tegyél LIMIT-et.';

const InputSchema = z.object({ query: z.string().min(1) });

const MAX_RESULT_ROWS = 100;

export interface RunSqlOutcome {
  /** A modellnek visszaadott szöveg (eredmény JSON vagy hibaüzenet). */
  content: string;
  isError: boolean;
  /** Naplózáshoz: a ténylegesen futtatott (guardolt) SQL, ha eljutott odáig. */
  executedSql: string | null;
  rowCount: number | null;
}

/** A tool-hívás végrehajtása: validál → guard → futtat → szövegesít. Soha nem dob, a hibát is
 *  a modellnek visszaadható szövegként adja vissza (is_error: true). */
export async function executeRunSql(rawInput: unknown): Promise<RunSqlOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Hibás tool-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }

  let sql: string;
  try {
    sql = ensureReadOnlySelect(parsed.data.query);
  } catch (error: unknown) {
    const message =
      error instanceof SqlGuardError ? error.message : String(error);
    return {
      content: `SQL elutasítva: ${message}`,
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }

  try {
    const result = await runReadOnlyQuery(sql);
    const rows = result.rows.slice(0, MAX_RESULT_ROWS);
    const payload = {
      columns: result.columns,
      rowCount: result.rowCount,
      rows,
      truncated: result.rows.length > MAX_RESULT_ROWS,
    };
    return {
      content: JSON.stringify(payload),
      isError: false,
      executedSql: sql,
      rowCount: result.rowCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Adatbázis-hiba: ${message}`,
      isError: true,
      executedSql: sql,
      rowCount: null,
    };
  }
}
