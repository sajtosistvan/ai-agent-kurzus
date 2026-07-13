import { generateObject } from 'ai';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import type { KnowledgeHit } from './knowledge-store.js';

// rerank.ts — ÁTRANGSOROLÁS. Miért kell, ha már van vektortávolság?
//
// A vektortávolság OLCSÓ, de BUTA: egyetlen számba sűríti a teljes jelentést, és nem tudja,
// mit KÉRDEZTÉL. A "hogyan mentsem meg a túlöntözött monsterát?" kérdéshez a "monstera öntözése"
// chunk vektorban közel van — de a valódi válasz a "gyökérrothadás kezelése" chunkban van,
// ami vektorban távolabb esik, mert más szavakkal beszél ugyanarról a bajról.
//
// A MEGOLDÁS kétlépcsős keresés:
//   1. TÁG HÁLÓ: hozz be 20 chunkot vektortávolsággal (olcsó, gyors, elnéző).
//   2. ÁTRANGSOROLÁS: egy KIS, OLCSÓ modell elolvassa a 20 darabot a kérdés fényében,
//      és pontozza őket 0-10-ig. Ebből tartjuk meg az 5 legjobbat.
//
// Ez egyben a ROUTING legkézzelfoghatóbb esete: a rangsorolás Claude Haiku (kicsi, gyors, olcsó),
// a válasz Claude Sonnet (nagy, drága). Mindkettő azt csinálja, amiben jó.

const RERANK_MODEL = 'claude-haiku-4-5';

// A modellnek szóló szöveg EGY BLOKKBAN — úgy szerkeszted, ahogy a modell látja.
const RERANK_PROMPT = `
Te egy kereső-átrangsoroló vagy.

Pontozd 0-10-ig, hogy az egyes részletek mennyire válaszolják meg a felhasználó kérdését.
Minden részletet pontozz, a sorszámára hivatkozva.

A magas pont KONKRÉT, a kérdésre vonatkozó választ jelent — nem témabeli rokonságot.
`.trim();

let provider: AnthropicProvider | null = null;
function getModel() {
  if (!provider) {
    provider = createAnthropic({ apiKey: loadConfig().apiKey });
  }
  return provider(RERANK_MODEL);
}

const ScoresSchema = z.object({
  scores: z.array(
    z.object({
      index: z.number().describe('A részlet sorszáma (0-tól).'),
      score: z
        .number()
        .describe('0-10: mennyire válaszolja meg EZ a részlet a kérdést.'),
    }),
  ),
});

export interface RerankedHit extends KnowledgeHit {
  /** A reranker pontszáma 0-10. Ezt is kiírjuk a demóban, a távolság MELLETT. */
  score: number;
}

/**
 * A találatok átrangsorolása a kérdés fényében, kis modellel. Hiba esetén nem dobunk:
 * visszaadjuk az eredeti (vektortávolság szerinti) sorrendet — a retrieval sose álljon meg.
 */
export async function rerankHits(
  question: string,
  hits: KnowledgeHit[],
  keepTop: number,
): Promise<RerankedHit[]> {
  if (hits.length === 0) {
    return [];
  }

  const numbered = hits
    .map((hit, i) => `[${i}] ${hit.title}\n${hit.content.slice(0, 600)}`)
    .join('\n\n---\n\n');

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: ScoresSchema,
      system: RERANK_PROMPT,
      prompt: `KÉRDÉS: ${question}\n\nRÉSZLETEK:\n\n${numbered}`,
    });

    const scoreByIndex = new Map(
      object.scores.map((s) => [s.index, s.score] as const),
    );

    return hits
      .map((hit, i) => ({ ...hit, score: scoreByIndex.get(i) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, keepTop);
  } catch {
    // A reranker kiesett (hálózat, kvóta) — a vektorsorrend így is használható.
    return hits.slice(0, keepTop).map((hit) => ({ ...hit, score: -1 }));
  }
}
