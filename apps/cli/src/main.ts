import { Command } from 'commander';
import { echo } from '@plantbase/core';
import { runInteractive } from './interactive.js';

// B1 — CLI echo: a program visszaírja, amit beírtál. Még NINCS LLM és NINCS adatbázis.
// A "válasz" forrása a core.echo; a B2-ben ezt váltja askAgent, a B3-ban a runSql-es agent.
//   plantbase ask "<kérdés>"  -> egyszeri echo
//   plantbase ask             -> interaktív readline mód (exit-ig)

const program = new Command();

// A bemenetből választ előállító függvény. B1: echo. (B2/B3: ezt cseréljük.)
const respond = (input: string): string => echo(input);

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
  .action(async (words: string[]) => {
    const question = words.join(' ').trim();
    if (question === '') {
      await runInteractive(respond);
      return;
    }
    console.log(respond(question));
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
