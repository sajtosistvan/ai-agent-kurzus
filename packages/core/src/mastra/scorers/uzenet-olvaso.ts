import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';

// Kis olvasó-segédek a scorerekhez: az agent kimenete üzenetek tömbje, minket ebből
// csak a szöveg és a tool-hívások (nevük + eredményük) érdekelnek.
// Azért van külön fájlban, hogy a scorerek maguk rövidek és olvashatóak maradjanak.

/** Egy lefutott tool-hívás a scorerek szempontjából. */
export type ToolHivas = {
  nev: string;
  eredmeny: unknown;
};

/** Az asszisztens összes szöveges részének összefűzése (ez a „válasz”). */
export const valaszSzoveg = (output: ScorerRunOutputForAgent): string =>
  output
    .filter((uzenet) => uzenet.role === 'assistant')
    .flatMap((uzenet) => uzenet.content.parts)
    .filter((resz): resz is { type: 'text'; text: string } => resz.type === 'text')
    .map((resz) => resz.text)
    .join('\n')
    .trim();

/** A futás során meghívott toolok — névvel és a visszaadott (strukturált) eredménnyel. */
export const toolHivasok = (output: ScorerRunOutputForAgent): ToolHivas[] =>
  output
    .flatMap((uzenet) => uzenet.content.parts)
    .filter((resz) => resz.type === 'tool-invocation')
    .map((resz) => (resz as { toolInvocation?: { toolName?: string; result?: unknown } }).toolInvocation)
    .filter((hivas): hivas is { toolName: string; result?: unknown } => Boolean(hivas?.toolName))
    .map((hivas) => ({ nev: hivas.toolName, eredmeny: hivas.result }));

/** Csak a meghívott toolok nevei. */
export const hivottToolok = (output: ScorerRunOutputForAgent): string[] =>
  toolHivasok(output).map((hivas) => hivas.nev);

/** Igaz, ha a tool neve tartalmazza a minták bármelyikét (részlet-egyezés, kisbetűsítve). */
export const toolNevIllik = (nev: string, mintak: readonly string[]): boolean =>
  mintak.some((minta) => nev.toLowerCase().includes(minta));

/** A felhasználó utolsó kérdése sima szövegként. */
export const utolsoKerdes = (input?: ScorerRunInputForAgent): string => {
  const utolso = [...(input?.inputMessages ?? [])].reverse().find((uzenet) => uzenet.role === 'user');

  return (
    utolso?.content.parts
      .filter((resz): resz is { type: 'text'; text: string } => resz.type === 'text')
      .map((resz) => resz.text)
      .join(' ')
      .trim() ?? ''
  );
};
