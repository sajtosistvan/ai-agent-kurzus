import { embed, embedMany } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { loadConfig } from '../config.js';

// embed.ts — a VEKTORIZÁLÁS. Szöveg → számok listája.
//
// MI EZ VALÓJÁBAN? Egy modell, ami minden szöveghez egy pontot rendel egy sok-dimenziós térben
// (nálunk 1536 dimenzió). A tanítása során az kerül EGYMÁS MELLÉ, ami HASONLÓAN HASZNÁLT —
// tehát nem a betűk hasonlítanak, hanem a JELENTÉS. "yellow leaves" és "leaves turning yellow"
// szinte ugyanaz a pont, pedig más a szórend; "yellow leaves" és "gift card" nagyon távol van.
//
// EZÉRT működik a keresés: a KÉRDÉST is ugyanezzel a modellel vektorizáljuk, és megnézzük,
// melyik chunk pontja van hozzá a legközelebb. Nincs kulcsszó-egyezés, nincs SQL LIKE — távolság.
//
// FONTOS: a kérdést és a dokumentumokat UGYANAZZAL a modellel kell embeddelni, különben nem
// összemérhetők (más a tér). Ha modellt váltasz, újra kell vektorizálni az egész tudásbázist.

const MODEL = 'text-embedding-3-small'; // 1536 dimenzió, olcsó: ~1 cent / 500 ezer token
export const EMBEDDING_DIMENSIONS = 1536;

let provider: OpenAIProvider | null = null;

function getModel() {
  if (!provider) {
    provider = createOpenAI({ apiKey: loadConfig().openaiApiKey });
  }
  return provider.textEmbeddingModel(MODEL);
}

/** Egy szöveg → egy vektor. Ezt hívjuk minden KÉRDÉSNÉL. */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: getModel(), value: text });
  return embedding;
}

/** Sok szöveg → sok vektor, egy hívásban (a tudásbázis feltöltésekor ez a gyors út). */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: getModel(), values: texts });
  return embeddings;
}
