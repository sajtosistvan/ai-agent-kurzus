import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAskPlantbase } from './tools/ask-plantbase/ask-plantbase-tool.js';
import { registerSearchKnowledge } from './tools/search-knowledge/search-knowledge-tool.js';
import { registerSearchPlants } from './tools/search-plants/search-plants-tool.js';

// plantbase-server.ts — AZ MCP-szerver, transport NÉLKÜL.
//
// Ez a fájl a bizonyítéka annak, hogy az MCP-ben a TRANSPORT és a KÉPESSÉGEK külön rétegek:
//   main.ts  → ugyanez a szerver stdio-n   (a host indítja a folyamatot a gépeden)
//   http.ts  → ugyanez a szerver HTTP-n    (a neten, URL-lel bárki hozzáadja)
// A három tool egyetlen sora sem változik attól, hogy melyik úton érkezik a kérés.

const SERVER_NAME = 'plantbase';
const SERVER_VERSION = '0.1.0';

/** Egy friss, felkonfigurált MCP-szerver. HTTP-n kérésenként újat építünk (stateless mód). */
export function buildPlantbaseServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      // A hostnak szóló használati útmutató — ez a modell kontextusába kerül a toolok mellé.
      instructions:
        'A Plantbase egy magyar növény-webshop katalógusa (products) és gondozási tudásbázisa. ' +
        'Nyers katalógus-adathoz a search_plants, gondozási kérdéshez a search_knowledge, kész ' +
        'szakértői válaszhoz (a kettő együtt, magyarul megfogalmazva) az ask_plantbase toolt hívd. ' +
        'A felület csak olvas: a katalógust ezen keresztül nem lehet módosítani.',
    },
  );

  registerSearchPlants(server);
  registerSearchKnowledge(server);
  registerAskPlantbase(server);

  return server;
}

export const TOOL_NAMES = ['search_plants', 'search_knowledge', 'ask_plantbase'] as const;
