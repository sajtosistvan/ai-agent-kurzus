import type { InputProcessor } from '@mastra/core/processors';

import { utolsoFelhasznaloiSzoveg } from './utolso-kerdes.js';

// temakor-guardrail.ts — a Plantbase agentjei NÖVÉNYRŐL és a WEBSHOPRÓL beszélnek, másról nem.
//
// Miért processzor és nem promptszabály? A system prompt csak KÉRÉS a modell felé, amit egy
// ügyes megfogalmazás felülírhat. A processzor viszont kód: determinisztikusan lefut minden
// kérésnél, és a tiltott kérdés EL SEM ÉRI a modellt. Ez a különbség a „megkértük rá” és a
// „nem tudja megtenni” között.
//
// A heurisztika szándékosan MEGENGEDŐ: csak akkor tilt, ha a kérdésben egyáltalán nincs
// növényes/bolti jel. Guardrailnél a téves riasztás (jó kérdés elutasítása) rosszabb, mint
// ha néha átenged egy határesetet.

/** Növényhez vagy webshophoz köthető szavak — ha bármelyik szerepel, átengedjük. */
const TEMAKOR_JELEK = [
  'növény',
  'noveny',
  'virág',
  'virag',
  'levél',
  'level',
  'gyökér',
  'gyoker',
  'öntöz',
  'ontoz',
  'locsol',
  'ültet',
  'ultet',
  'cserép',
  'cserep',
  'föld',
  'fold',
  'tápold',
  'tapold',
  'kártev',
  'kartev',
  'fény',
  'feny',
  'árnyék',
  'arnyek',
  'pozsgás',
  'pozsgas',
  'kaktusz',
  'monstera',
  'fikusz',
  'orchidea',
  'pálma',
  'palma',
  'szanzevieria',
  // A bolti oldal: katalógus, csomag, ügyfél, ár, készlet.
  'katalógus',
  'katalogus',
  'csomag',
  'termék',
  'termek',
  'ár',
  'ar ',
  'akció',
  'akcio',
  'készlet',
  'keszlet',
  'raktár',
  'raktar',
  'ügyfél',
  'ugyfel',
  'keret',
  'büdzsé',
  'budzse',
  'szoba',
  'iroda',
  'erkély',
  'erkely',
  'kert',
];

const ELUTASITAS =
  'Bocsánat, én a Plantbase növényeiben és webshopjában tudok segíteni: növényválasztás, ' +
  'gondozás, ár és készlet, csomagösszeállítás. Kérdezz nyugodtan bármit ezekről!';

export const temakorGuardrail: InputProcessor = {
  id: 'temakor-guardrail',
  name: 'Témakör guardrail',
  description: 'Csak növény- és webshop-témájú kérdéseket enged a modellhez.',

  processInput: ({ messages, abort }) => {
    const kerdes = utolsoFelhasznaloiSzoveg(messages);
    if (!kerdes) {
      return messages;
    }

    const vanJel = TEMAKOR_JELEK.some((jel) => kerdes.includes(jel));
    // Rövid üzenetet (köszönés, „igen”, „köszi”, egy ügyfélkód) átengedünk: ott nincs mit
    // tiltani, és egy elutasítás pont a folyamatban lévő csomag-beszélgetést törné meg.
    const rovid = kerdes.split(/\s+/).length <= 4;

    if (!vanJel && !rovid) {
      abort(ELUTASITAS);
    }
    return messages;
  },
};
