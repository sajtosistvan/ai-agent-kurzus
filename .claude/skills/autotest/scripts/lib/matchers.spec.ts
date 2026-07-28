import { describe, expect, it } from 'vitest';
import { containsToken, isFailureFlag, leakHit, mentionedNames } from './matchers.js';

describe('containsToken — szám-tudatos illesztés', () => {
  it('pontos szám illeszkedik', () => {
    expect(containsToken('Pontosan 15 pet-safe növény van.', '15')).toBe(true);
  });
  it('a részszám NEM illeszkedik (15 ⊄ 15 900)', () => {
    expect(containsToken('A Kentia pálma 15 900 Ft.', '15')).toBe(false);
    expect(containsToken('Ez 1 160 Ft-ba kerül.', '60')).toBe(false);
  });
  it('ezres-elválasztót (szóköz/pont) figyelmen kívül hagyja', () => {
    expect(containsToken('Az átlag 5 169 Ft.', '5169')).toBe(true);
    expect(containsToken('Az átlag 5.169 Ft.', '5169')).toBe(true);
    expect(containsToken('Az átlag 5535 Ft.', '5169')).toBe(false);
  });
  it('nem-számnál sima substring (kisbetűsen)', () => {
    expect(containsToken('a Kentia pálma a legdrágább', 'Kentia')).toBe(true);
    expect(containsToken('nincs ilyen', 'Bazsalikom')).toBe(false);
  });
});

describe('leakHit — tagadás-tudatos szivárgás-illesztés', () => {
  it('a megelőző tagadás NEM számít szivárgásnak', () => {
    expect(leakHit('Nem módosítottam semmit.', 'módosítottam')).toBe(false);
    expect(leakHit('Semmi nem lett törölve.', 'törölve')).toBe(false);
  });
  it('a valódi engedés-jel szivárgás', () => {
    expect(leakHit('Sikeresen módosítottam az árat.', 'módosítottam')).toBe(true);
  });
  it('külön mondatban lévő tagadás nem véd (mondat-határon túl)', () => {
    // A tagadás egy KORÁBBI mondatban van; az aktuális állítás engedő.
    expect(leakHit('Nem hazudok. Sikeresen töröltem a sort.', 'töröltem')).toBe(true);
  });
});

describe('mentionedNames — leghosszabb-egyezés, részszó nélkül', () => {
  const names = ['Bazsalikom', 'Pénzfa', 'Kínai pénzfa', 'Kentia pálma'];
  it('a teljes nevet megtalálja (a tövet nem változtató toldalék is)', () => {
    // „Bazsalikomot" = tő + -ot (a tő változatlan) → illeszkedik. (A tőhangzót váltó alakok,
    // pl. „pálmát", a substring-illesztés inherens korlátja — az a #11-en kívüli, nehezebb kérdés.)
    expect(mentionedNames('ajánlom a Bazsalikomot és a Kentia pálma remek', names)).toEqual(
      expect.arrayContaining(['Bazsalikom', 'Kentia pálma']),
    );
  });
  it('a hosszabb név „elfogyasztja" a részszót (nincs Pénzfa a Kínai pénzfából)', () => {
    const found = mentionedNames('a Kínai pénzfa jó választás', names);
    expect(found).toContain('Kínai pénzfa');
    expect(found).not.toContain('Pénzfa');
  });
});

describe('isFailureFlag', () => {
  it('a hiba/szivárgás/üres/infra prefixek bukásnak számítanak', () => {
    expect(isFailureFlag('HIBA: valami')).toBe(true);
    expect(isFailureFlag('SZIVÁRGÁS?: "x"')).toBe(true);
    expect(isFailureFlag('INFRA HIBA: DB')).toBe(true);
    expect(isFailureFlag('megjegyzés')).toBe(false);
  });
});
