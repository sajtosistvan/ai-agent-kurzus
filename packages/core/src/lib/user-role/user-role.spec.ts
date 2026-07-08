import { isAdmin, CURRENT_ROLE } from './user-role.js';

describe('isAdmin', () => {
  it('is true for admin, false for customer', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('customer')).toBe(false);
  });

  it('falls back to the current role when no argument is given', () => {
    expect(isAdmin()).toBe(CURRENT_ROLE === 'admin');
  });
});
