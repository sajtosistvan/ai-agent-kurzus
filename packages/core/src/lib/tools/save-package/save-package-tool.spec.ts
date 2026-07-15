import { executeSavePackage } from './save-package-tool.js';

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

describe('executeSavePackage', () => {
  it('érvényes csomag → mentés, a válaszban a csomag-azonosító és az összár', async () => {
    const { prisma, created } = fakePrisma();
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] }, { prisma },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toContain('#42');
    expect(out.content).toContain('20000');
    expect(created.length).toBe(2); // 1 package + 1 item-sor
  });

  it('ÚJRA validál: érvénytelen csomag NEM íródik be', async () => {
    const { prisma, created } = fakePrisma();
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, { prisma }, // 40 000 > keret
    );
    expect(out.isError).toBe(true);
    expect(created.length).toBe(0);
  });

  it('DB-hiba a tranzakcióban → ToolOutcome hiba, nem exception', async () => {
    const { prisma } = fakePrisma({
      $transaction: async () => { throw new Error('kapcsolat megszakadt'); },
    });
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('mentés');
  });

  it('érvénytelen input → magyar hiba', async () => {
    expect((await executeSavePackage({})).isError).toBe(true);
  });
});
