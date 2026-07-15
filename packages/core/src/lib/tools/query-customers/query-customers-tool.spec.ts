import { executeQueryCustomers } from './query-customers-tool.js';

const acme = {
  code: 'ACME', name: 'ACME Studio Kft.', contactName: 'Vass Petra',
  email: 'petra@acmestudio.hu', city: 'Budapest', customerType: 'iroda',
  budget: 15000, expertiseLevel: 'kezdő',
  petSafeRequired: false, kidSafeRequired: false,
  notes: 'Kis belvárosi iroda, kevés fény.',
};

function fakePrisma(rows: unknown[]) {
  return { customer: { findMany: async () => rows } } as never;
}

describe('executeQueryCustomers', () => {
  it('kód szerint visszaadja az ügyfelet', async () => {
    const out = await executeQueryCustomers({ code: 'ACME' }, { prisma: fakePrisma([acme]) });
    expect(out.isError).toBe(false);
    expect(out.rowCount).toBe(1);
    expect(JSON.parse(out.content)[0].code).toBe('ACME');
  });

  it('nincs találat → nem hiba, hanem magyar üzenet', async () => {
    const out = await executeQueryCustomers({ code: 'NINCS' }, { prisma: fakePrisma([]) });
    expect(out.isError).toBe(false);
    expect(out.rowCount).toBe(0);
    expect(out.content).toContain('Nincs ilyen ügyfél');
  });

  it('DB-hiba → ToolOutcome hibaként, nem exception', async () => {
    const boom = { customer: { findMany: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const out = await executeQueryCustomers({}, { prisma: boom });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('ügyfél-lekérdezés');
  });
});
