import {
  generateText,
  stepCountIs,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from 'ai';
import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';
import { loadConfig } from '../config.js';
import { Trace } from '../trace.js';
import type { ToolOutcome, ToolReporter } from '../tools/tool-outcome.js';

// agent-loop.ts — AZ agent-loop, egy helyen. Mindkét agent (query, ingest) EZT futtatja,
// csak mást ad be: saját system promptot + saját toolkészletet. Egy agent = prompt + toolok + loop.
//
// A 2–3. órán KÉZZEL írtuk meg ugyanezt (prompt → hívás → stop_reason → tool → tool_result →
// vissza) a nyers Anthropic SDK fölött — ezért pontosan tudjuk, mit csinál helyettünk az AI SDK:
//   - a loopot a `generateText` pörgeti, amíg a modell toolt kér (finishReason: 'tool-calls'),
//   - a kör-limit a `stopWhen: stepCountIs(n)` (régen: MAX_TOOL_ITERATIONS for-ciklus),
//   - a tool-futtatás a tool-definíciók `execute`-ja (régen: executeTool switch),
//   - a kontextus-görgetést (üzenetek hozzáfűzése körről körre) az SDK végzi.
// A TRANSZPARENCIA marad: a `prepareStep` hookban látjuk, MIT küldünk ki minden körben,
// az `onStepFinish`-ben pedig, MI történt — a Trace ugyanazt a színes nyomot írja, mint eddig.

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

/** Amivel egy AGENT paraméterezi a közös loopot: a személyisége és a képességei. */
export interface AgentDefinition {
  /** Az agent szerepe és szabályai (a system prompt). */
  systemPrompt: string;
  /** Az agent toolkészlete. A report-ot minden tool megkapja, ezen jelent a Trace-nek. */
  buildTools: (report: ToolReporter) => ToolSet;
  /** Max hány kört mehet a loop (tool-hívásokkal együtt). */
  maxSteps: number;
  /** A modell válaszának token-kerete. Nagy tool-argumentumokhoz (pl. upsert) nagyobb kell. */
  maxOutputTokens: number;
  /** Ha a loop a limit miatt válasz nélkül áll meg, ezt mondjuk a felhasználónak. */
  emptyAnswer: string;
}

let provider: AnthropicProvider | null = null;
function getProvider(apiKey: string): AnthropicProvider {
  if (!provider) {
    provider = createAnthropic({ apiKey });
  }
  return provider;
}

/** A közös loop-futtatás: kérdés + agent-definíció → válasz (+ trace, + frissített előzmény). */
export async function runAgentLoop(
  question: string,
  agent: AgentDefinition,
  options: AskOptions = {},
): Promise<AskResult> {
  const config = loadConfig();
  const anthropic = getProvider(config.apiKey);
  const trace = new Trace({
    question,
    model: config.model,
    systemPrompt: agent.systemPrompt,
    print: options.print,
  });

  // A beszélgetés = egy üzenet-tömb (history + az új kérdés). Ezt adjuk át az SDK-nak,
  // a körönkénti bővítést (assistant + tool üzenetek) már ő végzi.
  const messages: Message[] = [
    ...(options.history ?? []),
    { role: 'user', content: question },
  ];

  // A tool-futások MELLÉK-csatornája a Trace-nek: a modell csak a tool contentjét kapja
  // vissza, a teljes outcome-ot (összegzés, sorszám, hiba) itt gyűjtjük toolCallId szerint,
  // és az onStepFinish-ben párosítjuk a kör tool-hívásaihoz.
  const outcomes = new Map<
    string,
    { name: string; input: unknown; outcome: ToolOutcome }
  >();
  const tools = agent.buildTools((toolCallId, name, input, outcome) => {
    outcomes.set(toolCallId, { name, input, outcome });
  });
  const toolNames = Object.keys(tools);

  const result = await generateText({
    model: anthropic(config.model),
    maxOutputTokens: agent.maxOutputTokens,
    system: agent.systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(agent.maxSteps),
    // HÍVÁS ELŐTT: ezt küldjük ki — a teljes, körről körre növekvő kontextus.
    prepareStep: ({ stepNumber, messages: outgoing }) => {
      trace.request(stepNumber + 1, {
        model: config.model,
        maxOutputTokens: agent.maxOutputTokens,
        system: agent.systemPrompt,
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

  const answer = result.text.trim() !== '' ? result.text : agent.emptyAnswer;

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
