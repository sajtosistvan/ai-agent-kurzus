import { describe, expect, it } from 'vitest';
import { ellenorizCsomagot } from './csomag-ellenorzes-tool.js';

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

/** A hibalista egyben, hogy a magyar szövegre könnyű legyen állítani. */
function problemakSzovege(problemak: string[]): string {
  return problemak.join('\n');
}

describe('ellenorizCsomagot', () => {
  it('érvényes csomag → strukturált terv a kimenetben', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] },
      { prisma: fakePrisma(customer, [monstera]) },
    );
    expect(ki.sikeres).toBe(true);
    expect(ki.terv?.totalPrice).toBe(20000);
    expect(ki.terv?.remaining).toBe(10000);
    expect(ki.terv?.customerId).toBe(7);
  });

  it('budget kemény korlát: túllépés → hiba, nincs terv', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, // 40 000 > 30 000
      { prisma: fakePrisma(customer, [monstera]) },
    );
    expect(ki.sikeres).toBe(false);
    expect(ki.terv).toBeNull();
    expect(problemakSzovege(ki.problemak)).toContain('keret');
  });

  it('pet-safe és difficulty szabályok érvényesülnek (magyar hibalista)', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma(customer, [kroton]) },
    );
    expect(ki.sikeres).toBe(false);
    expect(problemakSzovege(ki.problemak)).toContain('pet-safe');
    expect(problemakSzovege(ki.problemak)).toContain('haladó');
  });

  it('készlet-hiány → hiba a darabszámmal', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 9 }] },
      { prisma: fakePrisma(customer, [{ ...monstera, stock: 3 }]) },
    );
    expect(ki.sikeres).toBe(false);
    expect(problemakSzovege(ki.problemak)).toContain('3');
  });

  it('fény- és méret-kritérium ellenőrzés', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }], light: 'árnyék', maxHeightCm: 100 },
      { prisma: fakePrisma(customer, [monstera]) },
    );
    expect(ki.sikeres).toBe(false);
    expect(problemakSzovege(ki.problemak)).toContain('árnyék');
    expect(problemakSzovege(ki.problemak)).toContain('120');
  });

  it('ismeretlen ügyfél / termék → magyar hiba', async () => {
    const nincsUgyfel = await ellenorizCsomagot(
      { customerCode: 'NINCS', items: [{ productId: 1, qty: 1 }] },
      { prisma: fakePrisma(null, []) },
    );
    expect(nincsUgyfel.sikeres).toBe(false);
    const nincsTermek = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 99, qty: 1 }] },
      { prisma: fakePrisma(customer, []) },
    );
    expect(nincsTermek.sikeres).toBe(false);
    expect(problemakSzovege(nincsTermek.problemak)).toContain('99');
  });

  it('érvénytelen input és DB-hiba → strukturált kimenet, nem exception', async () => {
    expect((await ellenorizCsomagot({ items: [] })).sikeres).toBe(false);
    const boom = { customer: { findUnique: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma: boom },
    );
    expect(ki.sikeres).toBe(false);
  });

  it('akciós ár számít (salePrice, ha van)', async () => {
    const ki = await ellenorizCsomagot(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma({ ...customer, petSafeRequired: false, expertiseLevel: 'profi' }, [kroton]) },
    );
    expect(ki.sikeres).toBe(true);
    expect(ki.terv?.totalPrice).toBe(6000);
  });
});
