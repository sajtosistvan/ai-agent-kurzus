import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// cancelPackage tool — a flow-ból való kilépés EGYIK útja (a másik a sikeres savePackage).
// Az execute csak nyugtáz és RÖGZÍT: a lemondás ténye a tool-hívás maga — a reporter viszi a
// Trace-be és a data-tool partba, a flow-lock (findLastFlowSignal) EBBŐL látja, hogy a flow
// lezárult. Nincs DB-írás: a le nem zárt csomagterv csak a beszélgetésben élt.

const InputSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

export function executeCancelPackage(rawInput: unknown): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  const reason = parsed.success ? parsed.data.reason : undefined;
  return {
    content:
      'A csomag-összeállítást lemondtuk, semmi nem került mentésre. ' +
      'Nyugtázd a felhasználónak egy mondatban, és jelezd, hogy bármikor újrakezdhetitek.',
    isError: false,
    summary: `cancelPackage — ${reason ?? 'a felhasználó lemondta'}`,
    rowCount: null,
  };
}

export const cancelPackageTool = (report?: ToolReporter) =>
  tool({
    description:
      'A csomag-összeállítás LEMONDÁSA. Akkor hívd, ha a felhasználó kifejezetten lemondja ' +
      'a csomagot (nem kéri, elhalasztja, meggondolta magát). Ez zárja le a csomag-flow-t ' +
      'mentés nélkül.',
    inputSchema: z.object({
      reason: z.string().optional().describe('Rövid magyar indok, ha a felhasználó mondott.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeCancelPackage(input);
      report?.(toolCallId, 'cancelPackage', input, outcome);
      return outcome.content;
    },
  });
