import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { buildSystemPromptNoDb } from './system-prompt.js';
import { logInteraction } from './logger.js';

// B2 — askAgent: egyetlen, sima messages.create hívás, TOOL NÉLKÜL. Az agent válaszol a saját
// tudásából; a katalógus-adatra a system prompt szerint őszintén jelzi, hogy nincs DB-hozzáférése.
// A B3-ban ezt bővítjük a runSql toollal és a kézzel írt tool-use loopgal.

const MAX_TOKENS = 1024;

export interface AskResult {
  answer: string;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
  logPath: string;
}

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export async function askAgent(question: string): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres kérdést nem lehet feltenni.');
  }

  const config = loadConfig();
  const systemPrompt = buildSystemPromptNoDb();
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: trimmed },
  ];

  const response = await getClient(config.apiKey).messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  const answer = extractText(response.content);
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  const logPath = logInteraction({
    question: trimmed,
    model: config.model,
    systemPrompt,
    messages,
    answer,
    usage,
    stopReason: response.stop_reason,
  });

  return {
    answer,
    systemPrompt,
    messages,
    model: config.model,
    usage,
    stopReason: response.stop_reason,
    logPath,
  };
}
