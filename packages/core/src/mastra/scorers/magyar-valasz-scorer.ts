import { createScorer } from '@mastra/core/evals';

import { valaszSzoveg } from './uzenet-olvaso.js';

// Determinisztikus scorer: magyarul válaszolt-e az agent.
// Nincs benne modellhívás, ezért ingyen és azonnal fut minden válaszra.
// A Plantbase user-facing nyelve magyar — ez a legolcsóbb regressziós háló rá.

/** Gyakori magyar funkciószavak: angol válaszban ezek nem fordulnak elő. */
const MAGYAR_SZAVAK = [' a ', ' az ', ' és ', ' hogy ', ' nem ', ' ha ', ' de ', ' is ', ' ezt ', ' van '];

const MAGYAR_EKEZETEK = /[áéíóöőúüű]/i;

export const magyarValaszScorer = createScorer({
  id: 'magyar-valasz',
  name: 'Magyar válasz',
  description:
    'Determinisztikus ellenőrzés: a válasz magyar nyelvű-e (ékezetek és magyar funkciószavak alapján).',
  type: 'agent',
})
  .analyze(({ run }) => {
    const szoveg = valaszSzoveg(run.output);
    const kisbetus = ` ${szoveg.toLowerCase()} `;

    return {
      ures: szoveg.length === 0,
      vanEkezet: MAGYAR_EKEZETEK.test(szoveg),
      magyarSzavakSzama: MAGYAR_SZAVAK.filter((szo) => kisbetus.includes(szo)).length,
    };
  })
  .generateScore(({ results }) => {
    const { ures, vanEkezet, magyarSzavakSzama } = results.analyzeStepResult;

    // 0.0 – üres válasz | 0.5 – ékezet VAGY magyar szó | 1.0 – ékezet ÉS legalább két magyar szó
    if (ures) return 0;
    if (vanEkezet && magyarSzavakSzama >= 2) return 1;
    if (vanEkezet || magyarSzavakSzama >= 1) return 0.5;

    return 0;
  })
  .generateReason(({ results, score }) => {
    const { ures, vanEkezet, magyarSzavakSzama } = results.analyzeStepResult;

    if (ures) return `Pontszám: ${score}. A válasz üres volt.`;

    return `Pontszám: ${score}. Ékezetes karakter: ${vanEkezet ? 'igen' : 'nem'}, magyar funkciószavak száma: ${magyarSzavakSzama}.`;
  });
