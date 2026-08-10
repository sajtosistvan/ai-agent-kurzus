import { describe, expect, it } from 'vitest';
import { katalogusSqlTool, type KatalogusSqlKimenet } from './katalogus-sql-tool.js';

// NFR1 tool-oldali bizonyítéka: a tool a DB ELŐTT elutasítja a nem-olvasó SQL-t, és
// mindezt HIBADOBÁS NÉLKÜL — a modell strukturált, magyar hibaszöveget kap vissza.
// (A guard részletes esetei: katalogus-sql/sql-guard.spec.ts.)

// A Mastra `execute` visszatérése unió (validációs hiba is lehet); a teszt a saját alakunkra szűkíti.
async function futtat(query: string): Promise<KatalogusSqlKimenet> {
  return (await katalogusSqlTool.execute!({ query }, {} as never)) as KatalogusSqlKimenet;
}

describe('katalogus_sql tool', () => {
  it('üres lekérdezést elutasít, mielőtt a DB-hez nyúlna', async () => {
    const ki = await futtat('');
    expect(ki.sikeres).toBe(false);
    expect(ki.hiba).toContain('bemenet');
  });

  it('nem-SELECT utasítást a guard utasít el (nincs DB-hívás, nincs kivétel)', async () => {
    const ki = await futtat('DELETE FROM products');
    expect(ki.sikeres).toBe(false);
    expect(ki.hiba).toContain('SQL elutasítva');
    expect(ki.futtatottSql).toBeNull();
  });
});
