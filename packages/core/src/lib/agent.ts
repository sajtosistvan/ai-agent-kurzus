import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { buildSystemPrompt } from './prompts.js';
import { logInteraction, type ToolStepLog } from './logger.js';
import { runSqlTool, executeRunSql } from './runsql-tool.js';

// B3 — askAgent: KÉZZEL ÍRT tool-use loop az Anthropic SDK messages.create fölött (nem helper,
// nem agent-framework — architektura.md 3. pont). A modell SQL-t ír, a runSql toollal lefuttatja
// a katalóguson (read-only), és a sorokból magyar választ ad. Több lépés (multistep) megengedett.

const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 6;

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
  const systemPrompt = buildSystemPrompt();
  const anthropic = getClient(config.apiKey);
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: trimmed },
  ];
  const steps: ToolStepLog[] = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let answer = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: [runSqlTool],
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    stopReason = response.stop_reason;

    // Az asszisztens fordulóját (szöveg + esetleges tool_use blokkok) hozzáfűzzük.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      answer = extractText(response.content);
      break;
    }

    // Minden tool_use blokkot lefuttatunk, és tool_result-ként visszaadjuk a modellnek.
    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const outcome = await executeRunSql(toolUse.input);
      steps.push({
        sql: outcome.executedSql,
        rowCount: outcome.rowCount,
        isError: outcome.isError,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (answer === '') {
    answer =
      'Nem sikerült végső választ adni a megengedett lépésszámon belül. Pontosítsd a kérdést.';
  }

  const usage = { inputTokens, outputTokens };
  const logPath = logInteraction({
    question: trimmed,
    model: config.model,
    systemPrompt,
    messages,
    answer,
    usage,
    stopReason,
    steps,
  });

  return {
    answer,
    systemPrompt,
    messages,
    model: config.model,
    usage,
    stopReason,
    logPath,
  };
}
