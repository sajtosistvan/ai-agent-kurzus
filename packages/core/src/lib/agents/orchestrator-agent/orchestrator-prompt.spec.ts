import { buildOrchestratorPrompt } from './orchestrator-prompt.js';

describe('buildOrchestratorPrompt', () => {
  it('a routeTo toolt és mindkét cél-agentet leírja — a döntéshez ez a minimum', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('routeTo');
    expect(prompt).toContain('info-agent');
    expect(prompt).toContain('package-agent');
  });

  it('kimondja, hogy az orchestrator SOHA nem válaszol a felhasználónak', () => {
    expect(buildOrchestratorPrompt()).toContain('SOHA nem válaszolsz');
  });
});
