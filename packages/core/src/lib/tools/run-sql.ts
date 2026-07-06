import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from './tool-outcome.js';
import { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';
import { runReadOnlyQuery } from './db-readonly.js';

// runSql tool — a QUERY-agent ezzel futtatja a generált SELECT-et a katalóguson (READ-ONLY).
//
// EGY TOOL = EGY FÁJL, benne minden hozzávaló:
//   1. a modellnek szánt leírás + megengedő séma (runSqlTool) — ebből érti a modell, mire való,
//   2. a szigorú határvédelem + futtatás (executeRunSql) — Zod, SELECT-guard, read-only kapcsolat.
// A séma szándékosan megengedő (csak típus): a SZIGORÚ validáció az execute-ban van, így hibás
// bemenetre is a SAJÁT magyar hibaszövegünk megy vissza a modellnek, nem az SDK kivétele.

const MAX_RESULT_ROWS = 100;

const InputSchema = z.object({ query: z.string().min(1) });

/** validál → guard → futtat → szövegesít. Soha nem dob. */
export async function executeRunSql(rawInput: unknown): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Hibás tool-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}`,
      isError: true,
      summary: null,
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
      summary: null,
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
      summary: sql, // a guardolt SQL — ezt mutatja a Trace
      rowCount: result.rowCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Adatbázis-hiba: ${message}`,
      isError: true,
      summary: sql,
      rowCount: null,
    };
  }
}

/** A modell-felé eső tool-definíció. Bekötés az agentbe: egy sor a toolset-ben. */
export const runSqlTool = (report?: ToolReporter) =>
  tool({
    description:
      'Lefuttat EGY read-only SQL SELECT-et a products katalógus táblán, és visszaadja a sorokat. ' +
      'Csak SELECT (vagy WITH ... SELECT) engedélyezett; mindig tegyél LIMIT-et.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('A futtatandó SQL SELECT lekérdezés a products táblán.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeRunSql(input);
      report?.(toolCallId, 'runSql', input, outcome);
      return outcome.content; // a modell PONTOSAN ezt kapja vissza
    },
  });
