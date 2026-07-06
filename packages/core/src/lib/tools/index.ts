import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  RUN_SQL_TOOL_NAME,
  RUN_SQL_DESCRIPTION,
  executeRunSql,
  type RunSqlOutcome,
} from './run-sql.js';
import {
  GET_CLIENT_PREFERENCES_TOOL_NAME,
  GET_CLIENT_PREFERENCES_DESCRIPTION,
  executeGetClientPreferences,
} from './client-preferences.js';

// A modell-felé eső tool-felület: MILYEN toolok vannak, és hogyan futtatjuk őket.
// Két réteg:
//  - `executeTool`: a MI határvédelmünk (Zod + guard) — soha nem dob, a hibát is a modellnek
//    visszaadható szövegként adja vissza. Ez változatlan a 2–3. óra óta, és a tesztek is ezt fedik.
//  - `buildAiTools`: az AI SDK `tool()` definíciói — a séma, amit a modell lát. Az execute
//    ide van bekötve: AI SDK → executeTool → outcome. A modell PONTOSAN azt kapja vissza
//    (outcome.content), amit a kézi loopban is kapott.
// Új tool hozzáadása = új fájl ebben a mappában + felvétel az `executeTool` dispatchbe és a
// `buildAiTools` térképbe.

export {
  RUN_SQL_TOOL_NAME,
  RUN_SQL_DESCRIPTION,
  executeRunSql,
} from './run-sql.js';
export type { RunSqlOutcome } from './run-sql.js';
export {
  GET_CLIENT_PREFERENCES_TOOL_NAME,
  GET_CLIENT_PREFERENCES_DESCRIPTION,
  executeGetClientPreferences,
  CLIENT_PREFERENCES,
  CLIENT_CODES,
  CARE_LEVELS,
  type ClientCode,
  type CareLevel,
  type ClientPreference,
} from './client-preferences.js';
export { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';
export {
  runReadOnlyQuery,
  closeReadOnlyPool,
  type SqlResult,
} from './db-readonly.js';

/**
 * A modell egy toolt kért (name + input) → lefuttatjuk. Ismeretlen toolra hibát
 * adunk vissza (a modellnek visszaadható szövegként), NEM dobunk.
 */
export async function executeTool(
  name: string,
  input: unknown,
): Promise<RunSqlOutcome> {
  if (name === RUN_SQL_TOOL_NAME) {
    return executeRunSql(input);
  }
  if (name === GET_CLIENT_PREFERENCES_TOOL_NAME) {
    return executeGetClientPreferences(input);
  }
  return {
    content: `Ismeretlen tool: ${name}`,
    isError: true,
    executedSql: null,
    rowCount: null,
  };
}

/** A futás közben keletkező tool-eredmények megfigyelője (a Trace-nek). */
export type ToolOutcomeListener = (
  toolCallId: string,
  name: string,
  input: unknown,
  outcome: RunSqlOutcome,
) => void;

/**
 * Az AI SDK tool-készlete. A sémák szándékosan megengedőek (csak típus) — a SZIGORÚ
 * validáció az executeTool-ban marad (LLM-output megbízhatatlan → Zod a MI határunkon),
 * így a hibás bemenetre is a saját, magyar hibaszövegünk megy vissza a modellnek,
 * nem az SDK kivétele.
 */
export function buildAiTools(onOutcome?: ToolOutcomeListener): ToolSet {
  return {
    [RUN_SQL_TOOL_NAME]: tool({
      description: RUN_SQL_DESCRIPTION,
      inputSchema: z.object({
        query: z
          .string()
          .describe('A futtatandó SQL SELECT lekérdezés a products táblán.'),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeTool(RUN_SQL_TOOL_NAME, input);
        onOutcome?.(toolCallId, RUN_SQL_TOOL_NAME, input, outcome);
        return outcome.content; // a modell ugyanazt kapja, mint a kézi loopban
      },
    }),
    [GET_CLIENT_PREFERENCES_TOOL_NAME]: tool({
      description: GET_CLIENT_PREFERENCES_DESCRIPTION,
      inputSchema: z.object({
        clientCode: z
          .string()
          .describe('Az ügyfél kódja, amelyhez a preferenciákat kérjük.'),
      }),
      execute: async (input, { toolCallId }) => {
        const outcome = await executeTool(
          GET_CLIENT_PREFERENCES_TOOL_NAME,
          input,
        );
        onOutcome?.(toolCallId, GET_CLIENT_PREFERENCES_TOOL_NAME, input, outcome);
        return outcome.content;
      },
    }),
  };
}
