import 'dotenv/config';
import { Command } from 'commander';
import {
  askAgent,
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  type AskResult,
} from '@plantbase/core';
import { runInteractive } from './interactive.js';

// B3 — SQL-es interakció: a CLI az askAgent-be van kötve, ami a runSql toollal a read-only
// katalógus felett dolgozik. Az agent SQL-t ír, lefuttatja, és magyar választ ad.
// (B2 maradványa a kommentben: korábban LLM DB nélkül; most már van adatbázis-elérés.)
// Még NINCS runSql/adatbázis (az a B3).
//   plantbase ask "<kérdés>"          -> egyszeri válasz
//   plantbase ask                     -> interaktív mód (exit-ig)
//   plantbase ask --show-prompt ...   -> a teljes system prompt + üzenetek kiírása

const program = new Command();

interface AskOptions {
  showPrompt: boolean;
}

function printPrompt(result: AskResult): void {
  console.log('----- system prompt -----');
  console.log(result.systemPrompt);
  console.log('----- üzenetek (messages) -----');
  console.log(JSON.stringify(result.messages, null, 2));
  console.log('----- válasz -----');
}

// A bemenetből választ előállító függvény (egyszeri és interaktív módban is ezt használjuk).
function makeResponder(
  options: AskOptions,
): (input: string) => Promise<string> {
  return async (input: string): Promise<string> => {
    const result = await askAgent(input);
    if (options.showPrompt) {
      printPrompt(result);
    }
    return result.answer;
  };
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
    '--show-prompt',
    'a teljes system prompt és üzenet-tömb kiírása',
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

    const respond = makeResponder(options);
    const question = words.join(' ').trim();
    try {
      if (question === '') {
        await runInteractive(respond);
      } else {
        console.log(await respond(question));
      }
    } finally {
      // A read-only pg-pool életben tartja az event loopot — zárjuk, hogy tisztán kilépjünk.
      await closeReadOnlyPool();
    }
  });

// Parancs nélkül: súgó (a beépített `help [command]` így is működik).
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`plantbase hiba: ${message}`);
  process.exit(1);
});
