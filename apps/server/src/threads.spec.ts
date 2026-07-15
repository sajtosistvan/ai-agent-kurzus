import { clipTitle, rowToUIMessage, stripDataParts, dropTrailingUserRow } from './threads.js';

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

describe('rowToUIMessage', () => {
  it('DB-sorból UIMessage-et épít', () => {
    const msg = rowToUIMessage({ id: 7, role: 'assistant', parts: [{ type: 'text', text: 'szia' }] });
    expect(msg).toEqual({ id: '7', role: 'assistant', parts: [{ type: 'text', text: 'szia' }] });
  });
});

describe('stripDataParts', () => {
  it('kiszűri a data-* partokat, a többit megtartja', () => {
    const [m] = stripDataParts([
      { id: '1', role: 'assistant', parts: [
        { type: 'data-thread', data: { threadId: 'x' } },
        { type: 'text', text: 'szia' },
      ] } as never,
    ]);
    expect(m.parts).toEqual([{ type: 'text', text: 'szia' }]);
  });
});

describe('dropTrailingUserRow', () => {
  it('eldobja a válasz nélkül maradt záró user-sort', () => {
    const rows = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' }, // korábbi hibás futás maradéka
    ];
    expect(dropTrailingUserRow(rows)).toEqual([{ role: 'user' }, { role: 'assistant' }]);
  });
  it('assistant-ra végződő előzményt változatlanul hagy', () => {
    const rows = [{ role: 'user' }, { role: 'assistant' }];
    expect(dropTrailingUserRow(rows)).toEqual(rows);
    expect(dropTrailingUserRow(rows)).toBe(rows); // nincs fölösleges másolat
  });
  it('üres listát üresen ad vissza', () => {
    expect(dropTrailingUserRow([])).toEqual([]);
  });
});
