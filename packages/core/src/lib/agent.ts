import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { buildSystemPrompt } from './prompts.js';
import { tools, executeTool } from './tools/index.js';
import { Trace } from './trace.js';

// agent.ts — a KÉZZEL ÍRT tool-use loop az Anthropic SDK messages.create fölött (nem helper,
// nem framework). Itt látszik az egész mechanika: prompt → hívás → stop_reason → function call
// → tool_result → vissza, amíg végső szöveges válasz nem lesz. A nyomot a Trace írja (konzol + JSON).

const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 6;

export type Message = Anthropic.MessageParam;

export interface AskOptions {
  /** Korábbi beszélgetés (interaktív mód) — ezt folytatjuk. */
  history?: Message[];
  /** Élő, színes konzol-nyom. Alapból true; a CLI --quiet kapcsolóra false. */
  print?: boolean;
  /** Folyamatos "control room" log a logs/agent.log-ba (külön terminálban `tail -f`). */
  watchLog?: boolean;
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

let client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
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
  const anthropic = getClient(config.apiKey);
  const trace = new Trace({
    question: trimmed,
    model: config.model,
    systemPrompt,
    print: options.print,
    watchLog: options.watchLog
      ? join(process.cwd(), 'logs', 'agent.log')
      : undefined,
  });

  // A beszélgetés = egy üzenet-tömb, amit körről körre bővítünk (history + az új kérdés).
  const messages: Message[] = [
    ...(options.history ?? []),
    { role: 'user', content: trimmed },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let answer = '';

  // A LOOP három üteme körönként:  KÜLD (a teljes kontextust, újra) → HOZZÁFŰZ (a modell válasza)
  // → HOZZÁFŰZ (a tool-eredmény) → vissza a tetejére a MÁR NAGYOBB kontextussal.
  for (let i = 1; i <= MAX_TOOL_ITERATIONS; i++) {
    // 1) KÜLD: ez az EGY dolog, amit elküldünk — system + tools + a TELJES beszélgetés. Minden
    //    körben újra, egyre nagyobb `messages`-szel. (A trace kiírja, mit küldünk.)
    const request = {
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools, // tools/index.ts → [runSqlTool]
      messages,
    };
    trace.request(i, request); // kiírja a hívás MINDEN paraméterét
    const response = await anthropic.messages.create(request);

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    stopReason = response.stop_reason;
    const turn = trace.modelTurn(i, response);

    // 2) HOZZÁFŰZ: a modell fordulóját (szöveg + esetleges tool_use blokkok) a kontextushoz.
    messages.push({ role: 'assistant', content: response.content });

    // Nincs több tool-kérés → ez a végső válasz, kilépünk a loopból.
    if (response.stop_reason !== 'tool_use') {
      answer = turn.modelText;
      break;
    }

    // 3) HOZZÁFŰZ: a modell function(öke)t kért → lefuttatjuk, és tool_result-ként visszaadjuk.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const outcome = await executeTool(use.name, use.input);
      trace.toolStep(turn, use, outcome);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
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
  const tracePath = trace.finish(answer, usage);
  return { answer, messages, usage, stopReason, tracePath };
}
