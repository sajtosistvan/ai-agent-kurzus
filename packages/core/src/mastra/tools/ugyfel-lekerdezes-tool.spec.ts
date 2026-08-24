import { describe, expect, it } from 'vitest';
import { lekerdezUgyfeleket } from './ugyfel-lekerdezes-tool.js';

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

describe('lekerdezUgyfeleket', () => {
  it('kód szerint visszaadja az ügyfelet', async () => {
    const ki = await lekerdezUgyfeleket(
      { code: 'ACME' },
      { prisma: fakePrisma([acme]), szerep: 'admin' },
    );
    expect(ki.sikeres).toBe(true);
    expect(ki.talalatokSzama).toBe(1);
    expect(ki.ugyfelek[0].code).toBe('ACME');
  });

  it('nincs találat → nem hiba, hanem magyar üzenet', async () => {
    const ki = await lekerdezUgyfeleket(
      { code: 'NINCS' },
      { prisma: fakePrisma([]), szerep: 'admin' },
    );
    expect(ki.sikeres).toBe(true);
    expect(ki.talalatokSzama).toBe(0);
    expect(ki.uzenet).toContain('Nincs ilyen ügyfél');
  });

  it('DB-hiba → strukturált hiba a sémában, nem exception', async () => {
    const boom = { customer: { findMany: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const ki = await lekerdezUgyfeleket({}, { prisma: boom, szerep: 'admin' });
    expect(ki.sikeres).toBe(false);
    expect(ki.hiba).toContain('ügyfél-lekérdezés');
  });
});

// ============================================================================
// SZEREPKÖR-KAPU — egy red team scan (promptfoo, pii:direct + pii:api-db) találta a rést:
// vásárlóként kilistázható volt 20 ügyfél neve, városa, költségkerete és BELSŐ jegyzete.
// Ezek a tesztek azt rögzítik, hogy a rés zárva marad.
// ============================================================================
describe('lekerdezUgyfeleket — szerepkör-kapu', () => {
  const prisma = fakePrisma([acme]);

  it('vásárló NEM listázhatja az ügyfeleket (üres bemenet)', async () => {
    const ki = await lekerdezUgyfeleket({}, { prisma, szerep: 'customer' });
    expect(ki.sikeres).toBe(false);
    expect(ki.ugyfelek).toHaveLength(0);
    expect(ki.hiba).toContain('nem engedélyezett');
  });

  it('vásárló NEM kereshet név vagy város szerint', async () => {
    const nev = await lekerdezUgyfeleket({ search: 'Kovács' }, { prisma, szerep: 'customer' });
    expect(nev.sikeres).toBe(false);
    const varos = await lekerdezUgyfeleket({ search: 'Budapest' }, { prisma, szerep: 'customer' });
    expect(varos.sikeres).toBe(false);
  });

  it('vásárló NEM szűrhet ügyféltípusra', async () => {
    const ki = await lekerdezUgyfeleket({ customerType: 'hotel' }, { prisma, szerep: 'customer' });
    expect(ki.sikeres).toBe(false);
  });

  it('az elutasítás nem árulja el, létezik-e az ügyfél (nincs felderítő orákulum)', async () => {
    const letezik = await lekerdezUgyfeleket(
      { search: 'ACME Studio' },
      { prisma: fakePrisma([acme]), szerep: 'customer' },
    );
    const nemLetezik = await lekerdezUgyfeleket(
      { search: 'Kovács Anna' },
      { prisma: fakePrisma([]), szerep: 'customer' },
    );
    expect(letezik.hiba).toBe(nemLetezik.hiba);
    expect(letezik.talalatokSzama).toBe(nemLetezik.talalatokSzama);
  });

  it('vásárló pontos KÓDDAL lekérhet — de a belső jegyzet nem megy ki', async () => {
    const ki = await lekerdezUgyfeleket({ code: 'ACME' }, { prisma, szerep: 'customer' });
    expect(ki.sikeres).toBe(true);
    expect(ki.ugyfelek[0].code).toBe('ACME');
    expect(ki.ugyfelek[0].budget).toBe(15000);
    expect(ki.ugyfelek[0].notes).toBeNull();
  });

  it('belső munkatárs mindent lát, a jegyzetet is', async () => {
    const ki = await lekerdezUgyfeleket({ search: 'Budapest' }, { prisma, szerep: 'admin' });
    expect(ki.sikeres).toBe(true);
    expect(ki.ugyfelek[0].notes).toContain('Kis belvárosi iroda');
  });

  it('szerep nélkül a SZŰKEBB jog érvényes (biztonságos alapértelmezés)', async () => {
    const ki = await lekerdezUgyfeleket({}, { prisma });
    expect(ki.sikeres).toBe(false);
    expect(ki.hiba).toContain('nem engedélyezett');
  });
});
