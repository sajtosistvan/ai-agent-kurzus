import { executeTool } from './index.js';

describe('executeTool', () => {
  it('rejects an unknown tool without throwing', async () => {
    const out = await executeTool('nincsilyen', {});
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Ismeretlen tool');
  });

  it('rejects invalid runSql input before touching the DB', async () => {
    const out = await executeTool('runSql', { query: '' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Hibás tool-bemenet');
  });
});
