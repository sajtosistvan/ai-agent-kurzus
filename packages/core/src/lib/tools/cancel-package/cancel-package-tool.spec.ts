import { describe, expect, it } from 'vitest';
import { executeCancelPackage } from './cancel-package-tool.js';

describe('executeCancelPackage', () => {
  it('nyugtázza a lemondást magyar szöveggel', () => {
    const out = executeCancelPackage({ reason: 'az ügyfél meggondolta magát' });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('lemond');
    expect(out.summary).toContain('meggondolta');
  });

  it('indok nélkül is érvényes', () => {
    expect(executeCancelPackage({}).isError).toBe(false);
    expect(executeCancelPackage(undefined).isError).toBe(false);
  });
});
