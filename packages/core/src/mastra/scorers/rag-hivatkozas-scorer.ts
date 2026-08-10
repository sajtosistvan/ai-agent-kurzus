import { createScorer } from '@mastra/core/evals';

import { toolHivasok, toolNevIllik, valaszSzoveg } from './uzenet-olvaso.js';

// Determinisztikus scorer: ha volt tudásbázis-találat (RAG), a válasz hivatkozik-e forrásra.
// A gondozási tanácsnál a forrásmegjelölés az, ami ellenőrizhetővé teszi a választ —
// e nélkül a RAG csak drágább hallucináció.

/** A tudásbázist kereső toolok neve ezek valamelyikét tartalmazza (részlet-egyezés). */
const TUDASBAZIS_TOOL_MINTAK = ['tudasbazis', 'tudás', 'rag', 'knowledge', 'gondozas'] as const;

/** A találat-objektumokban ezek a mezők azonosítják a forrást. */
const FORRAS_MEZOK = /forras|forrás|source|cim|cím|title|fajl|fájl|file|dokumentum|url/i;

/** A válaszban ezek jelzik, hogy egyáltalán forrásra hivatkozik. */
const HIVATKOZAS_SZAVAK = ['forrás', 'forras', 'tudásbázis', 'tudasbazis', 'dokumentum'];

/** Rekurzívan összeszedi a találatokból a forrás-azonosító szövegeket. */
const forrasNevek = (ertek: unknown, gyujto: string[] = []): string[] => {
  if (Array.isArray(ertek)) {
    ertek.forEach((elem) => forrasNevek(elem, gyujto));
    return gyujto;
  }

  if (ertek && typeof ertek === 'object') {
    Object.entries(ertek as Record<string, unknown>).forEach(([kulcs, mezo]) => {
      if (typeof mezo === 'string' && FORRAS_MEZOK.test(kulcs) && mezo.trim().length > 2) {
        gyujto.push(mezo.trim());
      } else {
        forrasNevek(mezo, gyujto);
      }
    });
  }

  return gyujto;
};

export const ragHivatkozasScorer = createScorer({
  id: 'rag-hivatkozas',
  name: 'RAG forrás-hivatkozás',
  description:
    'Determinisztikus ellenőrzés: ha a tudásbázis-tool adott találatot, a válasz megnevezi-e a forrást.',
  type: 'agent',
})
  .analyze(({ run }) => {
    const szoveg = valaszSzoveg(run.output).toLowerCase();
    const talalatok = toolHivasok(run.output)
      .filter((hivas) => toolNevIllik(hivas.nev, TUDASBAZIS_TOOL_MINTAK))
      .map((hivas) => hivas.eredmeny);

    const nevek = forrasNevek(talalatok);

    return {
      voltTudasbazisHivas: talalatok.length > 0,
      forrasokSzama: nevek.length,
      megnevezettForras: nevek.some((nev) => szoveg.includes(nev.toLowerCase())),
      emlitForrast: HIVATKOZAS_SZAVAK.some((szo) => szoveg.includes(szo)),
    };
  })
  .generateScore(({ results }) => {
    const { voltTudasbazisHivas, forrasokSzama, megnevezettForras, emlitForrast } = results.analyzeStepResult;

    // Nem volt tudásbázis-találat: itt nem elvárás a hivatkozás.
    if (!voltTudasbazisHivas || forrasokSzama === 0) return 1;
    if (megnevezettForras) return 1;

    return emlitForrast ? 0.5 : 0;
  })
  .generateReason(({ results, score }) => {
    const { voltTudasbazisHivas, forrasokSzama, megnevezettForras, emlitForrast } = results.analyzeStepResult;

    if (!voltTudasbazisHivas) return `Pontszám: ${score}. Nem futott tudásbázis-tool, itt nem elvárás a hivatkozás.`;
    if (forrasokSzama === 0) return `Pontszám: ${score}. A tudásbázis-tool nem adott azonosítható forrást.`;

    return `Pontszám: ${score}. Konkrét forrásnév a válaszban: ${megnevezettForras ? 'igen' : 'nem'}, forrásra utaló szó: ${emlitForrast ? 'igen' : 'nem'} (${forrasokSzama} találat).`;
  });
