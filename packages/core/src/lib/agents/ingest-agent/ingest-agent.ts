import type { ToolSet } from 'ai';
import { buildIngestPrompt } from './ingest-prompt.js';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import { runSqlTool } from '../../tools/run-sql/run-sql-tool.js';
import { fetchFeedTool } from '../../tools/fetch-feed/fetch-feed-tool.js';
import { upsertProductTool } from '../../tools/upsert-product/upsert-product-tool.js';

// ingest-agent.ts — a KATALÓGUS-KEZELŐ agent. Ugyanaz a loop, mint a query-agentnél, de MÁS a
// szerep és a toolkészlet: itt a modell OLVAS (runSql), feedet néz (fetchFeed) ÉS ÍR
// (upsertProduct). A read/write szétválasztás a tool-rétegben van: az írás egyetlen, szigorúan
// validált, latin-név-kulcsú upsert; nyers write-SQL nincs. Egy agent = prompt + toolok + loop:
//   prompt:  ingest-prompt.ts (szerkesztő szerep, normalizálási szabályok)
//   toolok:  runSql + fetchFeed (Shopify feed) + upsertProduct (az EGYETLEN írási út)
//   loop:    a közös agent-loop (agent-loop.ts)

export async function askIngestAgent(
  instruction: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const trimmed = instruction.trim();
  if (trimmed === '') {
    throw new Error('Üres utasítást nem lehet végrehajtani.');
  }

  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildIngestPrompt(),
      buildTools: (report): ToolSet => ({
        runSql: runSqlTool(report),
        fetchFeed: fetchFeedTool(report),
        upsertProduct: upsertProductTool(report),
      }),
      // Az ingest több lépés lehet: feed-olvasás → katalógus-ellenőrzés → írás.
      maxSteps: 8,
      // Az upsert tool-argumentuma (teljes termék) a modell OUTPUTJA — nagyobb keret kell.
      maxOutputTokens: 4096,
      emptyAnswer:
        'Nem sikerült befejezni a katalógus-módosítást a megengedett lépésszámon belül. Pontosítsd az utasítást.',
    },
    options,
  );
}
