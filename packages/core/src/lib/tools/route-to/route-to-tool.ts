import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// routeTo tool — az ORCHESTRATOR egyetlen toolja. Az orchestrator SOHA nem válaszol a
// felhasználónak: minden körben ezzel dönti el, melyik agent kapja a labdát. Az execute
// nem csinál semmit — a DÖNTÉS MAGA a tool-hívás (a reporter rögzíti, a szerver data-tool
// partként streameli, a flow-lock később ebből olvas). Jelzés = tool-hívás, nem szöveg.

const AGENTS = ['info-agent', 'package-agent'] as const;

const InputSchema = z.object({
  agent: z.enum(AGENTS),
  reason: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export function executeRouteTo(rawInput: unknown): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Érvénytelen routing-döntés. Az agent mező kötelező (${AGENTS.join(' | ')}), az indok (reason) nem lehet üres.`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { agent, reason } = parsed.data;
  return {
    content: `Irányítás: ${agent}.`,
    isError: false,
    summary: `routeTo → ${agent} (${clip(reason)})`,
    rowCount: null,
  };
}

export const routeToTool = (report?: ToolReporter) =>
  tool({
    description:
      'Döntés: melyik agent dolgozzon a felhasználó üzenetén. info-agent: adat- és tudás-kérdések ' +
      '(katalógus, árak, készlet, gondozás). package-agent: ügyfél-csomag összeállítása, módosítása, ' +
      'mentése vagy lemondása. MINDIG pontosan egyszer hívd, magyar indoklással.',
    inputSchema: z.object({
      agent: z.enum(AGENTS).describe('A cél-agent.'),
      reason: z.string().describe('Rövid magyar indoklás — a demó trace-ében ez látszik.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeRouteTo(input);
      report?.(toolCallId, 'routeTo', input, outcome);
      return outcome.content;
    },
  });
