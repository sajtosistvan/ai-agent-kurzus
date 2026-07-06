import {
  generateText,
  stepCountIs,
  type StepResult,
  type ToolSet,
} from 'ai';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { loadConfig } from '../config.js';
import { Trace } from '../trace.js';
import type { RunSqlOutcome } from '../tools/index.js';
import { buildIngestSystemPrompt } from './prompts.js';
import { buildIngestTools } from './tools.js';

// ingest/agent.ts — a MÁSODIK, specializált agent: a DB-töltő. Ugyanaz a mechanika, mint a
// kérdés-válasz agenté (generateText + stopWhen + Trace — a CLI-ben UGYANAZT az élő nyomot
// látod), de MINDEN MÁS a sajátja: saját system prompt (adatbetöltő szerep), saját toolok
// (fetchFeed + upsertProducts, READ-WRITE kapcsolaton), saját limitek. Önállóan él és fut —
// a multi-agent bekötés (tool call a termék-agentből) egy külön, vékony wrapper lesz.

// Az upsertProducts tool-hívás argumentumait a MODELL generálja (teljes termék-sorok) —
// ez a kimenetére számít, ezért itt nagyobb a keret, mint a kérdés-válasz agentnél.
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 8;

export interface IngestOptions {
  /** Élő, színes konzol-nyom. Alapból true; a CLI --quiet kapcsolóra false. */
  print?: boolean;
}

export interface IngestResult {
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
  tracePath: string;
}

let provider: AnthropicProvider | null = null;
function getProvider(apiKey: string): AnthropicProvider {
  if (!provider) {
    provider = createAnthropic({ apiKey });
  }
  return provider;
}

/** Az ingest-agent futtatása egy természetes nyelvű utasítással
 *  (pl. "tölts be 3 futónövényt a tropicalhome-ról"). */
export async function runIngestAgent(
  instruction: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const trimmed = instruction.trim();
  if (trimmed === '') {
    throw new Error('Üres utasítást nem lehet futtatni.');
  }

  const config = loadConfig();
  const systemPrompt = buildIngestSystemPrompt();
  const anthropic = getProvider(config.apiKey);
  const trace = new Trace({
    question: trimmed,
    model: config.model,
    systemPrompt,
    print: options.print,
  });

  const outcomes = new Map<
    string,
    { name: string; input: unknown; outcome: RunSqlOutcome }
  >();
  const tools = buildIngestTools((toolCallId, name, input, outcome) => {
    outcomes.set(toolCallId, { name, input, outcome });
  });
  const toolNames = Object.keys(tools);

  const result = await generateText({
    model: anthropic(config.model),
    maxOutputTokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: trimmed }],
    tools,
    stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
    prepareStep: ({ stepNumber, messages: outgoing }) => {
      trace.request(stepNumber + 1, {
        model: config.model,
        maxOutputTokens: MAX_TOKENS,
        system: systemPrompt,
        toolNames,
        messages: outgoing,
      });
      return {};
    },
    onStepFinish: (step: StepResult<ToolSet>) => {
      const turn = trace.modelTurn(trace.turnCount + 1, {
        finishReason: step.finishReason,
        text: step.text,
        toolCalls: step.toolCalls.map((call) => ({
          toolName: call.toolName,
          input: call.input,
        })),
        usage: {
          inputTokens: step.usage.inputTokens,
          outputTokens: step.usage.outputTokens,
        },
      });
      for (const toolResult of step.toolResults) {
        const record = outcomes.get(toolResult.toolCallId);
        if (record) {
          trace.toolStep(
            turn,
            { toolName: record.name, input: record.input },
            record.outcome,
          );
        }
      }
    },
  });

  const summary =
    result.text.trim() !== ''
      ? result.text
      : 'Nem sikerült lezárni a betöltést a megengedett lépésszámon belül.';

  const usage = {
    inputTokens: result.totalUsage.inputTokens ?? 0,
    outputTokens: result.totalUsage.outputTokens ?? 0,
  };
  const tracePath = trace.finish(summary, usage);
  return { summary, usage, stopReason: result.finishReason, tracePath };
}
