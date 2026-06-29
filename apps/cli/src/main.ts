import { Command } from 'commander';

// A6 — üres CLI: a parancsváz elindul, --help/--version működik.
// Még NINCS LLM és NINCS adatbázis. Az `ask` egyelőre placeholder:
//   1. fázis (B1): echo,  2. fázis (B2): LLM,  3. fázis (B3): runSql.

const program = new Command();

program
  .name('plantbase')
  .description(
    'Plantbase — természetes nyelvű kérdés-válasz a növény-katalógus felett (CLI).',
  )
  .version('0.0.1');

program
  .command('ask')
  .description('Kérdés a katalógusról (az interakció a B fázisokban épül).')
  .argument('[kérdés...]', 'a feltett kérdés (idézőjelben vagy szavanként)')
  .action((words: string[]) => {
    const question = words.join(' ').trim();
    console.log(
      'plantbase: a parancsvázat látod — még nincs LLM és nincs adatbázis.',
    );
    console.log('A működés a B fázisokban épül: echo → LLM → runSql.');
    if (question) {
      console.log(`(beérkezett kérdés: "${question}")`);
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
