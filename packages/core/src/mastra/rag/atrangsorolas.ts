import { rerank, type RerankResult } from '@mastra/rag';
import { ModelRouterLanguageModel } from '@mastra/core/llm';
import type { QueryResult } from '@mastra/core/vector';

// atrangsorolas.ts — ÁTRANGSOROLÁS (rerank). Miért kell, ha már van vektor-hasonlóság?
//
// A vektor-hasonlóság OLCSÓ, de BUTA: egyetlen számba sűríti a teljes jelentést, és nem tudja,
// mit KÉRDEZTÉL. A "hogyan mentsem meg a túlöntözött monsterát?" kérdéshez a "monstera öntözése"
// chunk vektorban közel van — de a valódi válasz a "gyökérrothadás kezelése" chunkban van,
// ami vektorban távolabb esik, mert más szavakkal beszél ugyanarról a bajról.
//
// KÉTLÉPCSŐS KERESÉS:
//   1. TÁG HÁLÓ: 20 chunk vektor-hasonlósággal (olcsó, gyors, elnéző),
//   2. ÁTRANGSOROLÁS: egy KIS, OLCSÓ modell elolvassa a 20 darabot a kérdés fényében.
//
// EZT MÁR NEM MI ÍRJUK: a `@mastra/rag` `rerank()`-je csinálja. Három jelet súlyoz össze —
// szemantikai pontszám (a kis modell ítélete), vektor-hasonlóság és eredeti pozíció.
//
// ROUTING, kézzelfoghatóan: a rangsorolás Claude Haiku (kicsi, gyors, olcsó),
// a VÁLASZ Claude Sonnet (nagy, drága). Mindkettő azt csinálja, amiben jó.

const ATRANGSOROLO_MODELL = 'anthropic/claude-haiku-4-5';

let modell: ModelRouterLanguageModel | null = null;

function getModell(): ModelRouterLanguageModel {
  if (!modell) {
    modell = new ModelRouterLanguageModel(ATRANGSOROLO_MODELL);
  }
  return modell;
}

/**
 * A tág háló átrangsorolása a kérdés fényében, kis modellel. Hiba esetén NEM dobunk:
 * visszaadjuk az eredeti (vektor-hasonlóság szerinti) sorrendet — a keresés sose álljon meg.
 */
export async function atrangsorol(
  kerdes: string,
  talalatok: QueryResult[],
  megtart: number,
): Promise<RerankResult[]> {
  if (talalatok.length === 0) {
    return [];
  }
  try {
    return await rerank(talalatok, kerdes, getModell(), { topK: megtart });
  } catch {
    // A reranker kiesett (hálózat, kvóta) — a vektorsorrend így is használható.
    return talalatok.slice(0, megtart).map((talalat) => ({
      result: talalat,
      score: talalat.score,
      details: { semantic: 0, vector: talalat.score, position: 0 },
    }));
  }
}
