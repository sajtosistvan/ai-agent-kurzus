import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';

// queryCustomers tool — a bolt ÜGYFELEINEK lekérdezése (customers tábla, Prismán át).
// A getClientPreferences utódja: a fix térkép helyett élő DB, és nemcsak preferenciát,
// hanem teljes ügyfél-profilt ad (keret, szint, pet/kid-safe, notes). A modell ebből
// tudja, KINEK ajánl: a budget és a notes a csomag-összeállítás alapja lesz.

const CUSTOMER_TYPES = ['magánszemély', 'iroda', 'étterem', 'hotel', 'üzlet'] as const;

const InputSchema = z.object({
  code: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
});

const LIST_LIMIT = 20;

export async function executeQueryCustomers(
  rawInput: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen ügyfél-lekérdezés. Használható mezők: code (pontos ügyfélkód), ' +
        `search (név/város részlet), customerType (${CUSTOMER_TYPES.join(' | ')}).`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { code, search, customerType } = parsed.data;

  try {
    const prisma = deps.prisma ?? getPrisma();
    const rows = await prisma.customer.findMany({
      where: {
        ...(code ? { code: code.toUpperCase() } : {}),
        ...(customerType ? { customerType } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
      take: LIST_LIMIT,
    });

    if (rows.length === 0) {
      return {
        content: 'Nincs ilyen ügyfél a nyilvántartásban.',
        isError: false,
        summary: 'ügyfél-lekérdezés · 0 találat',
        rowCount: 0,
      };
    }

    // Kompakt JSON a modellnek: csak a döntéshez kellő mezők, Decimal → szám.
    const compact = rows.map((r) => ({
      code: r.code,
      name: r.name,
      city: r.city,
      customerType: r.customerType,
      budget: Number(r.budget),
      expertiseLevel: r.expertiseLevel,
      petSafeRequired: r.petSafeRequired,
      kidSafeRequired: r.kidSafeRequired,
      notes: r.notes,
    }));
    const label = code ?? search ?? customerType ?? 'összes';
    return {
      content: JSON.stringify(compact),
      isError: false,
      summary: `${rows.length} ügyfél · ${label}`,
      rowCount: rows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Az ügyfél-lekérdezés nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const queryCustomersTool = (report?: ToolReporter) =>
  tool({
    description:
      'A bolt ügyfeleinek lekérdezése. Ha a felhasználó egy ügyfélre hivatkozik (kóddal, névvel ' +
      'vagy várossal), ezzel kérd le a profilját: keret (budget, Ft), hozzáértés (expertiseLevel: ' +
      'kezdő | haladó | profi), pet/kid-safe igény és szöveges jegyzet (notes — fényviszonyok, ' +
      'stílus). Paraméter nélkül az első 20 ügyfelet listázza.',
    inputSchema: z.object({
      code: z.string().optional().describe('Pontos ügyfélkód, pl. ACME.'),
      search: z.string().optional().describe('Név- vagy városrészlet kereséshez.'),
      customerType: z.string().optional().describe('Szűrés típusra: magánszemély | iroda | étterem | hotel | üzlet.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeQueryCustomers(input);
      report?.(toolCallId, 'queryCustomers', input, outcome);
      return outcome.content;
    },
  });
