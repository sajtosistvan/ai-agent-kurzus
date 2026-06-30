import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

const BAR_WIDTH = 58;
/** Címkézett vékony elválasztó egy lineáris lépéshez: ── CÍMKE ───────── */
function bar(label: string): string {
  const head = `── ${label} `;
  return head + '─'.repeat(Math.max(0, BAR_WIDTH - head.length));
}
/** Vastag elválasztó a végső válasz kiemeléséhez. */
function heavyBar(): string {
  return '═'.repeat(BAR_WIDTH);
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
  private readonly watchLog: string | null; // folyamatos "control room" log (tail -f)
  private lastCount: number | null = null; // az előző hívás üzenetszáma (a "NŐTT" jelzéshez)
  readonly question: string;
  readonly model: string;
  readonly systemPrompt: string;

  constructor(meta: {
    question: string;
    model: string;
    systemPrompt: string;
    print?: boolean;
    watchLog?: string;
  }) {
    this.question = meta.question;
    this.model = meta.model;
    this.systemPrompt = meta.systemPrompt;
    this.print = meta.print ?? true;
    this.watchLog = meta.watchLog ?? null;
    if (this.watchLog) {
      // "control room": folyamatos log, külön terminálban `tail -f`-fel nézhető — a --quiet-től
      // FÜGGETLENÜL ide kerül a teljes nyom. Append-only; a futások közé elválasztót teszünk.
      mkdirSync(dirname(this.watchLog), { recursive: true });
      appendFileSync(this.watchLog, '\n' + '─'.repeat(64) + '\n', 'utf8');
    }
    this.line(c.bold('▶ kérdés: ') + meta.question);
    this.line(c.dim(`  model: ${meta.model}`));
  }

  private line(s: string): void {
    if (this.print) {
      process.stdout.write(s + '\n');
    }
    if (this.watchLog) {
      appendFileSync(this.watchLog, s + '\n', 'utf8');
    }
  }

  /** HÍVÁS ELŐTT: kiírja a TELJES, lapított kontextust, amit elküldünk (system + a beszélgetés).
   *  Minden körben újra — így szemmel látszik, ahogy ugyanaz a szöveg nő. */
  request(
    n: number,
    req: {
      model: string;
      max_tokens: number;
      system: string;
      tools: Anthropic.Tool[];
      messages: Anthropic.MessageParam[];
    },
  ): void {
    const grew =
      this.lastCount !== null && req.messages.length > this.lastCount;
    this.lastCount = req.messages.length;
    const label = `HÍVÁS #${n} · ${req.messages.length} üzenet${grew ? ' ← NŐTT' : ''}`;
    this.line('');
    this.line(grew ? c.bold(c.green(bar(label))) : c.bold(bar(label)));
    this.line(c.dim('amit átadunk a modellnek (a hívás paraméterei):'));
    this.line(
      c.dim('  model: ') +
        c.white(req.model) +
        c.dim(` · max_tokens: ${req.max_tokens}`),
    );
    this.line(
      c.dim('  tools: ') +
        c.white(`[${req.tools.map((t) => t.name).join(', ')}]`),
    );
    this.line(c.dim('  system: ') + clip(req.system, 70));
    this.line(c.dim('  messages:'));
    for (const m of req.messages) {
      for (const ln of renderMessage(m)) {
        this.line('    ' + paint(ln));
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
        `↳ a modell válasza · stop_reason: ${response.stop_reason} · ${response.usage.input_tokens} token`,
      ),
    );
    // Köztes szöveg (a modell "gondolkodik" egy tool-hívás ELŐTT) — kiírjuk. A VÉGSŐ választ
    // viszont nem itt, hanem a finish() írja ki (✓ VÁLASZ), hogy ne duplikálódjon.
    if (modelText && response.stop_reason === 'tool_use') {
      this.line(c.white('  szöveg: ' + clip(modelText, 120)));
    }
    // A modell által generált tool-kérés(ek) — a paraméterekkel, amiket MAGA A MODELL írt.
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const q =
          (block.input as { query?: string } | null)?.query ??
          JSON.stringify(block.input);
        this.line(
          c.yellow(`  tool-kérés: ${block.name}( `) +
            c.cyan(clip(q, 90)) +
            c.yellow(' )'),
        );
      }
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

    // A modell SQL-je gyakran többsoros — a konzolon egy sorba lapítjuk (a teljes,
    // formázott SQL a JSON-nyomban marad).
    const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const sql = outcome.executedSql
      ? flat(outcome.executedSql)
      : flat((call.input as { query?: string } | null)?.query ?? '');
    this.line('');
    this.line(c.yellow(bar(`TOOL · ${call.name} (lefuttatjuk a DB-n)`)));
    if (sql) {
      this.line(c.dim('  SQL (guard után): ') + c.cyan(sql));
    }
    if (outcome.isError) {
      this.line(c.red('  → hiba: ') + outcome.content);
    } else {
      this.line(
        c.green(`  → ${outcome.rowCount ?? 0} sor`) +
          c.dim(' · hozzáfűzve a kontextushoz'),
      );
    }
  }

  /** Lezárás: végső válasz kiírása + a pretty JSON mentése. A fájl útját adja vissza. */
  finish(
    answer: string,
    usage: { inputTokens: number; outputTokens: number },
  ): string {
    this.line('');
    this.line(c.bold(c.green(heavyBar())));
    this.line(c.bold(c.green('  ✓ VÁLASZ')));
    this.line(c.bold(c.green(heavyBar())));
    this.line(c.white(answer));

    const data = this.toJSON(answer, usage);
    const dir = join(process.cwd(), 'logs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${timestampSlug()}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
    this.line('');
    this.line(c.dim(`nyom: ${path}`));
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
