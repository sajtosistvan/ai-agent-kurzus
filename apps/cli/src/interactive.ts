import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { askAgent, type AskResult, type Message } from '@plantbase/core';

// Interaktív readline-hurok BESZÉLGETÉS-MEMÓRIÁVAL: a teljes üzenet-tömböt körről körre
// továbbvisszük, így a követő kérdés ismeri az előzményt. A sorokat sorosan dolgozzuk fel
// (egyszerre egy hívás fut), így csővezetett bemenetnél sem fut össze két hívás.
// Az `ask` paraméterrel ugyanez a hurok szolgálja ki a query- és az ingest-agentet is.

const EXIT_WORDS = new Set(['exit', 'quit', 'kilép']);

type AskFn = (
  input: string,
  options: { history?: Message[]; print?: boolean },
) => Promise<AskResult>;

export interface InteractiveOptions {
  quiet: boolean;
  ask?: AskFn;
  banner?: string;
}

export function runInteractive(
  quietOrOptions: boolean | InteractiveOptions,
): Promise<void> {
  const opts: InteractiveOptions =
    typeof quietOrOptions === 'boolean'
      ? { quiet: quietOrOptions }
      : quietOrOptions;
  const quiet = opts.quiet;
  const ask: AskFn = opts.ask ?? askAgent;
  const banner =
    opts.banner ?? 'Plantbase interaktív mód — kilépés: "exit" vagy Ctrl-D.';
  const rl = createInterface({ input: stdin, output: stdout, prompt: '> ' });
  const queue: string[] = [];
  let processing = false;
  let closed = false;
  let history: Message[] = []; // ← a beszélgetés memóriája

  async function drain(): Promise<void> {
    if (processing) {
      return;
    }
    processing = true;
    while (queue.length > 0 && !closed) {
      const input = queue.shift() as string;
      if (EXIT_WORDS.has(input.toLowerCase())) {
        rl.close();
        break;
      }
      try {
        const result = await ask(input, { history, print: !quiet });
        history = result.messages; // ← továbbvisszük az előzményt a következő körre
        if (quiet) {
          stdout.write(`${result.answer}\n`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        stdout.write(`hiba: ${message}\n`);
      }
      if (!closed) {
        rl.prompt();
      }
    }
    processing = false;
  }

  stdout.write(`${banner}\n`);
  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (!processing) {
          rl.prompt();
        }
        return;
      }
      queue.push(trimmed);
      void drain();
    });

    rl.on('close', () => {
      closed = true;
      stdout.write('Viszlát!\n');
      resolve();
    });
  });
}
