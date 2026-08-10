import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import {
  mastra,
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
} from '@plantbase/core';
import { runInteractive } from './interactive.js';
import { streamAgentAnswer } from './stream-answer.js';

// cli/main.ts — a CLI belépési pont a MASTRA agentek fölé. Két parancs, két agent:
//   plantbase ask     → 'plantbase-query'      (olvas: katalógus + tudásbázis)
//   plantbase ingest  → 'plantbase-katalogus'  (ír: termékfelvétel/-frissítés)
//
// MI VÁLTOZOTT A MASTRÁVAL:
//   • Nincs saját agent-loop és nincs saját színes trace. A válasz STREAMEL (textStream),
//     a „mit csinál" pedig a Mastra loggeré és a Studióé (`pnpm mastra:dev`).
//   • Nincs kézzel átadogatott üzenet-előzmény: a beszélgetés-memória a Mastra Memory,
//     amit a `memory: { thread, resource }` opció kapcsol be. A thread a beszélgetés,
//     a resource a felhasználó — a CLI-ben ez fixen `cli-user`.
//   • A régi `--quiet` KIKERÜLT: az egyetlen dolga az volt, hogy elnémítsa a MI trace-ünket,
//     ami már nem létezik. Helyette `--thread <id>` jött, mert a Memory korában ez az,
//     amire a CLI-nek tényleg szüksége van: egy korábbi beszélgetés folytatása.

/** Egy felhasználó = egy resource. A CLI-nek egy „gépnél ülő ember" a modellje. */
const CLI_RESOURCE = 'cli-user';

const program = new Command();

interface AskOptions {
  thread?: string;
}

/** Fail-fast: a hiányzó kulcs/DB-konfigurációt azonnal, érthetően jelezzük. */
function ensureConfig(): void {
  try {
    loadConfig();
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      console.error(`plantbase: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

program
  .name('plantbase')
  .description(
    'Plantbase — természetes nyelvű kérdés-válasz a növény-katalógus felett (CLI).',
  )
  .version('0.0.1');

program
  .command('ask')
  .description('Egyszeri kérdés, vagy argumentum nélkül interaktív mód.')
  .argument('[kérdés...]', 'a feltett kérdés (idézőjelben vagy szavanként)')
  .option(
    '--thread <id>',
    'egy korábbi beszélgetés folytatása (Mastra Memory thread-azonosító)',
  )
  .action(async (words: string[], options: AskOptions) => {
    ensureConfig();
    const agent = mastra.getAgentById('plantbase-query');
    const threadId = options.thread ?? randomUUID();
    const question = words.join(' ').trim();
    try {
      if (question === '') {
        await runInteractive({
          agent,
          threadId,
          resourceId: CLI_RESOURCE,
          banner:
            'Plantbase interaktív mód — kilépés: "exit" vagy Ctrl-D.\n' +
            `beszélgetés (thread): ${threadId}`,
        });
      } else {
        await streamAgentAnswer(agent, question, {
          thread: threadId,
          resource: CLI_RESOURCE,
        });
      }
    } finally {
      // A read-only pg-pool életben tartja az event loopot — zárjuk, hogy tisztán kilépjünk.
      await closeReadOnlyPool();
    }
  });

program
  .command('ingest')
  .description(
    'Katalógus-kezelő agent: BESZÉLGETVE veszel fel/frissítesz termékeket (írás!). ' +
      'Argumentummal egyszeri utasítás, anélkül interaktív mód.',
  )
  .argument('[utasítás...]', 'pl. "állítsd a Kentia pálma árát 17900-ra"')
  .option(
    '--thread <id>',
    'egy korábbi beszélgetés folytatása (Mastra Memory thread-azonosító)',
  )
  .action(async (words: string[], options: AskOptions) => {
    ensureConfig();
    const agent = mastra.getAgentById('plantbase-katalogus');
    const threadId = options.thread ?? randomUUID();
    const instruction = words.join(' ').trim();
    try {
      if (instruction === '') {
        await runInteractive({
          agent,
          threadId,
          resourceId: CLI_RESOURCE,
          banner:
            'Plantbase katalógus-kezelő (ingest) mód — írási művelet! Kilépés: "exit" vagy Ctrl-D.\n' +
            `beszélgetés (thread): ${threadId}`,
        });
      } else {
        await streamAgentAnswer(agent, instruction, {
          thread: threadId,
          resource: CLI_RESOURCE,
        });
      }
    } finally {
      // Az ingest-agent olvas (read-only) ÉS ír (read-write) — mindkét poolt zárjuk.
      await Promise.all([closeReadOnlyPool(), closeReadWritePool()]);
    }
  });

// Parancs nélkül: súgó.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`plantbase hiba: ${message}`);
  process.exit(1);
});
