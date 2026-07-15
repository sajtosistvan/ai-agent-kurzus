import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';
import { validatePackagePlan } from './package-validation.js';
import type { PackagePlan } from './package-plan.js';

// validatePackage tool — a TOOL-KAPU: a csomag-agent csak olyan csomagot vihet tovább, ami
// itt átmegy. Siker esetén a strukturált csomagtervet adja vissza (JSON) — ugyanez megy az
// onPlan callbacken a szervernek (data-package part → összesítő kártya a UI-ban).

export const PackageItemsSchema = z
  .array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1) }))
  .min(1);

const InputSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: PackageItemsSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

export async function executeValidatePackage(
  rawInput: unknown,
  deps: { prisma?: PrismaClient; onPlan?: (plan: PackagePlan) => void } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen csomag-kérés. Kötelező: customerCode (ügyfélkód) és items ' +
        '(legalább egy { productId, qty>=1 }); opcionális: light, maxHeightCm.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { customerCode, items, light, maxHeightCm } = parsed.data;
  try {
    const prisma = deps.prisma ?? getPrisma();
    const validation = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!validation.ok) {
      return {
        content: `A csomag NEM érvényes:\n- ${validation.problems.join('\n- ')}\nLazíts a feltételeken vagy csökkents darabszámot, és validálj újra.`,
        isError: true,
        summary: `validatePackage — hiba: ${validation.problems[0]}`,
        rowCount: null,
      };
    }
    deps.onPlan?.(validation.plan);
    return {
      content: JSON.stringify(validation.plan),
      isError: false,
      summary: `validatePackage — ${validation.plan.items.length} tétel · ${validation.plan.totalPrice} Ft (keret: ${validation.plan.budget} Ft)`,
      rowCount: validation.plan.items.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `A csomag-validálás nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const validatePackageTool = (
  report?: ToolReporter,
  deps: { onPlan?: (plan: PackagePlan) => void } = {},
) =>
  tool({
    description:
      'A csomagterv determinisztikus ellenőrzése MENTÉS ELŐTT: léteznek-e a termékek, van-e ' +
      'elég készlet, teljesül-e a pet/kid-safe igény, a gondozási szint (difficulty ≤ az ügyfél ' +
      'szintje), az opcionális fény/méret feltétel, és NEM lépi-e túl az összár az ügyfél ' +
      'keretét (kemény korlát). Siker esetén a strukturált csomagtervet adja vissza — EZUTÁN ' +
      'kérdezd meg a felhasználót: „Ez így rendben van?”.',
    inputSchema: z.object({
      customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
      items: z
        .array(z.object({
          productId: z.number().describe('Termék-azonosító a katalógusból.'),
          qty: z.number().describe('Darabszám (legalább 1).'),
        }))
        .describe('A csomag tételei.'),
      light: z.string().optional().describe('Kért fényigény, ha a beszélgetésben tisztáztátok.'),
      maxHeightCm: z.number().optional().describe('Maximális kifejlett magasság cm-ben, ha kérték.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeValidatePackage(input, deps);
      report?.(toolCallId, 'validatePackage', input, outcome);
      return outcome.content;
    },
  });
