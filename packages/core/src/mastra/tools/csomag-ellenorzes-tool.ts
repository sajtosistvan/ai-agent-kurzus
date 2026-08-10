import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';

import { getPrisma } from './prisma-client.js';
import { validatePackagePlan } from './csomag/package-validation.js';
import { PackagePlanSchema } from './csomag/package-plan.js';

// csomag_ellenorzes tool — a TOOL-KAPU: csak az a csomag mehet tovább mentésre, ami itt átmegy.
// A validálás DETERMINISZTIKUS (nulla LLM, package-validation.ts): a prompt terel, a tool
// kényszerít. Siker esetén a strukturált csomagtervet adja vissza — ugyanez a JSON megy a
// modellnek és a UI összesítő kártyájának.
//
// A tényleges munkát az `ellenorizCsomagot` végzi (ide injektálható a Prisma-kliens, ezért
// tesztelhető DB nélkül); a createTool csak a modell felé eső burok + naplózás.

export const CsomagTetelekSchema = z
  .array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1) }))
  .min(1);

const BemenetSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: CsomagTetelekSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  terv: PackagePlanSchema.nullable(),
  /** Magyar hibalista: pontosan mi bukott el (készlet, pet-safe, szint, keret…). */
  problemak: z.array(z.string()),
  uzenet: z.string(),
});

export type CsomagEllenorzesKimenet = z.infer<typeof KimenetSchema>;

/** Validál → determinisztikus csomag-ellenőrzés → strukturált kimenet. Soha nem dob. */
export async function ellenorizCsomagot(
  nyersBemenet: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<CsomagEllenorzesKimenet> {
  const ellenorzott = BemenetSchema.safeParse(nyersBemenet);
  if (!ellenorzott.success) {
    return {
      sikeres: false,
      terv: null,
      problemak: [
        'Érvénytelen csomag-kérés. Kötelező: customerCode (ügyfélkód) és items ' +
          '(legalább egy { productId, qty>=1 }); opcionális: light, maxHeightCm.',
      ],
      uzenet: 'A csomag-kérés formailag hibás.',
    };
  }
  const { customerCode, items, light, maxHeightCm } = ellenorzott.data;

  try {
    const prisma = deps.prisma ?? getPrisma();
    const eredmeny = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!eredmeny.ok) {
      return {
        sikeres: false,
        terv: null,
        problemak: eredmeny.problems,
        uzenet:
          'A csomag NEM érvényes. Lazíts a feltételeken vagy csökkents darabszámot, és ellenőrizd újra.',
      };
    }
    const { plan } = eredmeny;
    return {
      sikeres: true,
      terv: plan,
      problemak: [],
      uzenet: `${plan.items.length} tétel · ${plan.totalPrice} Ft (keret: ${plan.budget} Ft, marad: ${plan.remaining} Ft)`,
    };
  } catch (error) {
    const uzenet = error instanceof Error ? error.message : String(error);
    return {
      sikeres: false,
      terv: null,
      problemak: [`A csomag-validálás nem sikerült: ${uzenet}`],
      uzenet: 'A csomag-validálás technikai hibába ütközött.',
    };
  }
}

export const csomagEllenorzesTool = createTool({
  id: 'csomag_ellenorzes',
  description:
    'A csomagterv determinisztikus ellenőrzése MENTÉS ELŐTT: léteznek-e a termékek, van-e ' +
    'elég készlet, teljesül-e a pet/kid-safe igény, a gondozási szint (difficulty ≤ az ügyfél ' +
    'szintje), az opcionális fény/méret feltétel, és NEM lépi-e túl az összár az ügyfél ' +
    'keretét (kemény korlát). Siker esetén a strukturált csomagtervet adja vissza — EZUTÁN ' +
    'kérdezd meg a felhasználót: „Ez így rendben van?”.',
  inputSchema: z.object({
    customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
    items: z
      .array(
        z.object({
          productId: z.number().describe('Termék-azonosító a katalógusból.'),
          qty: z.number().describe('Darabszám (legalább 1).'),
        }),
      )
      .describe('A csomag tételei.'),
    light: z.string().optional().describe('Kért fényigény, ha a beszélgetésben tisztáztátok.'),
    maxHeightCm: z.number().optional().describe('Maximális kifejlett magasság cm-ben, ha kérték.'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra }) => {
    const kimenet = await ellenorizCsomagot(bemenet);
    const logger = mastra?.getLogger();
    if (kimenet.sikeres) {
      logger?.info('csomag_ellenorzes — a csomag átment a kapun', { uzenet: kimenet.uzenet });
    } else {
      logger?.warn('csomag_ellenorzes — a csomag elbukott', { problemak: kimenet.problemak });
    }
    return kimenet;
  },
});
