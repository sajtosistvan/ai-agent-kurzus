import 'dotenv/config';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  askAgent,
  runIngestAgent,
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
  setWatchLog,
} from '@plantbase/core';
import { runInteractive } from './interactive.js';

// plantbase ask "<kérdés>"      -> egyszeri válasz (élő színes trace + logs/<ts>.json)
// plantbase ask                 -> interaktív mód (beszélgetés-memóriával, exit-ig)
// plantbase ask --quiet ...     -> nincs élő trace (csak a válasz), a JSON nyom akkor is elkészül
// plantbase ingest "<utasítás>" -> a DB-töltő agent (webshop-feed → products tábla, RW kapcsolat)
//                                  UGYANAZZAL az élő trace-szel, mint az ask.

const program = new Command();

interface AskOptions {
  quiet: boolean;
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
    '--quiet',
    'ne írja ki az élő trace-t (a JSON nyom akkor is elkészül)',
    false,
  )
  .action(async (words: string[], options: AskOptions) => {
    // Fail-fast: a kulcs/konfiguráció hiányát azonnal, érthetően jelezzük.
    try {
      loadConfig();
    } catch (error: unknown) {
      if (error instanceof ConfigError) {
        console.error(`plantbase: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }

    // A folyamatos "control room" log bekapcsolása: külön terminálban `tail -f logs/agent.log`.
    setWatchLog(join(process.cwd(), 'logs', 'agent.log'));

    const question = words.join(' ').trim();
    try {
      if (question === '') {
        await runInteractive(options.quiet);
      } else {
        const result = await askAgent(question, { print: !options.quiet });
        // Csendes módban a trace nem ír semmit → a választ itt írjuk ki.
        if (options.quiet) {
          console.log(result.answer);
        }
      }
    } finally {
      // A read-only pg-pool életben tartja az event loopot — zárjuk, hogy tisztán kilépjünk.
      await closeReadOnlyPool();
    }
  });

program
  .command('ingest')
  .description(
    'A DB-töltő agent: webshop-feedből (thesill | tropicalhome) frissíti a products táblát.',
  )
  .argument(
    '<utasítás...>',
    'mit töltsön be (pl. "tölts be 3 futónövényt a tropicalhome-ról")',
  )
  .option(
    '--quiet',
    'ne írja ki az élő trace-t (a JSON nyom akkor is elkészül)',
    false,
  )
  .action(async (words: string[], options: AskOptions) => {
    // Fail-fast: ugyanaz a konfigurációs kapu, mint az ask-nál.
    try {
      loadConfig();
    } catch (error: unknown) {
      if (error instanceof ConfigError) {
        console.error(`plantbase: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }

    // Ugyanaz a control room: a trace az agent.log-ba is megy (`tail -f logs/agent.log`).
    setWatchLog(join(process.cwd(), 'logs', 'agent.log'));

    const instruction = words.join(' ').trim();
    try {
      const result = await runIngestAgent(instruction, {
        print: !options.quiet,
      });
      if (options.quiet) {
        console.log(result.summary);
      }
    } finally {
      // Az ingest a READ-WRITE poolt használja — azt zárjuk kilépés előtt.
      await closeReadWritePool();
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
