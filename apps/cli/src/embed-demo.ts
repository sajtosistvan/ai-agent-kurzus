import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { embedBatch } from '@plantbase/core';

// embed-demo.ts — a dia-szemléltetőhöz: VALÓDI embeddingek + VALÓDI koszinusz-távolságok.
// Futtatás: pnpm tsx --conditions=@plantbase/source apps/cli/src/embed-demo.ts
// A kimenet (embed-demo.json) kerül a szemléltető HTML-be — így az órán nem kitalált
// számokat vetítünk ki, hanem azt, amit a text-embedding-3-small tényleg mond.

const SENTENCES = [
  // ── ugyanaz a kérdés, más szavakkal (ezeknek KÖZEL kell lenniük egymáshoz) ──
  'my monstera leaves are turning yellow',
  'leaves turning yellow on my plant',
  'why is my plant yellowing?',
  'sárgulnak a növényem levelei', // MAGYARUL — a modell többnyelvű: a jelentés köti össze, nem a szó
  // ── rokon téma: öntözés ──
  'overwatering causes root rot',
  'how often should I water my fern?',
  'the soil is bone dry and the leaves are crispy',
  // ── rokon téma: kártevők ──
  'fungus gnats in the soil',
  'spider mites on the underside of leaves',
  'sticky residue on leaves from mealybugs',
  // ── rokon téma: fény és elhelyezés ──
  'best plants for a dark bathroom',
  'my plant is leggy and stretching toward the window',
  // ── más művelet ──
  'repotting a root-bound plant',
  'how to propagate a pothos cutting',
  // ── LAKBERENDEZÉS (ők a célcsoport): tér, stílus, méret, elhelyezés ──
  'which plants work best in a minimalist living room?',
  'tall statement plant for an empty corner',
  'low-maintenance plants for a client office lobby',
  'plants that look good in a north-facing room',
  'milyen növény illik egy skandináv nappaliba?', // magyarul — a célcsoport így kérdez
  // ── teljesen más világ: bolti / logisztikai szöveg ──
  'gift card and return policy',
  'free shipping over $75',
  'do you ship to Hungary?',
];

/** Koszinusz-távolság: 1 - cos(a, b). 0 = azonos jelentés, 1 = semmi köze. */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] as number) * (b[i] as number);
    normA += (a[i] as number) ** 2;
    normB += (b[i] as number) ** 2;
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main(): Promise<void> {
  const embeddings = await embedBatch(SENTENCES);

  const distances = SENTENCES.map((_, i) =>
    SENTENCES.map((_, j) =>
      Number(cosineDistance(embeddings[i] as number[], embeddings[j] as number[]).toFixed(4)),
    ),
  );

  const output = {
    model: 'text-embedding-3-small',
    dimensions: embeddings[0]?.length ?? 0,
    sentences: SENTENCES,
    // Az első 8 szám mindegyik vektorból — hogy a dián látszódjon, mik ezek valójában.
    preview: embeddings.map((vector) =>
      vector.slice(0, 8).map((n) => Number(n.toFixed(4))),
    ),
    distances,
  };

  writeFileSync('embed-demo.json', JSON.stringify(output, null, 2));
  console.log(`${SENTENCES.length} mondat, ${output.dimensions} dimenzió → embed-demo.json`);

  // Gyors ellenőrzés a konzolon: mi van közel az elsőhöz, és mi van messze?
  const first = distances[0] as number[];
  const ranked = SENTENCES.map((text, i) => ({ text, d: first[i] as number }))
    .slice(1)
    .sort((a, b) => a.d - b.d);
  for (const { text, d } of ranked) {
    console.log(`  ${d.toFixed(3)}  ${text}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
