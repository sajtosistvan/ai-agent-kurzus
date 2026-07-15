import type { ToolSet } from 'ai';
import { buildQueryPrompt } from './query-prompt.js';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import { runSqlTool } from '../../tools/run-sql/run-sql-tool.js';
import { searchKnowledgeTool } from '../../tools/search-knowledge/search-knowledge-tool.js';
import { queryCustomersTool } from '../../tools/query-customers/query-customers-tool.js';
import { delegateToIngestTool } from '../../tools/delegate-to-ingest/delegate-to-ingest-tool.js';
import { CURRENT_ROLE, type UserRole, isAdmin } from '../../user-role/user-role.js';
import type { ToolReporter } from '../../tools/tool-outcome.js';

// query-agent.ts — a KÉRDÉS-VÁLASZ agent (a termék "ask" oldala). READ-ONLY: természetes
// nyelvű kérdésből SQL-t ír, lefuttatja, magyarul válaszol. Egy agent = prompt + toolok + loop:
//   prompt:  query-prompt.ts (szerep, séma, SQL-szabályok)
//   toolok:  runSql (read-only SELECT) + queryCustomers (ügyfél-profilok, Prismán át)
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

/** A query-agent toolkészlete SZEREP szerint. A prompt (buildQueryPrompt) és ez a függvény
 *  ugyanabból a role-értékből dolgozik — a kettő nem csúszhat el: amit a prompt leír, az a
 *  toolkészletben tényleg ott van, és fordítva. */
export function buildQueryToolset(
  role: UserRole,
  report?: ToolReporter,
  options: { print?: boolean } = {},
): ToolSet {
  return {
    runSql: runSqlTool(report),
    // A tudás-oldal: szöveges gondozási cikkek (RAG). A párja a runSql — a modell választ.
    searchKnowledge: searchKnowledgeTool(report),
    queryCustomers: queryCustomersTool(report),
    // Admin szerep → a MÁSIK agent tool-ként. Vásárlónál ez a kulcs nincs az objektumban.
    ...(isAdmin(role)
      ? { delegateToIngest: delegateToIngestTool(report, { print: options.print }) }
      : {}),
  };
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

  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildQueryPrompt(role),
      buildTools: (report): ToolSet =>
        buildQueryToolset(role, report, { print: options.print }),
      // Admin esetén a delegálás + a végső összegzés miatt kicsivel több kör kellhet.
      maxSteps: isAdmin(role) ? 8 : 6,
      // A RAG-válasz hosszabb: a katalógus-sorok MELLETT a tudásbázis-részletek összegzése és a
      // forrás-hivatkozások is beleférjenek (1024-nél félbevágódott).
      maxOutputTokens: 2500,
      emptyAnswer:
        'Nem sikerült végső választ adni a megengedett lépésszámon belül. Pontosítsd a kérdést.',
    },
    options,
  );
}
