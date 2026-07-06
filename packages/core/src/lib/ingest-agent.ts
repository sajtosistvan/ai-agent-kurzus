import {
  generateText,
  stepCountIs,
  type StepResult,
  type ToolSet,
} from 'ai';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { loadConfig } from './config.js';
import { buildIngestSystemPrompt } from './ingest-prompts.js';
import { buildIngestAiTools, type RunSqlOutcome } from './tools/index.js';
import { Trace } from './trace.js';
import type { AskOptions, AskResult, Message } from './agent.js';

// ingest-agent.ts — a KATALÓGUS-KEZELŐ agent loopja. Ugyanaz a Vercel AI SDK-s minta, mint az
// askAgent (agent.ts), de MÁS a szerep és a toolkészlet: itt a modell OLVAS (runSql) ÉS ÍR
// (upsertProduct). A read/write szétválasztás a tool-rétegben van: az írás egyetlen, szigorúan
// validált, latin-név-kulcsú upsert; nyers write-SQL nincs. A Trace ugyanazt a színes nyomot adja.

const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 8; // az ingest több lépés lehet: olvasás → (visszakérdezés) → írás

let provider: AnthropicProvider | null = null;
function getProvider(apiKey: string): AnthropicProvider {
  if (!provider) {
    provider = createAnthropic({ apiKey });
  }
  return provider;
}

/** Egy ingest-fordulat: az utasításból (olvasás után) katalógus-módosítás az upsertProduct-tal.
 *  A visszatérési alak azonos az askAgent-ével, így az interaktív CLI ugyanúgy viszi az előzményt. */
export async function askIngestAgent(
  instruction: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const trimmed = instruction.trim();
  if (trimmed === '') {
    throw new Error('Üres utasítást nem lehet végrehajtani.');
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

  const messages: Message[] = [
    ...(options.history ?? []),
    { role: 'user', content: trimmed },
  ];

  const outcomes = new Map<
    string,
    { name: string; input: unknown; outcome: RunSqlOutcome }
  >();
  const tools = buildIngestAiTools((toolCallId, name, input, outcome) => {
    outcomes.set(toolCallId, { name, input, outcome });
  });
  const toolNames = Object.keys(tools);

  const result = await generateText({
    model: anthropic(config.model),
    maxOutputTokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
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

  const answer =
    result.text.trim() !== ''
      ? result.text
      : 'Nem sikerült befejezni a katalógus-módosítást a megengedett lépésszámon belül. Pontosítsd az utasítást.';

  const updatedMessages: Message[] = [...messages, ...result.response.messages];

  const usage = {
    inputTokens: result.totalUsage.inputTokens ?? 0,
    outputTokens: result.totalUsage.outputTokens ?? 0,
  };
  const tracePath = trace.finish(answer, usage);
  return {
    answer,
    messages: updatedMessages,
    usage,
    stopReason: result.finishReason,
    tracePath,
  };
}
