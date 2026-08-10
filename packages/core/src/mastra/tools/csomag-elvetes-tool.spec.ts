import { describe, expect, it } from 'vitest';
import { csomagElvetesTool, type CsomagElvetesKimenet } from './csomag-elvetes-tool.js';

// A Mastra `execute` visszatérése unió (validációs hiba is lehet); a teszt a saját alakunkra szűkíti.
async function elvet(bemenet: { reason?: string }): Promise<CsomagElvetesKimenet> {
  return (await csomagElvetesTool.execute!(bemenet, {} as never)) as CsomagElvetesKimenet;
}

describe('csomag_elvetes tool', () => {
  it('nyugtázza a lemondást magyar szöveggel, és megőrzi az indokot', async () => {
    const ki = await elvet({ reason: 'az ügyfél meggondolta magát' });
    expect(ki.sikeres).toBe(true);
    expect(ki.uzenet).toContain('lemond');
    expect(ki.indok).toContain('meggondolta');
  });

  it('indok nélkül is érvényes, alapértelmezett indokkal', async () => {
    const ki = await elvet({});
    expect(ki.sikeres).toBe(true);
    expect(ki.indok).toBe('a felhasználó lemondta');
  });
});
