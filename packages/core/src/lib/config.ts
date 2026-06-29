import { z } from 'zod';

// A termék futásidejű konfigurációja a környezetből (env). Rendszer-határ → Zod-validáció,
// fail-fast, beszédes hibaüzenet (konvenciok.md). Az .env betöltése az app dolga (apps/cli),
// itt csak a már betöltött process.env-et validáljuk.

const PLACEHOLDER_KEY = 'sk-ant-...';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1)
    .refine((v) => v !== PLACEHOLDER_KEY, {
      message: 'a placeholder helyett valódi kulcs kell',
    }),
  ANTHROPIC_MODEL: z.string().min(1).default(DEFAULT_MODEL),
  // Az agent runSql-je ezen a READ-ONLY kapcsolaton fut, csak SELECT (NFR1).
  DATABASE_URL_READONLY: z.string().min(1),
});

export interface Config {
  apiKey: string;
  model: string;
  databaseUrlReadonly: string;
}

let cached: Config | null = null;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(): Config {
  if (cached) {
    return cached;
  }
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'env';
    throw new ConfigError(
      `Hiányzó vagy hibás konfiguráció (${field}): ${issue?.message ?? 'ismeretlen'}. ` +
        'Másold a .env.example-t .env-be, és add meg az ANTHROPIC_API_KEY-t.',
    );
  }
  cached = {
    apiKey: parsed.data.ANTHROPIC_API_KEY,
    model: parsed.data.ANTHROPIC_MODEL,
    databaseUrlReadonly: parsed.data.DATABASE_URL_READONLY,
  };
  return cached;
}

// Tesztekhez: a cache ürítése.
export function resetConfigCache(): void {
  cached = null;
}
