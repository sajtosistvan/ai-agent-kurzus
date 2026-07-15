import { executeValidatePackage } from './validate-package-tool.js';

const customer = {
  id: 7, code: 'ACME', name: 'ACME Studio Kft.', budget: 30000, expertiseLevel: 'kezdő',
  petSafeRequired: true, kidSafeRequired: false,
};
const monstera = {
  id: 1, name: 'Monstera', price: 10000, salePrice: null, stock: 5,
  petSafe: true, kidSafe: true, difficulty: 'kezdő', light: 'közepes', maxHeightCm: 120,
};
const kroton = {
  id: 2, name: 'Kroton', price: 8000, salePrice: 6000, stock: 2,
  petSafe: false, kidSafe: false, difficulty: 'haladó', light: 'erős', maxHeightCm: 90,
};

function fakePrisma(cust: unknown, products: unknown[]) {
  return {
    customer: { findUnique: async () => cust },
    product: { findMany: async () => products },
  } as never;
}

describe('executeValidatePackage', () => {
  it('érvényes csomag → strukturált plan JSON-nal, onPlan lefut', async () => {
    let plan: unknown = null;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] },
      { prisma: fakePrisma(customer, [monstera]), onPlan: (p) => { plan = p; } },
    );
    expect(out.isError).toBe(false);
    const parsed = JSON.parse(out.content);
    expect(parsed.totalPrice).toBe(20000);
    expect(parsed.remaining).toBe(10000);
    expect(parsed.customerId).toBe(7);
    expect(plan).not.toBeNull();
  });

  it('budget kemény korlát: túllépés → hiba, onPlan NEM fut', async () => {
    let planCalled = false;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, // 40 000 > 30 000
      { prisma: fakePrisma(customer, [monstera]), onPlan: () => { planCalled = true; } },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('keret');
    expect(planCalled).toBe(false);
  });

  it('pet-safe és difficulty szabályok érvényesülnek (magyar hibalista)', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma(customer, [kroton]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('pet-safe');
    expect(out.content).toContain('haladó');
  });

  it('készlet-hiány → hiba a darabszámmal', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 9 }] },
      { prisma: fakePrisma(customer, [{ ...monstera, stock: 3 }]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('3');
  });

  it('fény- és méret-kritérium ellenőrzés', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }], light: 'árnyék', maxHeightCm: 100 },
      { prisma: fakePrisma(customer, [monstera]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('árnyék');
    expect(out.content).toContain('120');
  });

  it('ismeretlen ügyfél / termék → magyar hiba', async () => {
    const noCust = await executeValidatePackage(
      { customerCode: 'NINCS', items: [{ productId: 1, qty: 1 }] },
      { prisma: fakePrisma(null, []) },
    );
    expect(noCust.isError).toBe(true);
    const noProd = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 99, qty: 1 }] },
      { prisma: fakePrisma(customer, []) },
    );
    expect(noProd.isError).toBe(true);
    expect(noProd.content).toContain('99');
  });

  it('érvénytelen input és DB-hiba → ToolOutcome, nem exception', async () => {
    expect((await executeValidatePackage({ items: [] })).isError).toBe(true);
    const boom = { customer: { findUnique: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma: boom },
    );
    expect(out.isError).toBe(true);
  });

  it('akciós ár számít (salePrice, ha van)', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma({ ...customer, petSafeRequired: false, expertiseLevel: 'profi' }, [kroton]) },
    );
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content).totalPrice).toBe(6000);
  });
});
