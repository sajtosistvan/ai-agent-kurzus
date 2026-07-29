import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// smoke.ts — DEV-eszköz, nem a szerver része. Elindítja a saját MCP-szerverünket egy VALÓDI
// MCP-kliensen keresztül, listázza a tooljait, és lefuttat egy olcsó hívást.
//
// Két dolgot ad, mindkettő a demó előtt fontos:
//   1. BEMELEGÍTÉS — az első indítás tsx-fordítással megy (másodpercek). Ha ezt a demó alatt
//      fizeti meg a host, az látszik: a Claude Desktop 60 s után timeoutol.
//   2. ELLENŐRZÉS — ha a DB áll, vagy elcsúszott egy tool-séma, itt derül ki, nem a közönség előtt.
//
// Modellt NEM hív (az ask_plantbase-t szándékosan kihagyja), tehát nem kerül tokenbe.

const EXPECTED_TOOLS = ['search_plants', 'search_knowledge', 'ask_plantbase'];

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['mcp'],
    cwd: process.cwd(),
    stderr: 'pipe', // a szerver indulási sorát nem öntjük a demó-logba
  });

  const client = new Client({ name: 'plantbase-smoke', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`hiányzó tool(ok): ${missing.join(', ')}`);
  }

  // Olcsó, determinisztikus hívás: ez már a DB-t is megpiszkálja (a modellt nem).
  const probe = await client.callTool({
    name: 'search_plants',
    arguments: { limit: 1 },
  });
  if (probe.isError === true) {
    const [first] = probe.content as { text?: string }[];
    throw new Error(`a search_plants hibázott: ${first?.text ?? 'ismeretlen'}`);
  }

  process.stdout.write(`→ MCP rendben — toolok: ${names.join(', ')}\n`);
  await client.close();
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`→ MCP ELLENŐRZÉS BUKOTT: ${message}\n`);
  process.exit(1);
});
