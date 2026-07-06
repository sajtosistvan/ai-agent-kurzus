import { buildQueryPrompt } from './query-prompt.js';

describe('buildQueryPrompt', () => {
  const prompt = buildQueryPrompt();

  it('should identify the assistant role', () => {
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('Plantbase asszisztens');
  });

  it('should include the products schema', () => {
    expect(prompt).toContain('<schema>');
    expect(prompt).toContain('products (');
  });

  it('should enforce SELECT-only', () => {
    expect(prompt).toContain('CSAK SELECT');
  });

  it('should reference the runSql tool', () => {
    expect(prompt).toContain('runSql');
  });
});
