import { describe, expect, it } from 'vitest';
import { ensureReadOnlySelect } from '@plantbase/core';
import { buildPlantSearchSql, PlantSearchSchema } from './plant-search-sql.js';

// A determinisztikus kereső tesztje. Az agent-as-tool (ask_plantbase) így NEM tesztelhető —
// az modellt hív. Ez a különbség a két MCP-tool-stílus ára és haszna.

describe('buildPlantSearchSql', () => {
  it('szűrő nélkül is érvényes, LIMIT-es SELECT-et ad', () => {
    const { sql, params } = buildPlantSearchSql({});

    expect(sql).toMatch(/^SELECT .* FROM products ORDER BY .* LIMIT 10$/);
    expect(params).toEqual([]);
  });

  it('az értékeket paraméterként adja át, nem az SQL szövegében', () => {
    const { sql, params } = buildPlantSearchSql({ keres: 'monstera', maxAr: 5000 });

    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).not.toContain('monstera');
    expect(params).toEqual(['%monstera%', 5000]);
  });

  it('az injekciós kísérlet is csak egy paraméter-érték marad', () => {
    const { sql, params } = buildPlantSearchSql({ keres: "'; DROP TABLE products; --" });

    expect(sql).not.toContain('DROP');
    expect(params[0]).toBe("%'; DROP TABLE products; --%");
  });

  it('a boolean szűrők fix feltételek, nem paraméterek', () => {
    const { sql, params } = buildPlantSearchSql({ petSafe: true, csakRaktaron: true });

    expect(sql).toContain('pet_safe = TRUE');
    expect(sql).toContain('stock > 0');
    expect(params).toEqual([]);
  });

  it('a rendezés kulcsból képződik, a hívó nem ad oszlopnevet', () => {
    expect(buildPlantSearchSql({ rendezes: 'ár' }).sql).toContain(
      'ORDER BY COALESCE(sale_price, price) ASC',
    );
    expect(buildPlantSearchSql({ rendezes: 'név' }).sql).toContain('ORDER BY name ASC');
  });

  it('az eredmény átmegy a core SELECT-guardján is (védelmi rétegek)', () => {
    const { sql } = buildPlantSearchSql({ keres: 'pálma', petSafe: true });

    expect(() => ensureReadOnlySelect(sql)).not.toThrow();
  });
});

describe('PlantSearchSchema', () => {
  it('elutasítja az ismeretlen enum-értéket', () => {
    expect(PlantSearchSchema.safeParse({ kategoria: 'űrnövény' }).success).toBe(false);
  });

  it('elutasítja a limit fölötti kérést', () => {
    expect(PlantSearchSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('átengedi az érvényes szűrő-kombinációt', () => {
    const parsed = PlantSearchSchema.safeParse({
      kategoria: 'szobanövény',
      feny: 'alacsony',
      maxAr: 12000,
      petSafe: true,
      rendezes: '-ár',
    });

    expect(parsed.success).toBe(true);
  });
});
