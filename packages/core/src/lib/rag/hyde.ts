import { generateText } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { loadConfig } from '../config.js';

// hyde.ts — HYPOTHETICAL DOCUMENT EMBEDDINGS ("hipotetikus válasz").
//
// A PROBLÉMA: a kérdés és a válasz NEM ugyanazon a nyelven beszél.
//   kérdés:  "miért hullanak le a leveleim?"        (rövid, kérdő, laikus)
//   válasz:  "Leaf drop is commonly caused by       (hosszú, kijelentő, szakszavas)
//             sudden temperature changes, underwatering, or acclimation stress…"
// A két szöveg vektora ezért TÁVOLABB van egymástól, mint gondolnád — pedig egymáshoz tartoznak.
//
// A TRÜKK: ne a kérdést keressük, hanem egy KITALÁLT VÁLASZT. Megkérünk egy kis modellt,
// hogy írjon egy rövid, magabiztos (akár téves!) választ a kérdésre — és EZT embeddeljük.
// A kitalált válasz ugyanazon a nyelven beszél, mint a valódi dokumentumok, ezért a vektora
// KÖZELEBB esik a jó chunkhoz. Nem baj, ha a tartalma hibás: nem ezt adjuk a felhasználónak,
// csak KERESÜNK vele. A választ mindig a megtalált, VALÓDI chunkokból írja meg a nagy modell.

const HYDE_MODEL = 'gpt-4.1-nano';

// A modellnek szóló szöveg EGY BLOKKBAN — úgy szerkeszted, ahogy a modell látja.
const HYDE_PROMPT = `
Írj egy rövid (2-3 mondat), magabiztos szakaszt egy növénygondozási útmutatóból,
ami megválaszolja a kérdést.

Úgy fogalmazz, ahogy egy ilyen cikk írna: kijelentő mondatokkal, szakkifejezésekkel.
Angolul írj — a tudásbázis angol. Ne kérdezz vissza.
`.trim();

let provider: OpenAIProvider | null = null;
function getModel() {
  if (!provider) {
    provider = createOpenAI({ apiKey: loadConfig().openaiApiKey });
  }
  return provider(HYDE_MODEL);
}

/**
 * Kérdés → rövid, hipotetikus válasz (EZT embeddeljük keresésre, nem a kérdést).
 * Hiba esetén visszaadjuk az eredeti kérdést — a keresés menjen tovább.
 */
export async function hypotheticalAnswer(question: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: getModel(),
      system: HYDE_PROMPT,
      prompt: question,
      maxOutputTokens: 200,
    });
    return text.trim() || question;
  } catch {
    return question;
  }
}
