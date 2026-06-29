import { ensureReadOnlySelect, SqlGuardError } from './sql-guard.js';

describe('ensureReadOnlySelect', () => {
  it('should pass a simple SELECT and keep an existing LIMIT', () => {
    expect(ensureReadOnlySelect('SELECT * FROM products LIMIT 5')).toBe(
      'SELECT * FROM products LIMIT 5',
    );
  });

  it('should append a default LIMIT when missing', () => {
    expect(ensureReadOnlySelect('select name from products')).toBe(
      'select name from products LIMIT 50',
    );
  });

  it('should allow a WITH ... SELECT (CTE)', () => {
    const sql = 'WITH p AS (SELECT * FROM products) SELECT name FROM p LIMIT 3';
    expect(ensureReadOnlySelect(sql)).toBe(sql);
  });

  it('should reject INSERT/UPDATE/DELETE/DDL', () => {
    expect(() => ensureReadOnlySelect('DELETE FROM products')).toThrow(
      SqlGuardError,
    );
    expect(() => ensureReadOnlySelect('UPDATE products SET stock = 0')).toThrow(
      SqlGuardError,
    );
    expect(() => ensureReadOnlySelect('DROP TABLE products')).toThrow(
      SqlGuardError,
    );
  });

  it('should reject multiple statements', () => {
    expect(() => ensureReadOnlySelect('SELECT 1; DROP TABLE products')).toThrow(
      SqlGuardError,
    );
  });

  it('should reject a non-SELECT leading statement', () => {
    expect(() => ensureReadOnlySelect('TRUNCATE products')).toThrow(
      SqlGuardError,
    );
  });

  it('should ignore a forbidden keyword that appears only in a comment', () => {
    const result = ensureReadOnlySelect(
      'SELECT name FROM products -- no delete here\nLIMIT 2',
    );
    expect(result.startsWith('SELECT name FROM products')).toBe(true);
    expect(result).toContain('LIMIT 2');
  });
});
