import { loadConfig, resetConfigCache, ConfigError } from './config.js';

describe('loadConfig', () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    resetConfigCache();
    process.env = { ...ORIGINAL };
    process.env.DATABASE_URL_READONLY =
      'postgresql://ro@localhost:5433/plantbase';
  });

  afterEach(() => {
    process.env = ORIGINAL;
    resetConfigCache();
  });

  it('should read a valid key and default the model when unset', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-valid-key';
    delete process.env.ANTHROPIC_MODEL;
    const config = loadConfig();
    expect(config.apiKey).toBe('sk-ant-valid-key');
    expect(config.model).toBe('claude-sonnet-4-6');
  });

  it('should respect an explicit model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-valid-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
    expect(loadConfig().model).toBe('claude-haiku-4-5');
  });

  it('should reject the placeholder key with a ConfigError', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-...';
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('should reject a missing key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
  });
});
