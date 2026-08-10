import { Agent } from '@mastra/core/agent';

// hipotetikus-valasz.ts — HyDE (Hypothetical Document Embeddings).
//
// A PROBLÉMA: a kérdés és a válasz NEM ugyanazon a nyelven beszél.
//   kérdés:  "miért hullanak le a leveleim?"        (rövid, kérdő, laikus)
//   válasz:  "Leaf drop is commonly caused by sudden temperature changes…"  (hosszú, szakszavas)
// A két szöveg vektora ezért TÁVOLABB van egymástól, mint gondolnád — pedig összetartoznak.
//
// A TRÜKK: ne a kérdést keressük, hanem egy KITALÁLT VÁLASZT. Egy kis modell ír egy rövid,
// magabiztos (akár téves!) választ — és EZT ágyazzuk be. Nem baj, ha a tartalma hibás:
// nem ezt adjuk a felhasználónak, csak KERESÜNK vele. A valódi választ a megtalált chunkokból
// írja meg a nagy modell.
//
// A Mastra-ban ez egy MINI AGENT: így a HyDE-lépés is megjelenik a Studio trace-ében, és
// látszik a routing — itt a gpt-4.1-nano dolgozik, nem a drága válasz-modell.

const HYDE_UTASITAS = `
Írj egy rövid (2-3 mondat), magabiztos szakaszt egy növénygondozási útmutatóból,
ami megválaszolja a kérdést.

Úgy fogalmazz, ahogy egy ilyen cikk írna: kijelentő mondatokkal, szakkifejezésekkel.
Angolul írj — a tudásbázis angol. Ne kérdezz vissza.
`.trim();

export const hydeAgent = new Agent({
  id: 'plantbase-hyde',
  name: 'HyDE kereső-segéd',
  description:
    'A kérdésből hipotetikus (kitalált) választ ír, amit a vektorkeresés bemenetként használ.',
  instructions: HYDE_UTASITAS,
  // Olcsó, gyors modell — ez csak keresési segédszöveget gyárt, nem a felhasználónak szól.
  model: 'openai/gpt-4.1-nano',
});

/**
 * Kérdés → rövid, hipotetikus válasz (EZT ágyazzuk be keresésre, nem a kérdést).
 * Hiba esetén visszaadjuk az eredeti kérdést — a keresés sose álljon meg emiatt.
 */
export async function hipotetikusValasz(kerdes: string): Promise<string> {
  try {
    const eredmeny = await hydeAgent.generate(kerdes, {
      modelSettings: { maxOutputTokens: 200 },
    });
    return eredmeny.text.trim() || kerdes;
  } catch {
    return kerdes;
  }
}
