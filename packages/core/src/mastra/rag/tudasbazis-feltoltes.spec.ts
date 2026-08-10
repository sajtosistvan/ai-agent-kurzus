import { describe, it, expect } from 'vitest';
import { darabolDokumentumot } from './tudasbazis-feltoltes.js';

// A darabolást a Mastra MDocument végzi — mi azt ellenőrizzük, amiért MI felelünk:
// a darabok stabil azonosítót és a grounding-hoz szükséges metaadatot (forrás, cím) kapjanak,
// és a chunk szövege a `text` mezőben legyen (a PgVector-nak nincs külön tartalom-oszlopa).

const DOKUMENTUM = {
  forras: 'https://example.com/monstera',
  cim: 'Monstera gondozás',
  kategoria: 'gondozás',
  szoveg: [
    '## Öntözés',
    'A monstera a felső 2-3 centi kiszáradása után kér vizet. Túlöntözve gyökere rothad.',
    '## Fény',
    'Szórt, erős fényt szeret. A direkt nap megégeti a leveleit.',
  ].join('\n\n'),
};

describe('darabolDokumentumot', () => {
  it('darabokat ad vissza, mindegyik a saját szövegével', async () => {
    const darabok = await darabolDokumentumot(DOKUMENTUM);

    expect(darabok.length).toBeGreaterThan(0);
    for (const darab of darabok) {
      expect(darab.szoveg.length).toBeGreaterThan(0);
      expect(darab.metaadat['text']).toBe(darab.szoveg);
    }
  });

  it('minden darabra ráteszi a forrást és a címet (grounding)', async () => {
    const darabok = await darabolDokumentumot(DOKUMENTUM);

    for (const darab of darabok) {
      expect(darab.metaadat['source']).toBe(DOKUMENTUM.forras);
      expect(darab.metaadat['title']).toBe(DOKUMENTUM.cim);
      expect(darab.metaadat['category']).toBe(DOKUMENTUM.kategoria);
    }
  });

  it('stabil, ütközésmentes azonosítót ad (újra-feltöltéskor felülír)', async () => {
    const elso = await darabolDokumentumot(DOKUMENTUM);
    const masodik = await darabolDokumentumot(DOKUMENTUM);

    expect(masodik.map((d) => d.id)).toEqual(elso.map((d) => d.id));
    expect(new Set(elso.map((d) => d.id)).size).toBe(elso.length);
    expect(elso[0]?.id).toBe(`${DOKUMENTUM.forras}#0`);
  });
});
