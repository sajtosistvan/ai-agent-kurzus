import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';
import { validatePackagePlan } from '../validate-package/package-validation.js';
import { PackageItemsSchema } from '../validate-package/validate-package-tool.js';

// savePackage tool — az EGYETLEN írási út a packages/package_items táblákba. Mentés előtt
// ÚJRA lefuttatja UGYANAZT a validálást (package-validation.ts): a modell nem tud „elavult”
// vagy manipulált csomagtervet menteni — a kapu a mentés pillanatában is zárva van.
// Sikeres mentés = a flow strukturált záró jelzése (a flow-lock ebből olvas).

const InputSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: PackageItemsSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

export async function executeSavePackage(
  rawInput: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen mentési kérés. Ugyanazokat a mezőket add meg, mint a validatePackage-nél: ' +
        'customerCode és items (opcionálisan light, maxHeightCm).',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { customerCode, items, light, maxHeightCm } = parsed.data;
  try {
    const prisma = deps.prisma ?? getPrisma();
    // ÚJRA-VALIDÁLÁS — csak validált csomag kerülhet az adatbázisba.
    const validation = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!validation.ok) {
      return {
        content: `A csomag mentés előtt megbukott az újra-validáláson:\n- ${validation.problems.join('\n- ')}\nValidáld újra a javított csomagot, mielőtt mentenél.`,
        isError: true,
        summary: `savePackage — hiba: ${validation.problems[0]}`,
        rowCount: null,
      };
    }
    const { plan } = validation;
    const saved = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.create({
        data: { customerId: plan.customerId, totalPrice: plan.totalPrice },
      });
      await tx.packageItem.createMany({
        data: plan.items.map((i) => ({ packageId: pkg.id, productId: i.productId, qty: i.qty })),
      });
      return pkg;
    });
    const itemList = plan.items.map((i) => `${i.name} ×${i.qty}`).join(', ');
    return {
      content: `A csomag elmentve (azonosító: #${saved.id}). Tételek: ${itemList}. Összár: ${plan.totalPrice} Ft (keret: ${plan.budget} Ft). Add át a felhasználónak ezt a végleges visszajelzést egy mondatban.`,
      isError: false,
      summary: `savePackage — #${saved.id} · ${plan.items.length} tétel · ${plan.totalPrice} Ft`,
      rowCount: plan.items.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `A csomag mentése nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const savePackageTool = (report?: ToolReporter) =>
  tool({
    description:
      'A validált csomag VÉGLEGES mentése az adatbázisba. KIZÁRÓLAG azután hívd, hogy (1) a ' +
      'validatePackage sikeres volt ÉS (2) a felhasználó kifejezetten megerősítette az ' +
      'összesítőt („Ez így rendben van?” → igen). Mentés előtt a tool újra validál.',
    inputSchema: z.object({
      customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
      items: z
        .array(z.object({
          productId: z.number().describe('Termék-azonosító.'),
          qty: z.number().describe('Darabszám.'),
        }))
        .describe('A megerősített csomag tételei — ugyanazok, mint a sikeres validálásnál.'),
      light: z.string().optional().describe('Fény-feltétel, ha a validálásnál is szerepelt.'),
      maxHeightCm: z.number().optional().describe('Méret-feltétel, ha a validálásnál is szerepelt.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeSavePackage(input);
      report?.(toolCallId, 'savePackage', input, outcome);
      return outcome.content;
    },
  });
