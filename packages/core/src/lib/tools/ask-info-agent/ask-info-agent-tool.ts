import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import type { AskResult } from '../../agents/agent-loop.js';
import { askAgent, type QueryAskOptions } from '../../agents/query-agent/query-agent.js';

// askInfoAgent tool — a DELEGATE mód „kapcsa”, a delegateToIngest mintájára: a csomag-agent
// EGY TOOL-HÍVÁS mögött a TELJES info-agentet (a meglévő query-agent) futtatja le, és annak
// összegzését kapja vissza. Az adat-kérés NEM hagyja el a csomag-agent körét — nincs
// orchestrator-közvetítés. KONTRASZT a requestInfo-val: ugyanaz a tool-felület (kérdés be,
// válasz vissza), csak az execute más — ez a demó egy mondata.

export type InfoRunner = (
  question: string,
  options?: QueryAskOptions,
) => Promise<AskResult>;

const InputSchema = z.object({
  question: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

/** Validál, majd LEFUTTATJA az info-agentet (query-agent) a kérdéssel. Soha nem dob: az üres
 *  bemenetet és a beágyazott agent hibáját is magyar ToolOutcome-ként adja vissza. */
export async function executeAskInfoAgent(
  rawInput: unknown,
  deps: { run?: InfoRunner; print?: boolean; onToolEvent?: ToolReporter } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: 'Az info-agentnek adott kérdés nem lehet üres.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const run = deps.run ?? askAgent;
  try {
    // A beágyazott loop tool-eseményei az onToolEvent-en át jutnak ki — delegate módban a
    // UI ezekből rajzolja a BEHÚZOTT chipeket a csomag-agent chipje alatt.
    const result = await run(parsed.data.question, {
      role: 'customer',
      print: deps.print,
      onToolEvent: deps.onToolEvent,
    });
    return {
      content: result.answer,
      isError: false,
      summary: `info-agent ← „${clip(parsed.data.question)}”`,
      rowCount: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Az info-agent nem tudott válaszolni: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

/** A modell-felé eső tool-definíció. FIGYELEM: a description szándékosan (majdnem) azonos a
 *  requestInfoTool-éval — a kontraszt-mondat: ugyanaz a tool-felület, csak az execute más. */
export const askInfoAgentTool = (
  report?: ToolReporter,
  options: { print?: boolean; onToolEvent?: ToolReporter } = {},
) =>
  tool({
    description:
      'Adat-kérés a katalógusról vagy a tudásbázisról (árak, készlet, fényigény, gondozás). ' +
      'Neked NINCS közvetlen adatbázis-hozzáférésed — minden tény-adatot ezzel kérj. ' +
      'Egy hívás = egy pontos, magyar kérdés; a tool a válasz összegzését adja vissza.',
    inputSchema: z.object({
      question: z.string().describe('A pontos adat-kérdés magyarul.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeAskInfoAgent(input, {
        print: options.print,
        onToolEvent: options.onToolEvent,
      });
      report?.(toolCallId, 'askInfoAgent', input, outcome);
      return outcome.content;
    },
  });
