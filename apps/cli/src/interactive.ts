import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { askAgent, type Message } from '@plantbase/core';

// Interaktív readline-hurok BESZÉLGETÉS-MEMÓRIÁVAL: a teljes üzenet-tömböt körről körre
// továbbvisszük, így a követő kérdés ismeri az előzményt. A sorokat sorosan dolgozzuk fel
// (egyszerre egy askAgent fut), így csővezetett bemenetnél sem fut össze két hívás.

const EXIT_WORDS = new Set(['exit', 'quit', 'kilép']);

export function runInteractive(quiet: boolean): Promise<void> {
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
        const result = await askAgent(input, { history, print: !quiet });
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

  stdout.write('Plantbase interaktív mód — kilépés: "exit" vagy Ctrl-D.\n');
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
