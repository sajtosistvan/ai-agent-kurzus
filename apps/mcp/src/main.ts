import 'dotenv/config';
import { Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closePrisma,
} from '@plantbase/core';
import { buildPlantbaseServer, TOOL_NAMES } from './plantbase-server.js';

// mcp/main.ts — a NEGYEDIK belépési pont a core fölé (CLI, HTTP-szerver, web mellé). Itt nem mi
// hívjuk a modellt: egy IDEGEN host (Claude Desktop / Claude Code) modellje hívja a mi
// tooljainkat. Az MCP ennek a kapcsolatnak a szabványa — a `@plantbase/core` most sem tud róla,
// hogy létezünk.
//
// HÁROM TOOL, HÁROM STÍLUS — szándékosan:
//   search_plants    → ADAT-tool: strukturált szűrő → paraméterezett SELECT → nyers sorok.
//                      Determinisztikus, gyors, unit-tesztelhető. A HÍVÓ modell gondolkodik.
//   search_knowledge → ÁTKÖTÖTT core-tool: a meglévő executeSearchKnowledge (RAG) új felületen,
//                      logika-változtatás nélkül. Ennyibe kerül egy tool, ha jól van elvágva.
//   ask_plantbase    → AGENT-as-tool: a mi query-agentünk teljes loopja fut le mögötte.
//                      Lassabb, de a domén-tudás (prompt, SQL-szabályok, RAG) nálunk marad.
//
// TRANSPORT: stdio — a host indítja a folyamatot, és stdin/stdout-on beszél vele JSON-RPC-ben.
// Dev módban ez a legegyszerűbb: nincs tunnel, nincs auth, a folyamat a gépen fut.
//
// A toolok és a szerver-összeállítás NEM itt vannak, hanem a plantbase-server.ts-ben — mert a
// http.ts UGYANAZT a szervert szolgálja ki a hálózaton. Ez a fájl csak a stdio-specifikus
// tennivalókat tartalmazza (a stdout elvétele, leállítás).

/**
 * A stdout ELVÉTELE a program elől — stdio-transporton ez nem stílus kérdése:
 * a stdout a PROTOKOLL csatornája, egyetlen odaírt sor is használhatatlanná teszi a szervert.
 * A core néhány helyen (RAG-nyom, trace) a stdout-ra ír; ezért:
 *   - a protokoll az EREDETI stdout-ot kapja (protocolOut),
 *   - minden más `process.stdout.write` hívás a stderr-re megy (ott a host naplózza).
 */
function captureStdout(): Writable {
  const rawWrite = process.stdout.write.bind(process.stdout);

  const protocolOut = new Writable({
    write(chunk, encoding, callback): void {
      rawWrite(chunk as Buffer | string, encoding, () => callback());
    },
  });

  process.stdout.write = ((
    chunk: Buffer | string,
    ...rest: unknown[]
  ): boolean =>
    (process.stderr.write as (...args: unknown[]) => boolean)(
      chunk,
      ...rest,
    )) as typeof process.stdout.write;

  return protocolOut;
}

async function main(): Promise<void> {
  const protocolOut = captureStdout();

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

  const server = buildPlantbaseServer();

  await server.connect(new StdioServerTransport(process.stdin, protocolOut));
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
