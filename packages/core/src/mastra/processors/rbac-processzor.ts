import type { InputProcessor } from '@mastra/core/processors';

import { belsoMunkatars, olvasSzerep } from './szerep.js';
import { utolsoFelhasznaloiSzoveg } from './utolso-kerdes.js';

// rbac-processzor.ts — SZEREPKÖR ALAPÚ HOZZÁFÉRÉS, input processzorként.
//
// Ez váltja ki a régi `user-role.ts` szerep-alapú toolkapcsolást. A különbség lényeges:
// a régi megoldás a toolkészletet állította össze szerep szerint, ez viszont MÁR A BEMENETET
// megállítja — a tiltott kérés el sem jut a modellhez.
//
// ============================================================================
// FONTOS: ez az RBAC-nak csak az EGYIK fele.
//
//  1. réteg (itt): mi jut el egyáltalán a modellhez — a beszélgetés szintjén véd.
//  2. réteg (a supervisor `agents` mezője): melyik szakértő agent érhető el egyáltalán.
//     A katalógus-agentet vásárló szerepben MEG SEM KAPJA a supervisor, tehát nem tud
//     delegálni neki, akármilyen ügyesen fogalmaz a felhasználó.
//  3. réteg (a tool-rétegben, NFR1): az írás egyetlen, szigorúan validált úton mehet.
//
// Ökölszabály: a jogosultságot ott is ellenőrizd, ahol a művelet ténylegesen megtörténik,
// ne csak a bejáratnál. A prompt kérés, a kód kényszer.
// ============================================================================

/** Katalógus-MÓDOSÍTÁSRA utaló szavak. Ez belső munkatársi művelet. */
const SZERKESZTESI_JELEK = [
  'módosítsd',
  'modositsd',
  'írd át',
  'ird at',
  'állítsd be',
  'allitsd be',
  'frissítsd',
  'frissitsd',
  'vedd fel',
  'vidd fel',
  'töröld',
  'torold',
  'hozd be',
  'importáld',
  'importald',
  'feed',
  'készletet állít',
  'árat állít',
  'arat allit',
];

const ELUTASITAS =
  'Ehhez belső munkatársi jogosultság kell. A katalógus szerkesztését (ár, készlet, új termék, ' +
  'feed-import) csak a Plantbase munkatársai végezhetik. Szívesen segítek viszont növény- és ' +
  'csomag-választásban!';

export const rbacProcesszor: InputProcessor = {
  id: 'rbac-processzor',
  name: 'RBAC szűrő',
  description:
    'Szerepkör alapján tiltja a katalógus-módosításra irányuló kéréseket (csak admin).',

  processInput: ({ messages, abort, requestContext }) => {
    if (belsoMunkatars(olvasSzerep(requestContext))) {
      return messages;
    }

    const kerdes = utolsoFelhasznaloiSzoveg(messages);
    if (kerdes && SZERKESZTESI_JELEK.some((jel) => kerdes.includes(jel))) {
      // Az abort MEGSZAKÍTJA a futást, mielőtt a modell megkapná a kérést.
      // A Studio trace-ében ez "tripwire" néven látszik.
      abort(ELUTASITAS);
    }
    return messages;
  },
};
