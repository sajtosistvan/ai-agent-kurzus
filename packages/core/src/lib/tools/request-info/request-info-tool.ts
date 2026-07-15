import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// requestInfo tool — a ROUTER mód „kapcsa”. Az execute ÜRES abban az értelemben, hogy nem
// futtat semmit: csak RÖGZÍTI a csomag-agent adat-kérdését (onRequestInfo callback), és az
// agent köre lezárul. Az orchestrator-réteg (router-handover.ts) látja a rögzített kérést,
// meghívja az info-agentet, és a válaszával folytatja a csomag-agent körét. A csomag-agent
// így NEM tud az info-agentről — csak az orchestrator ismeri mindkettőt.

const InputSchema = z.object({
  question: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export function executeRequestInfo(
  rawInput: unknown,
  deps: { onRequestInfo?: (question: string) => void } = {},
): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: 'Az adat-kérdés nem lehet üres. Fogalmazd meg pontosan, mit szeretnél megtudni.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  deps.onRequestInfo?.(parsed.data.question);
  return {
    content:
      'A kérdést továbbítottam az adat-szolgáltatónak — a válasz a következő körödben érkezik. ' +
      'Most zárd le a köröd egy rövid mondattal (pl. „utánanézek”), NE találgass adatot.',
    isError: false,
    summary: `requestInfo — „${clip(parsed.data.question)}”`,
    rowCount: null,
  };
}

export const requestInfoTool = (
  report?: ToolReporter,
  deps: { onRequestInfo?: (question: string) => void } = {},
) =>
  tool({
    description:
      'Adat-kérés a katalógusról vagy a tudásbázisról (árak, készlet, fényigény, gondozás). ' +
      'Neked NINCS közvetlen adatbázis-hozzáférésed — minden tény-adatot ezzel kérj. ' +
      'Egy hívás = egy pontos, magyar kérdés.',
    inputSchema: z.object({
      question: z.string().describe('A pontos adat-kérdés magyarul.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeRequestInfo(input, deps);
      report?.(toolCallId, 'requestInfo', input, outcome);
      return outcome.content;
    },
  });
