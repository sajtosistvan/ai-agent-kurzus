import type Anthropic from '@anthropic-ai/sdk';
import { runSqlTool, executeRunSql, type RunSqlOutcome } from './run-sql.js';

// A modell-felé eső tool-felület: MILYEN toolok vannak, és hogyan futtatjuk őket.
// Új tool hozzáadása = új fájl ebben a mappában + felvétel a `tools` tömbbe és az
// `executeTool` dispatchbe (pl. a 4. órán).

export { runSqlTool, executeRunSql } from './run-sql.js';
export type { RunSqlOutcome } from './run-sql.js';
export { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';
export {
  runReadOnlyQuery,
  closeReadOnlyPool,
  type SqlResult,
} from './db-readonly.js';

export const tools: Anthropic.Tool[] = [runSqlTool];

/**
 * A modell egy toolt kért (name + input) → lefuttatjuk. Ismeretlen toolra hibát
 * adunk vissza (a modellnek visszaadható szövegként), NEM dobunk.
 */
export async function executeTool(
  name: string,
  input: unknown,
): Promise<RunSqlOutcome> {
  if (name === runSqlTool.name) {
    return executeRunSql(input);
  }
  return {
    content: `Ismeretlen tool: ${name}`,
    isError: true,
    executedSql: null,
    rowCount: null,
  };
}
