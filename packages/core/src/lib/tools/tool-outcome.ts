// tool-outcome.ts — a KÖZÖS tool-eredmény alak. Minden tool execute-ja ezt adja vissza,
// és SOHA nem dob: a hiba is a modellnek visszaadható magyar szöveg (isError: true).
// Ettől tud a loop és a Trace BÁRMILYEN toolt egyformán kezelni.

export interface ToolOutcome {
  /** Amit a modell visszakap (a tool_result tartalma). EZ a közös lényeg. */
  content: string;
  isError: boolean;
  /** Egysoros humán összegzés a Trace-nek (pl. a guardolt SQL, vagy "UPSERT (created)"). */
  summary: string | null;
  /** Érintett sorok/találatok száma a Trace-nek (ha értelmezhető). */
  rowCount: number | null;
}

/** A tool ezzel jelenti a futását a Trace-nek (a modell csak a content-et látja,
 *  a Trace viszont a teljes outcome-ot megkapja). */
export type ToolReporter = (
  toolCallId: string,
  name: string,
  input: unknown,
  outcome: ToolOutcome,
) => void;
