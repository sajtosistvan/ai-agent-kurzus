import { embed, embedMany } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { loadConfig } from '../../lib/config.js';

// beagyazas.ts — a VEKTORIZÁLÁS (embedding). Szöveg → számok listája.
//
// MI EZ VALÓJÁBAN? Egy modell, ami minden szöveghez egy pontot rendel egy sok-dimenziós térben
// (nálunk 1536 dimenzió). Ami HASONLÓAN HASZNÁLT, az kerül egymás mellé — tehát nem a betűk
// hasonlítanak, hanem a JELENTÉS. Ezért működik a keresés: a KÉRDÉST is ugyanezzel a modellel
// vektorizáljuk, és megnézzük, melyik chunk pontja van hozzá a legközelebb.
//
// MULTI-PROVIDER ROUTING (ez a réteg tanulsága): a beágyazás OpenAI-jal megy (olcsó, gyors),
// a VÁLASZT viszont Anthropic Claude írja. Olcsó modell keres, drága modell válaszol.
//
// FONTOS: a kérdést és a dokumentumokat UGYANAZZAL a modellel kell beágyazni, különben nem
// összemérhetők. Ha modellt váltasz, újra kell vektorizálni az egész tudásbázist.

const MODELL = 'text-embedding-3-small'; // 1536 dimenzió, olcsó: ~1 cent / 500 ezer token

let provider: OpenAIProvider | null = null;

function getModell() {
  if (!provider) {
    provider = createOpenAI({ apiKey: loadConfig().openaiApiKey });
  }
  return provider.embedding(MODELL);
}

/** Egy szöveg → egy vektor. Ezt hívjuk minden KÉRDÉSNÉL. */
export async function beagyazSzoveget(szoveg: string): Promise<number[]> {
  const { embedding } = await embed({ model: getModell(), value: szoveg });
  return embedding;
}

/** Sok szöveg → sok vektor, egy hívásban (a tudásbázis feltöltésekor ez a gyors út). */
export async function beagyazKoteget(szovegek: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: getModell(),
    values: szovegek,
  });
  return embeddings;
}
