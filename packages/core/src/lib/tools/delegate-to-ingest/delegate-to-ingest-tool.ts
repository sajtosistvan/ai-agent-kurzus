import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import type { AskOptions, AskResult } from '../../agents/agent-loop.js';
import { askIngestAgent } from '../../agents/ingest-agent/ingest-agent.js';

// delegateToIngest tool — a MULTI-AGENT kapocs. A query-agent (az "ask" oldal) READ-ONLY:
// SQL-t nem írhat, a katalógust nem módosíthatja. Ez a tool átad egy természetes nyelvű
// katalógus-módosítást a MÁSIK agentnek (ingest-agent), lefuttatja annak SAJÁT loopját
// (fetchFeed → runSql → upsertProduct), és annak összegzését adja vissza a query-agentnek.
//
// Vagyis: egy agent egy másik agentet hív TOOLKÉNT. A tool execute-ja csak elindítja a
// beágyazott agent-loopot. A beágyazott agent a saját színes trace-ét is kiírja (print
// öröklődik), így a demón LÁTSZIK a két agent egymásba ágyazott futása — egy tool-hívás
// mögött egy teljes második agent dolgozik.
//
// Ezt a toolt CSAK admin szerep kapja meg (lásd user-role.ts): vásárló nem módosíthat katalógust.

/** Amivel az ingest-agentet futtatjuk. Teszthez injektálható; alapból az igazi askIngestAgent. */
export type IngestRunner = (
  instruction: string,
  options?: AskOptions,
) => Promise<AskResult>;

const InputSchema = z.object({
  instruction: z.string().trim().min(1),
});

/** Egy sorba tördelt, levágott utasítás a Trace-összegzéshez. */
function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

/** Validál, majd LEFUTTATJA az ingest-agentet az utasítással. Soha nem dob: az üres bemenetet
 *  és a beágyazott agent hibáját is magyar ToolOutcome-ként adja vissza. */
export async function executeDelegateToIngest(
  rawInput: unknown,
  deps: { run?: IngestRunner; print?: boolean } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: 'Az ingest-agentnek adott utasítás nem lehet üres.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }

  const run = deps.run ?? askIngestAgent;
  try {
    const result = await run(parsed.data.instruction, { print: deps.print });
    return {
      content: result.answer,
      isError: false,
      summary: `ingest-agent ← "${clip(parsed.data.instruction)}"`,
      rowCount: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Az ingest-agent nem tudta végrehajtani a módosítást: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

/** A modell-felé eső tool-definíció. Bekötés a query-agentbe: egy sor a toolset-ben (csak admin). */
export const delegateToIngestTool = (
  report?: ToolReporter,
  options: { print?: boolean } = {},
) =>
  tool({
    description:
      'Katalógus MÓDOSÍTÁS átadása a katalógus-kezelő (ingest) agentnek. Te magad nem tudsz ' +
      'írni a katalógusba (a runSql csak SELECT). Ha a felhasználó terméket akar FELVENNI, ' +
      'FRISSÍTENI (ár, akció, készlet, leírás, gondozás) vagy webshop-feedből behozni, ezzel ' +
      'a toollal add át a feladatot. Az instruction a másik agentnek szóló, világos, magyar ' +
      'utasítás (melyik termék, mit változtass). A tool visszaadja az ingest-agent összegzését.',
    inputSchema: z.object({
      instruction: z
        .string()
        .describe(
          'Természetes nyelvű utasítás az ingest-agentnek: melyik terméket és mit módosítson.',
        ),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeDelegateToIngest(input, {
        print: options.print,
      });
      report?.(toolCallId, 'delegateToIngest', input, outcome);
      return outcome.content;
    },
  });
