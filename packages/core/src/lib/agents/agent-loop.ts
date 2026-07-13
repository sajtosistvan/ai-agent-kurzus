import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type StepResult,
  type StreamTextResult,
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
//   - a loopot a `streamText` pörgeti, amíg a modell toolt kér (finishReason: 'tool-calls'),
//   - a kör-limit a `stopWhen: stepCountIs(n)` (régen: MAX_TOOL_ITERATIONS for-ciklus),
//   - a tool-futtatás a tool-definíciók `execute`-ja (régen: executeTool switch),
//   - a kontextus-görgetést (üzenetek hozzáfűzése körről körre) az SDK végzi.
// A TRANSZPARENCIA marad: a `prepareStep` hookban látjuk, MIT küldünk ki minden körben,
// az `onStepFinish`-ben pedig, MI történt — a Trace ugyanazt a színes nyomot írja, mint eddig.
//
// STREAMING: a `generateText`-ről `streamText`-re váltottunk, hogy a végső válasz szövege
// TOKENENKÉNT is elérhető legyen az `onTextDelta` callback-en át (ezt a szerver írja tovább a
// böngészőnek). A hívó oldal (CLI) ezt nem adja meg — ott a viselkedés változatlan: a Trace a
// lépések VÉGÉN íródik ki, nem tokenenként.

export type Message = ModelMessage;

export interface AskOptions {
  /** Korábbi beszélgetés (interaktív mód) — ezt folytatjuk. */
  history?: Message[];
  /** Élő, színes konzol-nyom. Alapból true; a CLI --quiet kapcsolóra false. */
  print?: boolean;
  /** Ha meg van adva, a végső válasz szövegét TOKENENKÉNT is megkapja, ahogy generálódik. */
  onTextDelta?: (delta: string) => void;
  /**
   * KÉT CSATORNA — ez a különbség a "streamel" és a "látod, mit csinál" között:
   *
   *   onTextDelta  → SZÖVEG-csatorna: csak a végső válasz betűi. Ezt kapja a CLI (és eddig a web is).
   *                  Bármilyen gyorsan streamel, a tool-hívás nem fér bele: az nem szöveg.
   *   onStream     → ÜZENET-csatorna: a hívó megkapja a streamText EREDMÉNYÉT, és abból az AI SDK
   *                  üzenet-streamjét (text-delta ÉS tool-input ÉS tool-output részek) továbbíthatja
   *                  a böngészőnek. Ettől tud a kliens kártyát rajzolni a tool-eredményből.
   *
   * Ha onStream meg van adva, a stream fogyasztása (és így a loop hajtása) a HÍVÓ dolga —
   * ezért ilyenkor mi nem olvassuk a fullStream-et.
   */
  onStream?: (result: StreamTextResult<ToolSet, never>) => void;
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

  const result = streamText({
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

  // A fullStream fogyasztása HAJTJA a loopot (tool-hívásokkal együtt). Csak a text-delta
  // darabokat adjuk tovább — a tool-hívások argumentumai NEM a felhasználónak szóló szöveg.
  // Körönként (pl. "megnézem az adatbázist…" majd a végső válasz) ÚJ kör (start-step) nyílik;
  // az id minden körben nullázódik (0-tól), ezért a kör-határt a start-step eseménnyel
  // követjük: ha az ÉPP LEZÁRULT kör adott vissza szöveget, üres sort szúrunk be elé.
  // ÜZENET-csatorna: a hívó (a szerver) fogyasztja a stream-et, és továbbítja a böngészőnek
  // tool-részekkel együtt. A Trace ettől függetlenül fut: a prepareStep / onStepFinish hookok
  // akkor is meghívódnak, ha nem MI olvassuk a fullStream-et.
  if (options.onStream) {
    options.onStream(result);
    return finishRun(result, agent, trace, messages, options);
  }

  let firstStep = true;
  let currentStepHasText = false;
  for await (const part of result.fullStream) {
    if (part.type === 'start-step') {
      if (!firstStep && currentStepHasText) {
        options.onTextDelta?.('\n\n');
      }
      firstStep = false;
      currentStepHasText = false;
      continue;
    }
    if (part.type !== 'text-delta') {
      continue;
    }
    currentStepHasText = true;
    options.onTextDelta?.(part.text);
  }

  return finishRun(result, agent, trace, messages, options);
}

/**
 * A futás lezárása — MINDKÉT csatornánál ugyanaz: megvárjuk a stream végét, lezárjuk a nyomot,
 * és összeállítjuk a frissített beszélgetést. A `result` promise-ai (text, response, totalUsage)
 * akkor oldódnak fel, amikor a stream elfogyott — mindegy, hogy MI olvastuk el, vagy a hívó.
 */
async function finishRun(
  result: StreamTextResult<ToolSet, never>,
  agent: AgentDefinition,
  trace: Trace,
  messages: Message[],
  options: AskOptions,
): Promise<AskResult> {
  const finalText = await result.text;
  const answer = finalText.trim() !== '' ? finalText : agent.emptyAnswer;
  // Ha nem generálódott szöveg (limit miatt üresen állt meg), a fallback szöveget is
  // el kell juttatni a streamelt kliensnek — máskülönben egyetlen delta sem érkezett.
  if (finalText.trim() === '') {
    options.onTextDelta?.(answer);
  }

  // A frissített beszélgetés: a kiinduló üzenetek + amit a futás generált (assistant + tool
  // üzenetek) — az interaktív mód ezt viszi tovább.
  const response = await result.response;
  const updatedMessages: Message[] = [...messages, ...response.messages];

  const totalUsage = await result.totalUsage;
  const usage = {
    inputTokens: totalUsage.inputTokens ?? 0,
    outputTokens: totalUsage.outputTokens ?? 0,
  };
  const tracePath = trace.finish(answer, usage);
  return {
    answer,
    messages: updatedMessages,
    usage,
    stopReason: await result.finishReason,
    tracePath,
  };
}
