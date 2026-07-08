import type { ToolSet } from 'ai';
import { buildQueryPrompt } from './query-prompt.js';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import { runSqlTool } from '../../tools/run-sql/run-sql-tool.js';
import { getClientPreferencesTool } from '../../tools/get-client-preferences/get-client-preferences-tool.js';
import { delegateToIngestTool } from '../../tools/delegate-to-ingest/delegate-to-ingest-tool.js';
import { CURRENT_ROLE, type UserRole } from '../../user-role/user-role.js';

// query-agent.ts — a KÉRDÉS-VÁLASZ agent (a termék "ask" oldala). READ-ONLY: természetes
// nyelvű kérdésből SQL-t ír, lefuttatja, magyarul válaszol. Egy agent = prompt + toolok + loop:
//   prompt:  query-prompt.ts (szerep, séma, SQL-szabályok)
//   toolok:  runSql (read-only SELECT) + getClientPreferences (ügyfél-preferenciák)
//            + admin szerepnél: delegateToIngest (a MÁSIK agent tool-ként — multi-agent)
//   loop:    a közös agent-loop (agent-loop.ts)
//
// A SZEREP kapcsol képességet: adminként a modell megkapja a delegateToIngest toolt, amivel
// katalógus-módosítást ad át az ingest-agentnek. Vásárlónál ez a tool nincs a toolkészletben —
// a trace `tools: [...]` sorában is ez látszik. A szerep alapból a CURRENT_ROLE (user-role.ts),
// a `role` opcióval felül lehet írni (pl. tesztben vagy a webes rétegben).

export interface QueryAskOptions extends AskOptions {
  /** KI kérdez: 'customer' vagy 'admin'. Admin megkapja a delegateToIngest toolt. Alap: CURRENT_ROLE. */
  role?: UserRole;
}

export async function askAgent(
  question: string,
  options: QueryAskOptions = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres kérdést nem lehet feltenni.');
  }

  const role = options.role ?? CURRENT_ROLE;
  // Web deploy: admin delegálás ideiglenesen kikapcsolva, amíg a webes rétegben nincs role-választó UI.
  const admin = false;

  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildQueryPrompt(role),
      buildTools: (report): ToolSet => ({
        runSql: runSqlTool(report),
        getClientPreferences: getClientPreferencesTool(report),
        // Admin szerep → a MÁSIK agent tool-ként. Vásárlónál ez a kulcs nincs az objektumban.
        ...(admin
          ? {
              delegateToIngest: delegateToIngestTool(report, {
                print: options.print,
              }),
            }
          : {}),
      }),
      // Admin esetén a delegálás + a végső összegzés miatt kicsivel több kör kellhet.
      maxSteps: admin ? 8 : 6,
      maxOutputTokens: 1024,
      emptyAnswer:
        'Nem sikerült végső választ adni a megengedett lépésszámon belül. Pontosítsd a kérdést.',
    },
    options,
  );
}
