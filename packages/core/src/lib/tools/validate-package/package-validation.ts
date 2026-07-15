import type { PrismaClient } from '@plantbase/db';
import type { PackagePlan, PackagePlanItem } from './package-plan.js';

// package-validation.ts — a csomag-validálás DETERMINISZTIKUS magja (nulla LLM). A tool
// kényszerít, a prompt csak terel: hiába állít össze a modell szabálysértő csomagot, itt
// magyar hibalistát kap vissza, és visszalép. A savePackage mentés előtt UGYANEZT futtatja
// újra — a két tool nem csúszhat el egymástól.

export interface PackageRequestItem {
  productId: number;
  qty: number;
}

/** A beszélgetésben tisztázott, ügyfél-táblán kívüli feltételek (méret, fényigény). */
export interface PackageCriteria {
  light?: string;
  maxHeightCm?: number;
}

export type PackageValidation =
  | { ok: true; plan: PackagePlan }
  | { ok: false; problems: string[] };

const DIFFICULTY_ORDER = ['kezdő', 'haladó', 'profi'] as const;
function difficultyRank(level: string): number {
  return DIFFICULTY_ORDER.indexOf(level as (typeof DIFFICULTY_ORDER)[number]);
}

export async function validatePackagePlan(
  prisma: PrismaClient,
  customerCode: string,
  items: PackageRequestItem[],
  criteria: PackageCriteria = {},
): Promise<PackageValidation> {
  const customer = await prisma.customer.findUnique({
    where: { code: customerCode.toUpperCase() },
  });
  if (!customer) {
    return { ok: false, problems: [`Nincs ${customerCode} kódú ügyfél a nyilvántartásban.`] };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const problems: string[] = [];
  const planItems: PackagePlanItem[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      problems.push(`Nincs ${item.productId} azonosítójú termék a katalógusban.`);
      continue;
    }
    if (product.stock < item.qty) {
      problems.push(`${product.name}: csak ${product.stock} db van raktáron (kért: ${item.qty}).`);
    }
    if (customer.petSafeRequired && !product.petSafe) {
      problems.push(`${product.name}: nem pet-safe, pedig az ügyfélnek ez kötelező.`);
    }
    if (customer.kidSafeRequired && !product.kidSafe) {
      problems.push(`${product.name}: nem kid-safe, pedig az ügyfélnek ez kötelező.`);
    }
    if (difficultyRank(product.difficulty) > difficultyRank(customer.expertiseLevel)) {
      problems.push(
        `${product.name}: ${product.difficulty} szintű gondozás, az ügyfél ${customer.expertiseLevel}.`,
      );
    }
    if (criteria.light && product.light !== criteria.light) {
      problems.push(`${product.name}: fényigénye ${product.light}, a kért ${criteria.light}.`);
    }
    if (criteria.maxHeightCm && product.maxHeightCm > criteria.maxHeightCm) {
      problems.push(
        `${product.name}: kifejlett magassága ${product.maxHeightCm} cm, a megengedett ${criteria.maxHeightCm} cm.`,
      );
    }
    const unitPrice = Number(product.salePrice ?? product.price);
    planItems.push({
      productId: product.id,
      name: product.name,
      qty: item.qty,
      unitPrice,
      lineTotal: unitPrice * item.qty,
    });
  }

  const totalPrice = planItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const budget = Number(customer.budget);
  // A KEMÉNY KORLÁT: az ügyfél kerete. Nem ajánlás — a validálás itt bukik, ha túllépné.
  if (totalPrice > budget) {
    problems.push(
      `Az összár ${totalPrice} Ft, az ügyfél kerete ${budget} Ft — a keret kemény korlát, csökkents darabszámot vagy cserélj tételt.`,
    );
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    plan: {
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      budget,
      items: planItems,
      totalPrice,
      remaining: budget - totalPrice,
    },
  };
}
