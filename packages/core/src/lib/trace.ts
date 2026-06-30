import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { RunSqlOutcome } from './tools/index.js';

// Megfigyelhetőség: a futás közben épülő, kör-strukturált nyom. UGYANARRA az adatra két nézet:
//  (1) élő, színes konzol — minden hívás ELŐTT kiírja a TELJES kontextust ("EZT küldjük"), hogy
//      lásd, ahogy ugyanaz a szöveg körről körre nő;  (2) szép, behúzott JSON a logs/<ts>.json-ba.
// Ez váltja a JSONL-t. A színezés minimális ANSI, függőség nélkül (NO_COLOR / nem-TTY → sima szöveg).

const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const wrap =
  (code: number) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const c = {
  dim: wrap(2),
  bold: wrap(1),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
  white: wrap(37),
};

/** Egy sorba tördelt, levágott szöveg (a lapított átirathoz). */
function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export interface ToolCall {
  name: string;
  input: unknown;
  guardedSql: string | null;
  rowCount: number | null;
  isError: boolean;
  result: unknown; // a tool kimenete (sorok payloadja parse-olva, vagy a hibaszöveg)
}

export interface Turn {
  n: number;
  stopReason: string | null;
  modelText: string;
  toolCalls: ToolCall[];
  /** Növekedés-mutató: hány üzenetet és (valós) hány tokent küldtünk el ebben a hívásban. */
  context: { messages: number; inputTokens: number };
  usage: { in: number; out: number };
}

export interface TraceData {
  question: string;
  model: string;
  durationMs: number;
  systemPrompt: string;
  turns: Turn[];
  answer: string;
  usage: { inputTokens: number; outputTokens: number };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class Trace {
  private readonly startedAt = Date.now();
  private readonly turns: Turn[] = [];
  private readonly print: boolean;
  private lastCount: number | null = null; // az előző hívás üzenetszáma (a "NŐTT" jelzéshez)
  readonly question: string;
  readonly model: string;
  readonly systemPrompt: string;

  constructor(meta: {
    question: string;
    model: string;
    systemPrompt: string;
    print?: boolean;
  }) {
    this.question = meta.question;
    this.model = meta.model;
    this.systemPrompt = meta.systemPrompt;
    this.print = meta.print ?? true;
    this.line(c.bold('▶ kérdés: ') + meta.question);
    this.line(c.dim(`  model: ${meta.model}`));
  }

  private line(s: string): void {
    if (this.print) {
      process.stdout.write(s + '\n');
    }
  }

  /** HÍVÁS ELŐTT: kiírja a TELJES, lapított kontextust, amit elküldünk (system + a beszélgetés).
   *  Minden körben újra — így szemmel látszik, ahogy ugyanaz a szöveg nő. */
  request(n: number, messages: Anthropic.MessageParam[]): void {
    const grew = this.lastCount !== null && messages.length > this.lastCount;
    this.lastCount = messages.length;
    this.line(
      c.bold(`\n🔁 ${n}. hívás — EZT küldjük (${messages.length} üzenet)`) +
        (grew ? c.green(' ← NŐTT') : '') +
        c.dim(':'),
    );
    this.line(c.dim(`  [system] ${clip(this.systemPrompt, 70)}`));
    for (const m of messages) {
      for (const ln of renderMessage(m)) {
        this.line('  ' + paint(ln));
      }
    }
  }

  /** HÍVÁS UTÁN: a modell fordulója — stop_reason, a VALÓS elküldött tokenszám, a szöveg. */
  modelTurn(n: number, response: Anthropic.Message): Turn {
    const modelText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const turn: Turn = {
      n,
      stopReason: response.stop_reason,
      modelText,
      toolCalls: [],
      context: {
        messages: this.lastCount ?? 0,
        inputTokens: response.usage.input_tokens,
      },
      usage: {
        in: response.usage.input_tokens,
        out: response.usage.output_tokens,
      },
    };
    this.turns.push(turn);
    this.line(
      c.dim(
        `  ↳ stop_reason: ${response.stop_reason} · elküldött kontextus: ${response.usage.input_tokens} token`,
      ),
    );
    if (modelText) {
      this.line(c.white('  ' + modelText));
    }
    if (response.stop_reason === 'tool_use') {
      this.line(
        c.dim(
          '  ↳ a tool-eredményt hozzáfűzzük, és a loop tetején újra elküldjük az EGÉSZET',
        ),
      );
    }
    return turn;
  }

  /** Egy lefuttatott function call: a kért SQL, a guardolt SQL, a sorszám / hiba. */
  toolStep(
    turn: Turn,
    call: Anthropic.ToolUseBlock,
    outcome: RunSqlOutcome,
  ): void {
    let result: unknown = outcome.content;
    try {
      result = JSON.parse(outcome.content);
    } catch {
      // marad nyers szöveg (pl. hibaüzenet)
    }
    turn.toolCalls.push({
      name: call.name,
      input: call.input,
      guardedSql: outcome.executedSql,
      rowCount: outcome.rowCount,
      isError: outcome.isError,
      result,
    });

    const asked = (call.input as { query?: string } | null)?.query;
    this.line(c.yellow(`  ⚙ function call: ${call.name}`));
    if (asked) {
      this.line(c.dim('    kért SQL:  ') + c.cyan(asked));
    }
    if (outcome.executedSql && outcome.executedSql !== asked) {
      this.line(c.dim('    guardolt:  ') + c.cyan(outcome.executedSql));
    }
    if (outcome.isError) {
      this.line(c.red('    ✗ hiba: ') + outcome.content);
    } else {
      this.line(c.green(`    ✓ ${outcome.rowCount ?? 0} sor`));
    }
  }

  /** Lezárás: végső válasz kiírása + a pretty JSON mentése. A fájl útját adja vissza. */
  finish(
    answer: string,
    usage: { inputTokens: number; outputTokens: number },
  ): string {
    this.line(c.bold('\n✓ válasz:'));
    this.line(c.white(answer));

    const data = this.toJSON(answer, usage);
    const dir = join(process.cwd(), 'logs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${timestampSlug()}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
    this.line(c.dim(`  nyom: ${path}`));
    return path;
  }

  /** A nyers, kör-strukturált adat fájlírás nélkül (tesztekhez / programozott használatra). */
  toJSON(
    answer: string,
    usage: { inputTokens: number; outputTokens: number },
  ): TraceData {
    return {
      question: this.question,
      model: this.model,
      durationMs: Date.now() - this.startedAt,
      systemPrompt: this.systemPrompt,
      turns: this.turns,
      answer,
      usage,
    };
  }
}

/** Egy üzenet egy vagy több lapított sorrá: [user]/[assistant]/[tool] + rövid tartalom. */
function renderMessage(m: Anthropic.MessageParam): string[] {
  if (typeof m.content === 'string') {
    return [`[${m.role}]   ${clip(m.content, 90)}`];
  }
  const lines: string[] = [];
  for (const block of m.content) {
    if (block.type === 'text') {
      lines.push(`[${m.role}] ${clip(block.text, 90)}`);
    } else if (block.type === 'tool_use') {
      const q =
        (block.input as { query?: string } | null)?.query ??
        JSON.stringify(block.input);
      lines.push(`[${m.role}] (⚙ ${block.name}: ${clip(q, 80)})`);
    } else if (block.type === 'tool_result') {
      const raw =
        typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);
      lines.push(`[tool]   ${clip(raw, 90)}`);
    }
  }
  return lines;
}

/** Szerepkör szerinti színezés a lapított átirathoz. */
function paint(ln: string): string {
  if (ln.startsWith('[tool]')) {
    return c.dim(ln);
  }
  if (ln.startsWith('[assistant]')) {
    return c.cyan(ln);
  }
  return c.white(ln);
}
