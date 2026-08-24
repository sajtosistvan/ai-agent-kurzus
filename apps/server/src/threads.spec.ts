import { clipTitle } from './threads.js';

// A korábbi `rowToUIMessage` / `stripDataParts` / `dropTrailingUserRow` tesztek megszűntek:
// azokat a függvényeket a Mastra Memory váltotta ki (ő tárolja és adja vissza az előzményt).
// Ami a mienk maradt, az a thread-cím formázása — ezt teszteljük.

describe('clipTitle', () => {
  it('rövid szöveget változatlanul hagy', () => {
    expect(clipTitle('Pet-safe növények?')).toBe('Pet-safe növények?');
  });
  it('60 karakter fölött levág és … jelet tesz', () => {
    const long = 'a'.repeat(80);
    expect(clipTitle(long)).toHaveLength(61); // 60 + '…'
    expect(clipTitle(long).endsWith('…')).toBe(true);
  });
  it('sortöréseket szóközzé lapít', () => {
    expect(clipTitle('első\nmásodik')).toBe('első második');
  });
});
