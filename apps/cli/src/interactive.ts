import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

// Interaktív readline-hurok: minden beírt sorra meghívja a `respond` handlert,
// kiírja a választ, és az `exit`/`quit` szóra (vagy Ctrl-D / Ctrl-C) kilép.
//
// A sorokat egy egyszerű sorba (queue) gyűjtjük, és SOROSAN dolgozzuk fel
// (egyszerre egy respond fut). Így csővezetett (nem TTY) bemenetnél sem veszik el
// sor, és a B2/B3 async LLM-hívásai sem futnak egymásra. A handler ezért async lehet.

const EXIT_WORDS = new Set(['exit', 'quit', 'kilép']);

export function runInteractive(
  respond: (input: string) => string | Promise<string>,
): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout, prompt: '> ' });
  const queue: string[] = [];
  let processing = false;
  let closed = false;

  async function drain(): Promise<void> {
    if (processing) {
      return;
    }
    processing = true;
    while (queue.length > 0 && !closed) {
      const input = queue.shift() as string;
      // Az exit a sorban, sorrendhelyesen érvényesül (a korábbi sorok még lefutnak).
      if (EXIT_WORDS.has(input.toLowerCase())) {
        rl.close();
        break;
      }
      try {
        const answer = await respond(input);
        stdout.write(`${answer}\n`);
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
