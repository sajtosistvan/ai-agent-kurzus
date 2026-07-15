import { buildPackageToolset } from './package-agent.js';
import { buildPackagePrompt } from './package-prompt.js';

describe('buildPackageToolset', () => {
  it('router mód: requestInfo VAN, askInfoAgent NINCS', () => {
    const tools = buildPackageToolset({ mode: 'router' });
    expect(Object.keys(tools)).toContain('requestInfo');
    expect(Object.keys(tools)).not.toContain('askInfoAgent');
    expect(Object.keys(tools)).not.toContain('runSql'); // nincs saját adat-út
  });

  it('delegate mód: askInfoAgent VAN, requestInfo NINCS', () => {
    const tools = buildPackageToolset({ mode: 'delegate' });
    expect(Object.keys(tools)).toContain('askInfoAgent');
    expect(Object.keys(tools)).not.toContain('requestInfo');
  });

  it('a közös kapuk mindkét módban ott vannak', () => {
    for (const mode of ['router', 'delegate'] as const) {
      const names = Object.keys(buildPackageToolset({ mode }));
      expect(names).toEqual(expect.arrayContaining(['queryCustomers', 'validatePackage', 'savePackage', 'cancelPackage']));
    }
  });
});

describe('buildPackagePrompt', () => {
  it('a prompt a mód szerinti adat-toolt írja le — nem csúszhat el a toolsettől', () => {
    expect(buildPackagePrompt('router')).toContain('requestInfo');
    expect(buildPackagePrompt('router')).not.toContain('askInfoAgent');
    expect(buildPackagePrompt('delegate')).toContain('askInfoAgent');
  });
});
