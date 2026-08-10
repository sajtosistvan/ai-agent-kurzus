import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';

import { utolsoKerdes, valaszSzoveg } from './uzenet-olvaso.js';

// LLM-as-judge scorer: mennyire hasznos a válasz a vásárlónak.
//
// Szándékosan OLCSÓ modell (Haiku): a determinisztikus scorerek a formát mérik,
// ezt a tartalmat — de csak mintavételesen fut (lásd index.ts sampling).
// Az „analyze” lépés hívja a modellt strukturált kimenettel, a pontszámot utána
// sima kód számolja: így a pontozási logika átlátható és stabil marad.

export const hasznossagJudgeScorer = createScorer({
  id: 'hasznossag-judge',
  name: 'Hasznosság (LLM judge)',
  description:
    'Egy olcsó modell megítéli, mennyire konkrét és használható a Plantbase válasza a vásárlónak.',
  type: 'agent',
  judge: {
    model: 'anthropic/claude-haiku-4-5',
    instructions: `Szigorú, de tisztességes értékelő vagy egy magyar növény-webshop (Plantbase) agentjének válaszaihoz.
Azt nézed, hogy a válasz a vásárló számára konkrétan használható-e: válaszol-e a feltett kérdésre,
tartalmaz-e konkrét, cselekvésre váltható információt (növénynév, ár, gondozási lépés),
és nem general-e üres, általános szöveget.`,
  },
})
  .analyze({
    description: 'Megítéli a válasz konkrétságát és hasznosságát.',
    outputSchema: z.object({
      valaszolAKerdesre: z.boolean().describe('A válasz a feltett kérdésre felel-e.'),
      konkretElemek: z
        .number()
        .describe('Hány konkrét, használható elemet tartalmaz a válasz (növénynév, ár, gondozási lépés), 0-5.'),
      indoklas: z.string().describe('Egy mondat magyarul arról, miért ennyi.'),
    }),
    createPrompt: ({ run }) => `Értékeld az alábbi Plantbase-választ.

VÁSÁRLÓ KÉRDÉSE:
${utolsoKerdes(run.input) || JSON.stringify(run.input?.inputMessages ?? [])}

AGENT VÁLASZA:
${valaszSzoveg(run.output)}

Add meg, hogy a válasz felel-e a kérdésre, hány konkrét használható elemet tartalmaz (0-5),
és egy mondatos magyar indoklást.`,
  })
  .generateScore(({ results }) => {
    const { valaszolAKerdesre, konkretElemek } = results.analyzeStepResult;

    if (!valaszolAKerdesre) return 0;

    // 0 konkrét elem -> 0.2, 5 elem -> 1.0
    return Math.min(1, 0.2 + Math.max(0, konkretElemek) * 0.16);
  })
  .generateReason(({ results }) => results.analyzeStepResult.indoklas);
