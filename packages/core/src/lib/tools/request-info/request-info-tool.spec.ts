import { describe, expect, it } from 'vitest';
import { executeRequestInfo } from './request-info-tool.js';

describe('executeRequestInfo', () => {
  it('a kérdést átadja az onRequestInfo callbacknek, és lezárja a kört', () => {
    let captured: string | null = null;
    const out = executeRequestInfo(
      { question: 'Hány pet-safe növény van raktáron 10 000 Ft alatt?' },
      { onRequestInfo: (q) => { captured = q; } },
    );
    expect(out.isError).toBe(false);
    expect(captured).toContain('pet-safe');
    expect(out.content).toContain('továbbítottam');
  });

  it('üres kérdés → hiba, a callback NEM fut', () => {
    let called = false;
    const out = executeRequestInfo({ question: '  ' }, { onRequestInfo: () => { called = true; } });
    expect(out.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('callback nélkül is működik (nem dob)', () => {
    expect(executeRequestInfo({ question: 'mi?' }).isError).toBe(false);
  });
});
