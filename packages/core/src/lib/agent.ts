import {
  generateText,
  stepCountIs,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from 'ai';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { loadConfig } from './config.js';
import { buildSystemPrompt } from './prompts.js';
import { buildAiTools, type RunSqlOutcome } from './tools/index.js';
import { Trace } from './trace.js';

// agent.ts — az agent-loop a Vercel AI SDK-n. A 2–3. órán KÉZZEL írtuk meg ugyanezt
// (prompt → hívás → stop_reason → tool → tool_result → vissza) a nyers Anthropic SDK fölött —
// ezért pontosan tudjuk, mit csinál helyettünk a framework:
//   - a loopot a `generateText` pörgeti, amíg a modell toolt kér (finishReason: 'tool-calls'),
//   - a kör-limitünk a `stopWhen: stepCountIs(n)` (régen: MAX_TOOL_ITERATIONS for-ciklus),
//   - a tool-dispatch a tool-definíciók `execute`-ja (régen: executeTool switch),
//   - a kontextus-görgetést (üzenetek hozzáfűzése körről körre) az SDK végzi.
// A TRANSZPARENCIA marad: a `prepareStep` hookban látjuk, MIT küldünk ki minden körben,
// az `onStepFinish`-ben pedig, MI történt — a Trace ugyanazt a színes nyomot írja, mint eddig.

const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 6;

export type Message = ModelMessage;

export interface AskOptions {
  /** Korábbi beszélgetés (interaktív mód) — ezt folytatjuk. */
  history?: Message[];
  /** Élő, színes konzol-nyom. Alapból true; a CLI --quiet kapcsolóra false. */
  print?: boolean;
}

export interface AskResult {
  answer: string;
  /** A TELJES, frissített beszélgetés — az interaktív mód ezt viszi tovább. */
  messages: Message[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
  /** A kiírt pretty JSON nyom elérési útja. */
  tracePath: string;
}

let provider: AnthropicProvider | null = null;
function getProvider(apiKey: string): AnthropicProvider {
  if (!provider) {
    provider = createAnthropic({ apiKey });
  }
  return provider;
}

export async function askAgent(
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres kérdést nem lehet feltenni.');
  }

  const config = loadConfig();
  const systemPrompt = buildSystemPrompt();
  const anthropic = getProvider(config.apiKey);
  const trace = new Trace({
    question: trimmed,
    model: config.model,
    systemPrompt,
    print: options.print,
  });

  // A beszélgetés = egy üzenet-tömb (history + az új kérdés). Ezt adjuk át az SDK-nak,
  // a körönkénti bővítést (assistant + tool üzenetek) már ő végzi.
  const messages: Message[] = [
    ...(options.history ?? []),
    { role: 'user', content: trimmed },
  ];

  // A tool-futások MELLÉK-csatornája a Trace-nek: az execute a modellnek csak a contentet
  // adja vissza, a teljes outcome-ot (guardolt SQL, sorszám, hiba) itt gyűjtjük toolCallId
  // szerint, és az onStepFinish-ben párosítjuk a kör tool-hívásaihoz.
  const outcomes = new Map<
    string,
    { name: string; input: unknown; outcome: RunSqlOutcome }
  >();
  const tools = buildAiTools((toolCallId, name, input, outcome) => {
    outcomes.set(toolCallId, { name, input, outcome });
  });
  const toolNames = Object.keys(tools);

  const result = await generateText({
    model: anthropic(config.model),
    maxOutputTokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools,
    // Régen: for (let i = 1; i <= MAX_TOOL_ITERATIONS; i++) — most deklaratívan mondjuk meg,
    // meddig mehet a loop.
    stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
    // HÍVÁS ELŐTT: ezt küldjük ki — a teljes, körről körre növekvő kontextus.
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
    // HÍVÁS UTÁN: mi történt a körben — a modell szövege, tool-kérései és a tool-eredmények.
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
      : 'Nem sikerült végső választ adni a megengedett lépésszámon belül. Pontosítsd a kérdést.';

  // A frissített beszélgetés: a kiinduló üzenetek + amit a futás generált (assistant + tool
  // üzenetek) — az interaktív mód ezt viszi tovább.
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
