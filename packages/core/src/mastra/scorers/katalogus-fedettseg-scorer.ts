import { createScorer } from '@mastra/core/evals';

import { toolHivasok, valaszSzoveg } from './uzenet-olvaso.js';

// Determinisztikus scorer: a válaszban szereplő katalógus-adat (ár) tényleg a tool
// eredményéből jön-e, vagy az agent kitalálta. Ez a Plantbase legfontosabb minőségi
// kockázata: egy hallucinált ár konkrét üzleti kár, nem stílushiba.
//
// A módszer szándékosan buta és átlátható: kiszedjük a válaszból az „… Ft” alakú
// számokat, és megnézzük, hogy a lefutott tool-hívások eredményében szerepelnek-e.

/** „4 990 Ft”, „4.990 Ft”, „4990 forint”, „4990 HUF” — a szám a capture group. */
const AR_MINTA = /(\d[\d\s.,]{0,12}?)\s*(?:ft|forint|huf)\b/gi;

/** Csak a számjegyek, a vezető nullák nélkül — így „4 990” és 4990 összehasonlítható. */
const csakSzamjegyek = (szoveg: string): string => szoveg.replace(/\D/g, '').replace(/^0+/, '');

/** A tool-eredményekben előforduló összes szám (JSON-ból kiszedve). */
const toolSzamok = (eredmenyek: unknown[]): Set<string> => {
  const jsonSzoveg = JSON.stringify(eredmenyek ?? []);

  return new Set((jsonSzoveg.match(/\d+/g) ?? []).map((szam) => szam.replace(/^0+/, '')));
};

export const katalogusFedettsegScorer = createScorer({
  id: 'katalogus-fedettseg',
  name: 'Katalógus-fedettség (nincs hallucinált ár)',
  description:
    'Determinisztikus ellenőrzés: a válaszban említett árak visszavezethetők-e a lefutott tool-hívások eredményére.',
  type: 'agent',
})
  .analyze(({ run }) => {
    const szoveg = valaszSzoveg(run.output);
    const hivasok = toolHivasok(run.output);
    const szamokAToolbol = toolSzamok(hivasok.map((hivas) => hivas.eredmeny));

    const arak = [...szoveg.matchAll(AR_MINTA)]
      .map((talalat) => csakSzamjegyek(talalat[1] ?? ''))
      .filter((szam) => szam.length > 0);

    return {
      voltToolHivas: hivasok.length > 0,
      arakSzama: arak.length,
      fedettArak: arak.filter((ar) => szamokAToolbol.has(ar)).length,
      // Diagnosztikának: pontosan melyik árat nem találtuk meg a tool-eredményben.
      fedetlenArak: arak.filter((ar) => !szamokAToolbol.has(ar)),
    };
  })
  .generateScore(({ results }) => {
    const { voltToolHivas, arakSzama, fedettArak } = results.analyzeStepResult;

    // Ha nincs ár-állítás a válaszban, nincs mit hallucinálni — ez nem hiba.
    if (arakSzama === 0) return 1;
    // Ár van, tool-hívás nincs: az adat csak a modell fejéből jöhetett.
    if (!voltToolHivas) return 0;

    return fedettArak / arakSzama;
  })
  .generateReason(({ results, score }) => {
    const { voltToolHivas, arakSzama, fedettArak, fedetlenArak } = results.analyzeStepResult;

    if (arakSzama === 0) return `Pontszám: ${score}. A válasz nem állít árat, nincs mit ellenőrizni.`;
    if (!voltToolHivas) return `Pontszám: ${score}. A válasz ${arakSzama} árat említ, de egyetlen tool sem futott le.`;

    return `Pontszám: ${score}. ${arakSzama} ár közül ${fedettArak} van meg a tool-eredményben. Fedetlen: ${fedetlenArak.join(', ') || '—'}.`;
  });
