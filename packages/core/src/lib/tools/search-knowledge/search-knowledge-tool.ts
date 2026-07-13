import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { retrieveKnowledge } from '../../rag/retrieve.js';

// searchKnowledge tool — a QUERY-agent ezzel keres a bolt SZÖVEGES tudásában (gondozási cikkek).
//
// A PÁRJA a runSql: ugyanaz az agent, két különböző tudásforrás.
//   runSql          → TÉNYEK a katalógusból:  "van-e készleten?", "mennyibe kerül?", "mekkora?"
//   searchKnowledge → TUDÁS a cikkekből:      "miért sárgul?", "hogyan öntözzem?", "mit tegyek, ha…"
//
// És a lényeg: NEM MI döntjük el, melyiket hívja. A modell dönt, a leírás alapján. Ha jó a
// leírás, jól választ; ha rossz, rosszul — ezért a tool-leírás is prompt-mérnökség.

const InputSchema = z.object({ question: z.string().min(1) });

/** validál → retrieval (embed + vektorkeresés + rerank) → szövegesít. Soha nem dob. */
export async function executeSearchKnowledge(
  rawInput: unknown,
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Hibás tool-bemenet: ${parsed.error.issues[0]?.message ?? 'ismeretlen'}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }

  try {
    const { hits } = await retrieveKnowledge(parsed.data.question);

    if (hits.length === 0) {
      return {
        content:
          'A tudásbázisban nincs erre vonatkozó részlet. Mondd meg a felhasználónak, hogy erről nincs információd.',
        isError: false,
        summary: `nincs találat: "${parsed.data.question}"`,
        rowCount: 0,
      };
    }

    // A modell EZT kapja: a chunkok szövege, mindegyik a FORRÁSÁVAL. A forrás nem dísz —
    // a system prompt kötelezi a modellt, hogy hivatkozzon rá (grounding, lásd query-prompt.ts).
    const payload = hits.map((hit) => ({
      title: hit.title,
      source: hit.source,
      content: hit.content,
      distance: Number(hit.distance.toFixed(3)),
    }));

    return {
      content: JSON.stringify({ results: payload }),
      isError: false,
      summary: `${hits.length} részlet · legjobb: ${hits[0]?.title ?? '-'} (dist ${hits[0]?.distance.toFixed(3)})`,
      rowCount: hits.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Tudásbázis-hiba: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

// A modellnek szóló szövegek EGY BLOKKBAN, template literálként — nem darabolva, nem ' + '-szal
// összefűzve. Így úgy olvasod és szerkeszted, ahogy a modell látja (ugyanez az elv a promptoknál).
const DESCRIPTION = `
Keres a bolt gondozási tudásbázisában: növénygondozási cikkek, kártevők, betegségek,
öntözés, fény, átültetés, évszakos teendők.

EZT használd minden "hogyan / miért / mit tegyek" jellegű kérdésnél.
A katalógus TÉNYEIHEZ (ár, készlet, méret) ne ezt használd, hanem a runSql-t.

A találatok forrás-URL-t is tartalmaznak — a válaszban hivatkozz rájuk.
`.trim();

const QUESTION_PARAM = `
A felhasználó kérdése, természetes nyelven, ahogy elhangzott (ne alakítsd kulcsszavakká).
`.trim();

/** A modell-felé eső tool-definíció. A LEÍRÁS tanítja meg a modellt, mikor nyúljon ide. */
export const searchKnowledgeTool = (report?: ToolReporter) =>
  tool({
    description: DESCRIPTION,
    inputSchema: z.object({
      question: z.string().describe(QUESTION_PARAM),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeSearchKnowledge(input);
      report?.(toolCallId, 'searchKnowledge', input, outcome);
      return outcome.content;
    },
  });
