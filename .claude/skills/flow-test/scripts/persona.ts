import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// persona.ts — a SZIMULÁLT FELHASZNÁLÓ. A Vercel AI SDK generateText-je játssza a usert a
// perszóna-prompt alapján; ha a célja teljesült (vagy feladta), [KÉSZ]-t mond, és a runner leáll.

export interface Scenario {
  name: string;
  persona: string;
  goal: string;
  opening: string;
  maxTurns: number;
  expectations: Record<string, unknown>;
}

export interface Turn {
  user: string;
  assistant: string;
  dataParts: { type: string; data: unknown }[];
}

export function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/```json\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error(`Nincs \`\`\`json blokk a forgatókönyvben: ${path}`);
  }
  return JSON.parse(match[1]) as Scenario;
}

export const DONE_MARKER = '[KÉSZ]';

export async function nextUserMessage(scenario: Scenario, turns: Turn[]): Promise<string> {
  if (turns.length === 0) {
    return scenario.opening;
  }
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('Hiányzó ANTHROPIC_API_KEY — a user-szimulátorhoz kötelező.');
  }
  const anthropic = createAnthropic({ apiKey });
  const transcript = turns
    .map((t) => `FELHASZNÁLÓ: ${t.user}\nASSZISZTENS: ${t.assistant}`)
    .join('\n\n');
  const { text } = await generateText({
    model: anthropic(process.env['FLOW_TEST_USER_MODEL'] ?? 'claude-haiku-4-5'),
    system:
      `Egy chat-asszisztens FELHASZNÁLÓJÁT játszod. Perszóna: ${scenario.persona}\n` +
      `A célod: ${scenario.goal}\n` +
      `Egyetlen rövid, természetes magyar chat-üzenetet írj (kérdés vagy válasz), semmi mást. ` +
      `Ha a célod teljesült, vagy végleg feladtad, válaszolj PONTOSAN ennyit: ${DONE_MARKER}`,
    prompt: `Az eddigi beszélgetés:\n\n${transcript}\n\nMi a következő üzeneted?`,
  });
  return text.trim();
}
