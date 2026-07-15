import { buildQueryToolset } from './query-agent.js';

describe('buildQueryToolset', () => {
  it('vásárló nem kapja meg a delegateToIngest toolt', () => {
    const tools = buildQueryToolset('customer');
    expect(Object.keys(tools)).toEqual([
      'runSql',
      'searchKnowledge',
      'getClientPreferences',
    ]);
  });

  it('admin megkapja a delegateToIngest toolt is', () => {
    const tools = buildQueryToolset('admin');
    expect(Object.keys(tools)).toContain('delegateToIngest');
  });
});
