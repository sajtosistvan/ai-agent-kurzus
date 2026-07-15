import { clipTitle, rowToUIMessage } from './threads.js';

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
