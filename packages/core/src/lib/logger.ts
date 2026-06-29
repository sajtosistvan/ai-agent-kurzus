import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Átláthatóság (FR4): minden interakciót JSONL-be naplózunk a logs/<timestamp>.jsonl fájlba.
// Egy interakció = egy fájl; soronként egy esemény (request, response, később tool-lépések),
// hogy a B3 tool-use loopja is bővíthető legyen.

export interface InteractionLog {
  question: string;
  model: string;
  systemPrompt: string;
  messages: unknown;
  answer: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
}

function timestampSlug(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${iso}-${suffix}`;
}

export function logInteraction(entry: InteractionLog): string {
  const dir = join(process.cwd(), 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${timestampSlug()}.jsonl`);

  const at = new Date().toISOString();
  const lines = [
    JSON.stringify({
      type: 'request',
      at,
      model: entry.model,
      question: entry.question,
      systemPrompt: entry.systemPrompt,
      messages: entry.messages,
    }),
    JSON.stringify({
      type: 'response',
      at,
      answer: entry.answer,
      usage: entry.usage,
      stopReason: entry.stopReason,
    }),
  ];

  appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}
