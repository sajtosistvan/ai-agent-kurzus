import {
  executeGetClientPreferences,
  CLIENT_PREFERENCES,
} from './get-client-preferences-tool.js';

describe('executeGetClientPreferences', () => {
  it('returns budget and care level for a known client code', async () => {
    const out = await executeGetClientPreferences({ clientCode: 'INITECH' });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content)).toEqual(CLIENT_PREFERENCES.INITECH);
  });

  it('rejects an unknown client code without touching state', async () => {
    const out = await executeGetClientPreferences({
      clientCode: 'NINCSILYEN',
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('ügyfélkód');
  });
});
