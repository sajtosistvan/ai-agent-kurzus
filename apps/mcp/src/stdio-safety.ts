import type { LoggerTransport } from '@mastra/core/logger';
import { PinoLogger } from '@mastra/loggers';
import { mastra } from '@plantbase/core';

// stdio-safety.ts — A STDIO-BUKTATÓ, egy fájlba zárva (lásd docs/mcp.md).
//
// stdio-transporton a STDOUT A PROTOKOLL CSATORNÁJA: egyetlen odaírt sor is használhatatlanná
// teszi a szervert. A Mastra alapértelmezett `PinoLogger`-e viszont a stdout-ra ír, és egy
// eltévedt `console.log` is oda menne. Két lépésben zárjuk ki mindkettőt:
//
//   1. A Mastra loggerét ÁTIRÁNYÍTJUK a stderr-re (`overrideDefaultTransports` + stderr stream).
//      Ez a Mastra-natív megoldás — nem a stdout-ot csonkítjuk, hanem a naplót tesszük a
//      helyes csatornára. A host a stderr-t naplózza, tehát semmi nem vész el.
//   2. A `console.*` hívásokat is a stderr-re tereljük, ha egy könyvtár mégis odaírna.
//      A `process.stdout.write`-hoz NEM nyúlunk: az kell a protokollnak.

/** Csak stdio-transporton hívd — HTTP-n a stdout szabadon használható. */
export function makeStdoutProtocolOnly(): void {
  mastra.setLogger({
    logger: new PinoLogger({
      name: 'plantbase-mcp',
      level: 'info',
      overrideDefaultTransports: true,
      transports: {
        default: process.stderr as unknown as LoggerTransport,
      },
    }),
  });

  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((a) => String(a)).join(' ')}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
  console.debug = toStderr;
}
