import { executeTool, CLIENT_PREFERENCES } from './index.js';

describe('executeTool', () => {
  it('rejects an unknown tool without throwing', async () => {
    const out = await executeTool('nincsilyen', {});
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Ismeretlen tool');
  });

  it('returns budget and care level for a known client code', async () => {
    const out = await executeTool('getClientPreferences', {
      clientCode: 'INITECH',
    });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content)).toEqual(CLIENT_PREFERENCES.INITECH);
  });

  it('rejects an unknown client code without touching state', async () => {
    const out = await executeTool('getClientPreferences', {
      clientCode: 'NINCSILYEN',
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('ügyfélkód');
  });

  it('rejects invalid runSql input before touching the DB', async () => {
    const out = await executeTool('runSql', { query: '' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Hibás tool-bemenet');
  });
});
