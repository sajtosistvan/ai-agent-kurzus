import { echo } from './echo.js';

describe('echo', () => {
  it('should prefix the input with "echo: " when given text', () => {
    expect(echo('szia')).toEqual('echo: szia');
  });

  it('should trim surrounding whitespace from the input', () => {
    expect(echo('  hello world  ')).toEqual('echo: hello world');
  });

  it('should report empty input when the string is blank', () => {
    expect(echo('   ')).toEqual('echo: (üres bemenet)');
  });
});
