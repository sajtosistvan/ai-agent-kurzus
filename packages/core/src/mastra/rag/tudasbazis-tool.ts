import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { beagyazSzoveget } from './beagyazas.js';
import { hipotetikusValasz } from './hipotetikus-valasz.js';
import { atrangsorol } from './atrangsorolas.js';
import { getVektortar, TUDASBAZIS_INDEX } from './vektortar.js';

// tudasbazis-tool.ts — a RAG "R"-je: a KERESÉS, egy toolban, lépésről lépésre.
//
//   kérdés
//     └─(1) HyDE: kitalált válasz ─────────► amit valójában keresünk
//           └─(2) beágyazás: szöveg → 1536 szám
//                 └─(3) PgVector: a 20 leghasonlóbb chunk (tág háló)
//                       └─(4) rerank: kis modell átrangsorol → 5 marad
//                             └─(5) a chunkok + FORRÁS → a nagy modellnek
//
// A PÁRJA a katalogus_lekerdezes SQL-tool: ugyanaz az agent, két különböző tudásforrás.
//   SQL          → TÉNYEK a katalógusból: "van-e készleten?", "mennyibe kerül?"
//   tudásbázis   → TUDÁS a cikkekből:     "miért sárgul?", "hogyan öntözzem?"
// És NEM MI döntjük el, melyiket hívja: a modell dönt, a `description` alapján.
//
// Miért `createTool` és nem `createVectorQueryTool`? Mert a HyDE-lépést (1) a Mastra kész
// vektor-tool-ja nem ismeri, márpedig itt ez tanítja a legtöbbet. Minden MÁS lépés natív:
// a keresés a `PgVector`-é, az átrangsorolás a `@mastra/rag` `rerank()`-jéé.

/** Tág háló: ennyit hozunk be a vektorkeresésből, hogy legyen mit rangsorolni. */
const TAG_HALO = 20;
/** Ennyi chunk megy be végül a modellnek. */
const ALAP_TOPK = 5;

const KERDES_LEIRAS = `
A felhasználó kérdése, természetes nyelven, ahogy elhangzott (ne alakítsd kulcsszavakká).
`.trim();

const LEIRAS = `
Keres a bolt gondozási tudásbázisában: növénygondozási cikkek, kártevők, betegségek,
öntözés, fény, átültetés, évszakos teendők.

EZT használd minden "hogyan / miért / mit tegyek" jellegű kérdésnél.
A katalógus TÉNYEIHEZ (ár, készlet, méret) ne ezt használd, hanem az SQL-toolt.

A találatok forrás-URL-t is tartalmaznak — a válaszban hivatkozz rájuk.
`.trim();

const ReszletSchema = z.object({
  cim: z.string(),
  forras: z.string().describe('A cikk URL-je — erre hivatkozz a válaszban.'),
  tartalom: z.string(),
  pontszam: z.number().describe('Relevancia 0-1 között, nagyobb = jobb.'),
});

export const tudasbazisTool = createTool({
  id: 'tudasbazis_kereses',
  description: LEIRAS,
  inputSchema: z.object({
    kerdes: z.string().min(1).describe(KERDES_LEIRAS),
    topK: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Hány részlet jöjjön vissza (alap: 5).'),
  }),
  outputSchema: z.object({
    sikeres: z.boolean(),
    reszletek: z.array(ReszletSchema),
    /** Amit VALÓJÁBAN kerestünk (a HyDE-válasz) — a demóban ezt is megmutatjuk. */
    keresettSzoveg: z.string(),
    hibaüzenet: z.string().nullable(),
  }),
  execute: async ({ kerdes, topK }, ctx) => {
    const logger = ctx?.mastra?.getLogger();
    const megtart = topK ?? ALAP_TOPK;

    try {
      // (1) HyDE — a kérdés helyett egy kitalált VÁLASZT keresünk.
      const keresettSzoveg = await hipotetikusValasz(kerdes);

      // (2) Beágyazás — ugyanazzal a modellel, mint a dokumentumokat (különben nem összemérhető).
      const kerdesVektor = await beagyazSzoveget(keresettSzoveg);

      // (3) Vektorkeresés — tág háló, hogy a rerankernek legyen mit rangsorolnia.
      const talalatok = await getVektortar().query({
        indexName: TUDASBAZIS_INDEX,
        queryVector: kerdesVektor,
        topK: TAG_HALO,
      });

      if (talalatok.length === 0) {
        logger?.warn('Üres a tudásbázis-találat', { kerdes });
        return {
          sikeres: true,
          reszletek: [],
          keresettSzoveg,
          hibaüzenet: null,
        };
      }

      // (4) Átrangsorolás kis modellel → (5) ennyi megy a nagy modellnek, FORRÁSSAL együtt.
      const rangsorolt = await atrangsorol(kerdes, talalatok, megtart);
      const reszletek = rangsorolt.map(({ result, score }) => ({
        cim: String(result.metadata?.['title'] ?? '-'),
        forras: String(result.metadata?.['source'] ?? ''),
        tartalom: String(result.metadata?.['text'] ?? ''),
        pontszam: Number(score.toFixed(3)),
      }));

      logger?.info('Tudásbázis-keresés kész', {
        kerdes,
        tagHalo: talalatok.length,
        megtartott: reszletek.length,
        legjobb: reszletek[0]?.cim,
      });

      return { sikeres: true, reszletek, keresettSzoveg, hibaüzenet: null };
    } catch (hiba: unknown) {
      const uzenet = hiba instanceof Error ? hiba.message : String(hiba);
      logger?.warn('Tudásbázis-hiba', { kerdes, uzenet });
      return {
        sikeres: false,
        reszletek: [],
        keresettSzoveg: kerdes,
        hibaüzenet: `A tudásbázis most nem elérhető: ${uzenet}`,
      };
    }
  },
});
