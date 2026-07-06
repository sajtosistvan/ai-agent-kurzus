import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// getClientPreferences tool — ügyfélkód alapján adja vissza az ügyfél preferenciáit:
// a büdzsét (Ft) és a preferált növény-IGÉNYESSÉGET (gondozási igény).
// A CLIENT_PREFERENCES az EGYETLEN forrás: ebből származik a leírásban felsorolt kódlista
// ÉS a Zod-guard is, így a kettő nem csúszhat el.

/** A növény gondozási igényessége — ennyire gondozásigényes növényt preferál az ügyfél. */
export const CARE_LEVELS = ['ALACSONY', 'KÖZEPES', 'MAGAS'] as const;
export type CareLevel = (typeof CARE_LEVELS)[number];

export interface ClientPreference {
  /** Rendelkezésre álló büdzsé forintban. */
  budget: number;
  /** A preferált növény igényessége (gondozási igény). */
  careLevel: CareLevel;
}

/** Ügyfélkód → preferenciák. Egyelőre fix tábla; később jöhet mögé config/DB. */
export const CLIENT_PREFERENCES = {
  ACME: { budget: 1000, careLevel: 'ALACSONY' },
  GLOBEX: { budget: 5000, careLevel: 'KÖZEPES' },
  INITECH: { budget: 250000, careLevel: 'MAGAS' },
} as const satisfies Record<string, ClientPreference>;

export type ClientCode = keyof typeof CLIENT_PREFERENCES;

/** Az érvényes kódok — a térkép kulcsaiból, nem duplikálva. */
export const CLIENT_CODES = Object.keys(CLIENT_PREFERENCES) as [
  ClientCode,
  ...ClientCode[],
];

const InputSchema = z.object({ clientCode: z.enum(CLIENT_CODES) });

/** validál (ismeretlen kód → magyar hiba), majd a térképből visszaadja a preferenciákat. */
export async function executeGetClientPreferences(
  rawInput: unknown,
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        `Ismeretlen vagy hiányzó ügyfélkód. Érvényes kódok: ` +
        CLIENT_CODES.join(', '),
      isError: true,
      summary: null,
      rowCount: null,
    };
  }

  const preference = CLIENT_PREFERENCES[parsed.data.clientCode];
  return {
    content: JSON.stringify(preference),
    isError: false,
    summary: `${parsed.data.clientCode} · keret ${preference.budget} Ft · ${preference.careLevel}`,
    rowCount: null,
  };
}

/** A modell-felé eső tool-definíció. Bekötés az agentbe: egy sor a toolset-ben. */
export const getClientPreferencesTool = (report?: ToolReporter) =>
  tool({
    description:
      'Visszaadja egy adott ügyfél preferenciáit: a büdzsét forintban és a preferált növény ' +
      'igényességét (ALACSONY | KÖZEPES | MAGAS gondozási igény). A clientCode a kötelező ' +
      `ügyfélkód. Csak ezek az ügyfélkódok érvényesek: ${CLIENT_CODES.join(' | ')}.`,
    inputSchema: z.object({
      clientCode: z
        .string()
        .describe('Az ügyfél kódja, amelyhez a preferenciákat kérjük.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeGetClientPreferences(input);
      report?.(toolCallId, 'getClientPreferences', input, outcome);
      return outcome.content;
    },
  });
