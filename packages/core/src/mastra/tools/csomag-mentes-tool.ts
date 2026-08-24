import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';

import { getPrisma } from './prisma-client.js';
import { validatePackagePlan } from './csomag/package-validation.js';
import { CsomagTetelekSchema } from './csomag-ellenorzes-tool.js';

// csomag_mentes tool — az EGYETLEN írási út a packages / package_items táblákba. Mentés előtt
// ÚJRA lefuttatja UGYANAZT a validálást (package-validation.ts), amit a csomag_ellenorzes:
// a modell nem tud „elavult” vagy manipulált csomagtervet menteni — a kapu a mentés
// pillanatában is zárva van. A sikeres mentés zárja le a csomag-folyamatot.

const BemenetSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: CsomagTetelekSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  csomagId: z.number().nullable(),
  tetelek: z.array(z.string()),
  osszar: z.number().nullable(),
  keret: z.number().nullable(),
  uzenet: z.string(),
  problemak: z.array(z.string()),
});

export type CsomagMentesKimenet = z.infer<typeof KimenetSchema>;

const URES = { csomagId: null, tetelek: [] as string[], osszar: null, keret: null };

/** Validál → ÚJRA-validál → tranzakcióban ment. Soha nem dob. */
export async function mentsCsomagot(
  nyersBemenet: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<CsomagMentesKimenet> {
  const ellenorzott = BemenetSchema.safeParse(nyersBemenet);
  if (!ellenorzott.success) {
    return {
      sikeres: false,
      ...URES,
      uzenet: 'A mentési kérés formailag hibás.',
      problemak: [
        'Érvénytelen mentési kérés. Ugyanazokat a mezőket add meg, mint a csomag_ellenorzes-nél: ' +
          'customerCode és items (opcionálisan light, maxHeightCm).',
      ],
    };
  }
  const { customerCode, items, light, maxHeightCm } = ellenorzott.data;

  try {
    const prisma = deps.prisma ?? getPrisma();
    // ÚJRA-VALIDÁLÁS — csak validált csomag kerülhet az adatbázisba.
    const eredmeny = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!eredmeny.ok) {
      return {
        sikeres: false,
        ...URES,
        uzenet:
          'A csomag mentés előtt megbukott az újra-validáláson. Ellenőrizd újra a javított csomagot, mielőtt mentenél.',
        problemak: eredmeny.problems,
      };
    }
    const { plan } = eredmeny;
    const mentett = await prisma.$transaction(async (tx) => {
      const csomag = await tx.package.create({
        data: { customerId: plan.customerId, totalPrice: plan.totalPrice },
      });
      await tx.packageItem.createMany({
        data: plan.items.map((i) => ({ packageId: csomag.id, productId: i.productId, qty: i.qty })),
      });
      return csomag;
    });
    const tetelek = plan.items.map((i) => `${i.name} ×${i.qty}`);
    return {
      sikeres: true,
      csomagId: mentett.id,
      tetelek,
      osszar: plan.totalPrice,
      keret: plan.budget,
      uzenet:
        `A csomag elmentve (azonosító: #${mentett.id}). Tételek: ${tetelek.join(', ')}. ` +
        `Összár: ${plan.totalPrice} Ft (keret: ${plan.budget} Ft). ` +
        'Add át a felhasználónak ezt a végleges visszajelzést egy mondatban.',
      problemak: [],
    };
  } catch (error) {
    const uzenet = error instanceof Error ? error.message : String(error);
    return {
      sikeres: false,
      ...URES,
      uzenet: 'A csomag mentése nem sikerült.',
      problemak: [`A csomag mentése nem sikerült: ${uzenet}`],
    };
  }
}

export const csomagMentesTool = createTool({
  id: 'csomag_mentes',
  description:
    'A validált csomag VÉGLEGES mentése az adatbázisba. KIZÁRÓLAG azután hívd, hogy (1) a ' +
    'csomag_ellenorzes sikeres volt ÉS (2) a felhasználó kifejezetten megerősítette az ' +
    'összesítőt („Ez így rendben van?” → igen). Mentés előtt a tool újra validál.',
  inputSchema: z.object({
    customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
    items: z
      .array(
        z.object({
          productId: z.number().describe('Termék-azonosító.'),
          qty: z.number().describe('Darabszám.'),
        }),
      )
      .describe('A megerősített csomag tételei — ugyanazok, mint a sikeres ellenőrzésnél.'),
    light: z.string().optional().describe('Fény-feltétel, ha az ellenőrzésnél is szerepelt.'),
    maxHeightCm: z.number().optional().describe('Méret-feltétel, ha az ellenőrzésnél is szerepelt.'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra }) => {
    const kimenet = await mentsCsomagot(bemenet);
    const logger = mastra?.getLogger();
    if (kimenet.sikeres) {
      logger?.info('csomag_mentes — elmentve', {
        csomagId: kimenet.csomagId,
        osszar: kimenet.osszar,
      });
    } else {
      logger?.warn('csomag_mentes — nem mentettünk', { problemak: kimenet.problemak });
    }
    return kimenet;
  },
});
