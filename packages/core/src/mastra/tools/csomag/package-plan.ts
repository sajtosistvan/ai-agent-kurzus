import { z } from 'zod';

// package-plan.ts — a STRUKTURÁLT csomagterv, Zod-sémaként. A csomag_ellenorzes tool
// outputSchema-jának a magja: EBBŐL lesz a modellnek adott strukturált válasz, ÉS ugyanez
// a JSON megy a UI csomag-összesítő kártyájába. Egy igazságforrás, két fogyasztó.
//
// MIÉRT ZOD ÉS NEM INTERFACE: a Mastra a tool kimenetét az outputSchema szerint ellenőrzi,
// így a séma és a TS-típus nem tud elcsúszni egymástól (a típus a sémából származik).

export const PackagePlanItemSchema = z.object({
  productId: z.number().int(),
  name: z.string(),
  qty: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
});

export const PackagePlanSchema = z.object({
  customerId: z.number().int(),
  customerCode: z.string(),
  customerName: z.string(),
  budget: z.number(),
  items: z.array(PackagePlanItemSchema),
  totalPrice: z.number(),
  remaining: z.number(),
});

export type PackagePlanItem = z.infer<typeof PackagePlanItemSchema>;
export type PackagePlan = z.infer<typeof PackagePlanSchema>;
