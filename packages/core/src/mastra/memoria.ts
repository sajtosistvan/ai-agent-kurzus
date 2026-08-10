import { Memory } from '@mastra/memory';

import { plantbaseTarolo, plantbaseVektortar } from './tarolas.js';

// memoria.ts — A BESZÉLGETÉS-MEMÓRIA. Ez váltja ki a régi kézi `history: ModelMessage[]`
// átadogatást: nem mi hurcoljuk körbe az előzményt, hanem az agent kap egy szálat
// (`threadId`) és egy tulajdonost (`resourceId`), a többi a Mastra dolga.
//
// Három réteg épül egymásra:
//   lastMessages   — a legutóbbi N üzenet szó szerint (rövid távú memória),
//   semanticRecall — a RÉGEBBI üzenetekből a kérdéshez hasonlóak, vektorkeresésen (PgVector),
//   workingMemory  — tartós PROFIL (keret, szint, pet/kid-safe), amit az agent maga frissít.
//
// A working memory scope-ja 'resource': a profil a FELHASZNÁLÓHOZ tapad, nem a szálhoz —
// ezért egy új beszélgetésben is tudja, hogy az ügyfélnek háziállata van.

/** A working memory sablonja. Az agent ezt tölti ki és tartja karban beszélgetés közben. */
const PROFIL_SABLON = `# Ügyfél-profil
- **Kivel beszélek**: (lakberendező / vásárló / belső munkatárs)
- **Ügyfélkód**: (pl. ACME, ha csomagot állítunk össze)
- **Keret**: (Ft)
- **Hozzáértés**: (kezdő / haladó / profi)
- **Háziállat / kisgyerek**: (pet-safe vagy kid-safe igény)
- **Adottságok**: (fényigény, helyszín, maximális méret)
- **Eddigi döntések**: (mit fogadott el, mit vetett el)
`;

/**
 * A közös memória-példány. MINDEN érdemi agent ezt kapja — a szálakat viszont a hívó
 * választja szét (`memory: { thread, resource }` a stream/generate hívásban), ezért egy
 * példány elég, és a Studio-ban is egy helyen látszik minden szál.
 */
export const plantbaseMemoria = new Memory({
  ...(plantbaseTarolo ? { storage: plantbaseTarolo } : {}),
  ...(plantbaseVektortar ? { vector: plantbaseVektortar } : {}),
  // A beágyazó modell UGYANAZ, amivel a tudásbázis készül (OPENAI_API_KEY, 1536 dimenzió).
  embedder: 'openai/text-embedding-3-small',
  options: {
    lastMessages: 20,
    // A felidézés SZÁL-hatókörű, nem erőforrás-szintű. `resource` hatókörrel a Mastra MÁS
    // szálak üzeneteit is behúzza a kontextusba, és ha a behúzott részlet asszisztens-üzenettel
    // végződik, a kérés is azzal ér véget — az Anthropic API pedig ezt elutasítja:
    // „does not support assistant message prefill. The conversation must end with a user message.”
    // Ettől a webes chat MÁSODIK köre elszállt, miközben a CLI és a friss szálak működtek.
    // Az ára: egy új beszélgetés nem idézi fel a korábbi beszélgetések részleteit — a tartós
    // tudás a workingMemory profilban marad, az MARADT resource-hatókörű.
    semanticRecall: { topK: 3, messageRange: 2, scope: 'thread' },
    workingMemory: { enabled: true, scope: 'resource', template: PROFIL_SABLON },
  },
});
