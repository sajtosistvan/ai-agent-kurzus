import { executeRunSql } from './run-sql.js';

describe('executeRunSql', () => {
  it('rejects invalid input before touching the DB', async () => {
    const out = await executeRunSql({ query: '' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Hibás tool-bemenet');
  });

  it('rejects non-SELECT statements via the guard', async () => {
    const out = await executeRunSql({ query: 'DELETE FROM products' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('SQL elutasítva');
  });
});
