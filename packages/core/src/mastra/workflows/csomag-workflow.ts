import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { ellenorizCsomagot } from '../tools/csomag-ellenorzes-tool.js';
import { mentsCsomagot } from '../tools/csomag-mentes-tool.js';
import { PackagePlanSchema } from '../tools/csomag/package-plan.js';

// csomag-workflow.ts — a csomag-folyamat EMBERI JÓVÁHAGYÁSI PONTJA, Mastra workflow-ként.
//
// A beszélgetős úton (csomag-agent) az „összegző kártya + explicit megerősítés” egy
// PROMPTSZABÁLY volt: megkértük a modellt, hogy mentés előtt kérdezzen rá. Ez a workflow
// ugyanazt KÓDBAN mondja ki: a mentés fizikailag nem tud lefutni jóváhagyás nélkül, mert a
// futás a `suspend()`-nél megáll, és csak `resume`-mal indul tovább.
//
// Miért érdemes így is megnézni? Mert a csomagmentés pénzügyi következménnyel jár. A modell
// javasolhat, összeállíthat, de a „megrendelem” gombot ember nyomja meg. NULLA modellhívás
// van benne: három determinisztikus lépés, köztük egy emberi kontrollponttal.
//
// A Studio Workflows gráfján a 2. lépés megáll és jóváhagyásra vár — ott lehet megmutatni,
// hol van az emberi kontroll.

const INDULO_ADAT = z.object({
  customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
  items: z
    .array(
      z.object({
        productId: z.number().describe('Termék-azonosító a katalógusból.'),
        qty: z.number().describe('Darabszám (legalább 1).'),
      }),
    )
    .describe('A csomag tételei.'),
  light: z.string().optional().describe('Kért fényigény, ha tisztázott.'),
  maxHeightCm: z.number().optional().describe('Maximális kifejlett magasság cm-ben.'),
});

const KERES_SCHEMA = INDULO_ADAT;

/** 1. lépés: determinisztikus ellenőrzés — UGYANAZ a kód, amit a csomag_ellenorzes tool hív. */
const ellenorzesLepes = createStep({
  id: 'csomag-ellenorzes',
  description:
    'Determinisztikusan ellenőrzi a csomagot: készlet, pet/kid-safe, szint, fény, méret, keret.',
  inputSchema: INDULO_ADAT,
  outputSchema: z.object({
    keres: KERES_SCHEMA,
    sikeres: z.boolean(),
    terv: PackagePlanSchema.nullable(),
    problemak: z.array(z.string()),
    osszegzes: z.string(),
  }),
  execute: async ({ inputData }) => {
    const eredmeny = await ellenorizCsomagot(inputData);
    const osszegzes = eredmeny.terv
      ? `${eredmeny.terv.customerName} (${eredmeny.terv.customerCode}) · ` +
        `${eredmeny.terv.items.map((t) => `${t.name} ×${t.qty}`).join(', ')} · ` +
        `összár ${eredmeny.terv.totalPrice} Ft (keret ${eredmeny.terv.budget} Ft, ` +
        `marad ${eredmeny.terv.remaining} Ft)`
      : eredmeny.uzenet;
    return {
      keres: inputData,
      sikeres: eredmeny.sikeres,
      terv: eredmeny.terv,
      problemak: eredmeny.problemak,
      osszegzes,
    };
  },
});

/**
 * 2. lépés: EMBERI JÓVÁHAGYÁS.
 *
 * A `suspend()` felfüggeszti a workflow-t és eltárolja az állapotát. A futás itt megáll,
 * amíg valaki (Studio-ból vagy API-ból) be nem küldi a `resumeData`-t.
 */
const jovahagyasLepes = createStep({
  id: 'emberi-jovahagyas',
  description: 'Megáll, és megvárja, hogy egy ember jóváhagyja a csomagot.',
  inputSchema: ellenorzesLepes.outputSchema,
  outputSchema: z.object({
    keres: KERES_SCHEMA,
    jovahagyva: z.boolean(),
    indoklas: z.string(),
  }),
  // Amit felfüggesztéskor MEGMUTATUNK a jóváhagyónak — ez az „összegző kártya”.
  suspendSchema: z.object({
    osszegzes: z.string(),
    kerdes: z.string(),
  }),
  // Amit a jóváhagyótól VISSZA VÁRUNK.
  resumeSchema: z.object({
    jovahagyva: z.boolean().describe('Igaz, ha a csomag menthető.'),
    megjegyzes: z.string().optional().describe('Opcionális indoklás, főleg elutasításnál.'),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    // Ami már az ellenőrzésen elbukott, azt nem tesszük emberi jóváhagyás elé.
    if (!inputData.sikeres) {
      return {
        keres: inputData.keres,
        jovahagyva: false,
        indoklas: `A csomag nem ment át az ellenőrzésen: ${inputData.problemak.join(' ')}`,
      };
    }

    if (!resumeData) {
      return await suspend({
        osszegzes: inputData.osszegzes,
        kerdes: 'Jóváhagyod és mentsük ezt a csomagot?',
      });
    }

    return {
      keres: inputData.keres,
      jovahagyva: resumeData.jovahagyva,
      indoklas:
        resumeData.megjegyzes ?? (resumeData.jovahagyva ? 'Jóváhagyva.' : 'Elutasítva.'),
    };
  },
});

/** 3. lépés: mentés. Csak jóváhagyás után fut le érdemben — és a tool ott is ÚJRA validál. */
const mentesLepes = createStep({
  id: 'csomag-mentes',
  description: 'Elmenti a csomagot, ha megkapta a jóváhagyást.',
  inputSchema: jovahagyasLepes.outputSchema,
  outputSchema: z.object({
    csomagId: z.number().nullable(),
    statusz: z.enum(['mentve', 'elutasítva', 'sikertelen']),
    uzenet: z.string(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData.jovahagyva) {
      return {
        csomagId: null,
        statusz: 'elutasítva' as const,
        uzenet: `A csomag nem került mentésre. ${inputData.indoklas}`,
      };
    }
    const eredmeny = await mentsCsomagot(inputData.keres);
    return {
      csomagId: eredmeny.csomagId,
      statusz: eredmeny.sikeres ? ('mentve' as const) : ('sikertelen' as const),
      uzenet: eredmeny.sikeres ? eredmeny.uzenet : eredmeny.problemak.join(' '),
    };
  },
});

export const csomagWorkflow = createWorkflow({
  id: 'csomag-folyamat',
  description:
    'Három lépéses csomag-folyamat emberi jóváhagyással: ellenőrzés, jóváhagyás (suspend), mentés.',
  inputSchema: INDULO_ADAT,
  outputSchema: mentesLepes.outputSchema,
})
  .then(ellenorzesLepes)
  .then(jovahagyasLepes)
  .then(mentesLepes)
  .commit();
