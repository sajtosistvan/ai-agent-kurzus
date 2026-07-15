import { describe, expect, it } from 'vitest';
import { executeRouteTo } from './route-to-tool.js';

describe('executeRouteTo', () => {
  it('érvényes döntés → nem hiba, a summary hordozza az irányt és az indokot', () => {
    const out = executeRouteTo({ agent: 'package-agent', reason: 'csomagot kér az ügyfélnek' });
    expect(out.isError).toBe(false);
    expect(out.summary).toContain('package-agent');
    expect(out.summary).toContain('csomagot kér');
  });

  it('ismeretlen agent → magyar hiba, nem exception', () => {
    const out = executeRouteTo({ agent: 'valami-agent', reason: 'x' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('info-agent');
  });

  it('hiányzó indok → hiba', () => {
    expect(executeRouteTo({ agent: 'info-agent' }).isError).toBe(true);
  });
});
