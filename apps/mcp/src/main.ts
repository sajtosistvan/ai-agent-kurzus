import 'dotenv/config';
import {
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closePrisma,
} from '@plantbase/core';
import { buildPlantbaseServer, TOOL_NAMES } from './plantbase-server.js';
import { makeStdoutProtocolOnly } from './stdio-safety.js';

// mcp/main.ts — a NEGYEDIK belépési pont a core fölé (CLI, HTTP-szerver, web mellé). Itt nem mi
// hívjuk a modellt: egy IDEGEN host (Claude Desktop / Claude Code) modellje hívja a mi
// tooljainkat. Az MCP ennek a kapcsolatnak a szabványa.
//
// TRANSPORT: stdio — a host indítja a folyamatot, és stdin/stdout-on beszél vele JSON-RPC-ben.
// Dev módban ez a legegyszerűbb: nincs tunnel, nincs auth, a folyamat a gépen fut.
//
// A toolok és a szerver-összeállítás NEM itt vannak, hanem a plantbase-server.ts-ben — mert a
// http.ts UGYANAZT a szervert szolgálja ki a hálózaton. Ez a fájl csak a stdio-specifikus
// tennivalókat tartalmazza (a napló elterelése a stdout elől, leállítás).

async function main(): Promise<void> {
  // ELSŐ LÉPÉS, minden más előtt: a stdout maradjon tisztán a protokollé.
  makeStdoutProtocolOnly();

  // Fail-fast: hiányzó kulcs/DB esetén a host hibaüzenetében is látszik, mi a baj.
  // A stderr biztonságos: a host naplózza, a protokollt nem zavarja.
  try {
    loadConfig();
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      process.stderr.write(`plantbase-mcp: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  await buildPlantbaseServer().startStdio();
  process.stderr.write(
    `plantbase-mcp: kész (stdio), toolok: ${TOOL_NAMES.join(', ')}\n`,
  );
}

/** A host SIGTERM/SIGINT-tel állítja le a folyamatot — a DB-kapcsolatokat lezárjuk. */
async function shutdown(): Promise<void> {
  await Promise.allSettled([closeReadOnlyPool(), closePrisma()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plantbase-mcp: indítási hiba — ${message}\n`);
  process.exit(1);
});
