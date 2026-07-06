import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ModelMessage } from 'ai';
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
  magenta: wrap(35),
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

// ── Watch-log ("control room"): folyamatos, `tail -f`-elhető log az EGÉSZ folyamatról. ──
// Modul-szintű cél, hogy a Trace ÉS a saját `traceLog` is ugyanabba a fájlba írjon. A CLI
// egyszer beállítja; tesztben/máshol kikapcsolva (null) marad.
let watchLogPath: string | null = null;

/** A watch-log célfájljának beállítása (a CLI egyszer hívja). null = kikapcsolva. */
export function setWatchLog(path: string | null): void {
  watchLogPath = path;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
  }
}

function appendWatch(s: string): void {
  if (watchLogPath) {
    appendFileSync(watchLogPath, s + '\n', 'utf8');
  }
}

/** Saját log-sor a konzolba ÉS a watch-logba — bárhonnan hívható a kódból. A nyers
 *  console.log-gal szemben ez a `tail -f` control roomban is megjelenik. */
export function traceLog(text: string): void {
  const line = c.magenta('● ') + c.white(text);
  process.stdout.write(line + '\n');
  appendWatch(line);
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
    // A kérdés erős, színes fejléce — szimmetrikusan a végső ✓ VÁLASZ blokkal. A vezető üres
    // sor a folyamatos watch-logban elválasztja az egymást követő futásokat.
    this.line('');
    this.line(c.bold(c.cyan(heavyBar())));
    this.line(c.bold(c.cyan('  KÉRDÉS:  ' + meta.question)));
    this.line(c.bold(c.cyan(heavyBar())));
    this.line(c.dim(`  model: ${meta.model}`));
  }

  private line(s: string): void {
    if (this.print) {
      process.stdout.write(s + '\n');
    }
    appendWatch(s);
  }

  /** Eddig rögzített körök száma — a hívó ebből számozza a következőt. */
  get turnCount(): number {
    return this.turns.length;
  }

  /** HÍVÁS ELŐTT: kiírja a TELJES, lapított kontextust, amit elküldünk (system + a beszélgetés).
   *  Minden körben újra — így szemmel látszik, ahogy ugyanaz a szöveg nő. Az AI SDK-nál ezt a
   *  `prepareStep` hook hívja: ott látjuk, MIT küld ki a framework az adott körben. */
  request(
    n: number,
    req: {
      model: string;
      maxOutputTokens: number;
      system: string;
      toolNames: string[];
      messages: ModelMessage[];
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
        c.dim(` · maxOutputTokens: ${req.maxOutputTokens}`),
    );
    this.line(c.dim('  tools: ') + c.white(`[${req.toolNames.join(', ')}]`));
    this.line(c.dim('  system: ') + clip(req.system, 70));
    this.line(c.dim('  messages:'));
    for (const m of req.messages) {
      for (const ln of renderMessage(m)) {
        this.line('    ' + paint(ln));
      }
    }
  }

  /** HÍVÁS UTÁN: a modell fordulója — finishReason, a VALÓS elküldött tokenszám, a szöveg.
   *  Az AI SDK-nál az `onStepFinish` hook hívja, a lezárt kör (step) adataival. */
  modelTurn(
    n: number,
    step: {
      finishReason: string | null;
      text: string;
      toolCalls: Array<{ toolName: string; input: unknown }>;
      usage: { inputTokens?: number; outputTokens?: number };
    },
  ): Turn {
    const modelText = step.text.trim();
    const inputTokens = step.usage.inputTokens ?? 0;
    const turn: Turn = {
      n,
      stopReason: step.finishReason,
      modelText,
      toolCalls: [],
      context: {
        messages: this.lastCount ?? 0,
        inputTokens,
      },
      usage: {
        in: inputTokens,
        out: step.usage.outputTokens ?? 0,
      },
    };
    this.turns.push(turn);
    this.line(
      c.dim(
        `↳ a modell válasza · finishReason: ${step.finishReason} · ${inputTokens} token`,
      ),
    );
    // Köztes szöveg (a modell "gondolkodik" egy tool-hívás ELŐTT) — kiírjuk. A VÉGSŐ választ
    // viszont nem itt, hanem a finish() írja ki (✓ VÁLASZ), hogy ne duplikálódjon.
    if (modelText && step.finishReason === 'tool-calls') {
      this.line(c.white('  szöveg: ' + clip(modelText, 120)));
    }
    // A modell által generált tool-kérés(ek) — a paraméterekkel, amiket MAGA A MODELL írt.
    for (const call of step.toolCalls) {
      const q =
        (call.input as { query?: string } | null)?.query ??
        JSON.stringify(call.input);
      this.line(
        c.yellow(`  tool-kérés: ${call.toolName}( `) +
          c.cyan(clip(q, 90)) +
          c.yellow(' )'),
      );
    }
    return turn;
  }

  /** Egy lefuttatott function call: a kért SQL, a guardolt SQL, a sorszám / hiba. */
  toolStep(
    turn: Turn,
    call: { toolName: string; input: unknown },
    outcome: RunSqlOutcome,
  ): void {
    let result: unknown = outcome.content;
    try {
      result = JSON.parse(outcome.content);
    } catch {
      // marad nyers szöveg (pl. hibaüzenet)
    }
    turn.toolCalls.push({
      name: call.toolName,
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
    this.line(c.yellow(bar(`TOOL · ${call.toolName} (lefuttatjuk a DB-n)`)));
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

/** Egy üzenet egy vagy több lapított sorrá: [user]/[assistant]/[tool] + rövid tartalom.
 *  Az AI SDK ModelMessage alakját lapítjuk: text / tool-call / tool-result részek. */
function renderMessage(m: ModelMessage): string[] {
  if (typeof m.content === 'string') {
    return [`[${m.role}]   ${clip(m.content, 90)}`];
  }
  const lines: string[] = [];
  for (const block of m.content as Array<Record<string, unknown>>) {
    if (block['type'] === 'text') {
      lines.push(`[${m.role}] ${clip(String(block['text'] ?? ''), 90)}`);
    } else if (block['type'] === 'tool-call') {
      const input = block['input'] as { query?: string } | null | undefined;
      const q = input?.query ?? JSON.stringify(block['input']);
      lines.push(`[${m.role}] (⚙ ${String(block['toolName'])}: ${clip(q, 80)})`);
    } else if (block['type'] === 'tool-result') {
      const output = block['output'] as
        | { type?: string; value?: unknown }
        | string
        | undefined;
      const raw =
        typeof output === 'string'
          ? output
          : typeof output?.value === 'string'
            ? output.value
            : JSON.stringify(output?.value ?? output);
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
