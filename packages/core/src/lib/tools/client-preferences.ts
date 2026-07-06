import { z } from 'zod';
import type { RunSqlOutcome } from './run-sql.js';

// A getClientPreferences tool: ügyfélkód alapján adja vissza az ügyfél preferenciáit —
// a büdzsét (Ft) és a preferált növény-IGÉNYESSÉGET (mennyire gondozásigényes növényt szeret).
// A CLIENT_PREFERENCES az EGYETLEN forrás — ebből származik a leírásban felsorolt kódlista ÉS
// a Zod-guard is, így a kettő nem csúszhat el. A kimenet a runSql-lel közös outcome alakot
// követi, hogy a loop és a Trace változatlanul kezelje. A modell-felé eső séma (AI SDK
// `tool()`) a tools/index.ts-ben áll össze.

export const GET_CLIENT_PREFERENCES_TOOL_NAME = 'getClientPreferences';

/** A növény gondozási igényessége — ennyire gondozásigényes növényt preferál az ügyfél. */
export const CARE_LEVELS = ['ALACSONY', 'KÖZEPES', 'MAGAS'] as const;
export type CareLevel = (typeof CARE_LEVELS)[number];

export interface ClientPreference {
  /** Rendelkezésre álló büdzsé forintban. */
  budget: number;
  /** A preferált növény igényessége (gondozási igény). */
  careLevel: CareLevel;
}

/** Ügyfélkód → preferenciák. Egyelőre fix tábla; később jöhet mögé config/DB. Innen bővíthető. */
export const CLIENT_PREFERENCES = {
  ACME: { budget: 1000, careLevel: 'ALACSONY' },
  GLOBEX: { budget: 5000, careLevel: 'KÖZEPES' },
  INITECH: { budget: 250000, careLevel: 'MAGAS' },
} as const satisfies Record<string, ClientPreference>;

export type ClientCode = keyof typeof CLIENT_PREFERENCES;

/** Az enum értékei — a térkép kulcsaiból, nem duplikálva. Nem üres tuple a z.enum kedvéért. */
export const CLIENT_CODES = Object.keys(CLIENT_PREFERENCES) as [
  ClientCode,
  ...ClientCode[],
];

export const GET_CLIENT_PREFERENCES_DESCRIPTION =
  'Visszaadja egy adott ügyfél preferenciáit: a büdzsét forintban és a preferált növény ' +
  'igényességét (ALACSONY | KÖZEPES | MAGAS gondozási igény). A clientCode a kötelező ' +
  `ügyfélkód. Csak ezek az ügyfélkódok érvényesek: ${CLIENT_CODES.join(' | ')}.`;

const InputSchema = z.object({ clientCode: z.enum(CLIENT_CODES) });

/** A tool-hívás végrehajtása: validál (ismeretlen ügyfélkód → hiba), majd a térképből
 *  visszaadja a preferenciákat JSON-ként. Soha nem dob; a kimenet a runSql-lel közös outcome
 *  alakot követi. */
export async function executeGetClientPreferences(
  rawInput: unknown,
): Promise<RunSqlOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        `Ismeretlen vagy hiányzó ügyfélkód. Érvényes kódok: ` +
        CLIENT_CODES.join(', '),
      isError: true,
      executedSql: null,
      rowCount: null,
    };
  }

  const preference = CLIENT_PREFERENCES[parsed.data.clientCode];
  return {
    content: JSON.stringify(preference),
    isError: false,
    executedSql: null,
    rowCount: null,
  };
}
