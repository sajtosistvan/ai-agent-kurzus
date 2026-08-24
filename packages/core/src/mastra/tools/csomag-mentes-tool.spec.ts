import { describe, expect, it } from 'vitest';
import { mentsCsomagot } from './csomag-mentes-tool.js';

const customer = {
  id: 7, code: 'ACME', name: 'ACME Studio Kft.', budget: 30000, expertiseLevel: 'kezdő',
  petSafeRequired: false, kidSafeRequired: false,
};
const monstera = {
  id: 1, name: 'Monstera', price: 10000, salePrice: null, stock: 5,
  petSafe: true, kidSafe: true, difficulty: 'kezdő', light: 'közepes', maxHeightCm: 120,
};

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const created: unknown[] = [];
  const tx = {
    package: { create: async ({ data }: { data: object }) => { created.push(data); return { id: 42, ...data }; } },
    packageItem: { createMany: async ({ data }: { data: object[] }) => { created.push(...data); return { count: data.length }; } },
  };
  return {
    prisma: {
      customer: { findUnique: async () => customer },
      product: { findMany: async () => [monstera] },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      ...overrides,
    } as never,
    created,
  };
}

describe('mentsCsomagot', () => {
  it('érvényes csomag → mentés, a válaszban a csomag-azonosító és az összár', async () => {
    const { prisma, created } = fakePrisma();
    const ki = await mentsCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] }, { prisma },
    );
    expect(ki.sikeres).toBe(true);
    expect(ki.csomagId).toBe(42);
    expect(ki.osszar).toBe(20000);
    expect(created.length).toBe(2); // 1 package + 1 item-sor
  });

  it('ÚJRA validál: érvénytelen csomag NEM íródik be', async () => {
    const { prisma, created } = fakePrisma();
    const ki = await mentsCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, { prisma }, // 40 000 > keret
    );
    expect(ki.sikeres).toBe(false);
    expect(created.length).toBe(0);
  });

  it('DB-hiba a tranzakcióban → strukturált hiba, nem exception', async () => {
    const { prisma } = fakePrisma({
      $transaction: async () => { throw new Error('kapcsolat megszakadt'); },
    });
    const ki = await mentsCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma },
    );
    expect(ki.sikeres).toBe(false);
    expect(ki.uzenet).toContain('mentése nem sikerült');
  });

  it('érvénytelen input → magyar hiba', async () => {
    expect((await mentsCsomagot({})).sikeres).toBe(false);
  });
});
