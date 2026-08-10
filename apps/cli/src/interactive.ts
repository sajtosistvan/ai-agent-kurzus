import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import type { Agent } from '@mastra/core/agent';
import { streamAgentAnswer } from './stream-answer.js';

// interactive.ts — readline-hurok EGY Mastra thread fölött. A sorokat sorosan dolgozzuk fel
// (egyszerre egy agent-futás), így csővezetett bemenetnél sem fut össze két hívás.
//
// AMI ELTŰNT: a kézzel továbbvitt `history: Message[]`. A beszélgetés-memória a Mastra
// Memoryé — minden kör UGYANAZT a `thread`-et kapja, és az előzményt a keretrendszer tölti
// be a modellnek. Ugyanez a hurok szolgálja ki a query- és a katalógus-agentet is: csak
// az `agent` paraméter más.

const EXIT_WORDS = new Set(['exit', 'quit', 'kilép']);

export interface InteractiveOptions {
  agent: Agent;
  /** A beszélgetés azonosítója — végig ugyanaz, ez adja a memóriát. */
  threadId: string;
  /** Ki beszél (Mastra Memory resource). */
  resourceId: string;
  banner: string;
}

export function runInteractive(options: InteractiveOptions): Promise<void> {
  const { agent, threadId, resourceId, banner } = options;
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
      if (EXIT_WORDS.has(input.toLowerCase())) {
        rl.close();
        break;
      }
      try {
        await streamAgentAnswer(agent, input, {
          thread: threadId,
          resource: resourceId,
        });
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
