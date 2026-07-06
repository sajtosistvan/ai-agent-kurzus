import type { ToolSet } from 'ai';
import { buildQueryPrompt } from './query-prompt.js';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import { runSqlTool } from '../../tools/run-sql/run-sql-tool.js';
import { getClientPreferencesTool } from '../../tools/get-client-preferences/get-client-preferences-tool.js';

// query-agent.ts — a KÉRDÉS-VÁLASZ agent (a termék "ask" oldala). READ-ONLY: természetes
// nyelvű kérdésből SQL-t ír, lefuttatja, magyarul válaszol. Egy agent = prompt + toolok + loop:
//   prompt:  query-prompt.ts (szerep, séma, SQL-szabályok)
//   toolok:  runSql (read-only SELECT) + getClientPreferences (ügyfél-preferenciák)
//   loop:    a közös agent-loop (agent-loop.ts)

export async function askAgent(
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres kérdést nem lehet feltenni.');
  }

  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildQueryPrompt(),
      buildTools: (report): ToolSet => ({
        runSql: runSqlTool(report),
        getClientPreferences: getClientPreferencesTool(report),
      }),
      maxSteps: 6,
      maxOutputTokens: 1024,
      emptyAnswer:
        'Nem sikerült végső választ adni a megengedett lépésszámon belül. Pontosítsd a kérdést.',
    },
    options,
  );
}
