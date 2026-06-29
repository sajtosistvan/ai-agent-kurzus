import { buildSystemPromptNoDb } from './system-prompt.js';

describe('buildSystemPromptNoDb', () => {
  const prompt = buildSystemPromptNoDb();

  it('should identify the assistant role', () => {
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('Plantbase asszisztens');
  });

  it('should state that there is no database access', () => {
    expect(prompt).toContain('NINCS adatbázis-hozzáférésed');
  });

  it('should forbid making up data', () => {
    expect(prompt.toLowerCase()).toContain('soha ne találj ki');
  });
});
