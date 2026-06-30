import { buildSystemPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt();

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
