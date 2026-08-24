import { MCPServer } from '@mastra/mcp';
import { tudasbazisTool } from '@plantbase/core';
import { askPlantbaseTool } from './tools/ask-plantbase/ask-plantbase-tool.js';
import { searchPlantsTool } from './tools/search-plants/search-plants-tool.js';

// plantbase-server.ts — AZ MCP-szerver, transport NÉLKÜL.
//
// Ez a fájl a bizonyítéka annak, hogy az MCP-ben a TRANSPORT és a KÉPESSÉGEK külön rétegek:
//   main.ts  → ugyanez a szerver stdio-n   (a host indítja a folyamatot a gépeden)
//   http.ts  → ugyanez a szerver HTTP-n    (a neten, URL-lel bárki hozzáadja)
// A három tool egyetlen sora sem változik attól, hogy melyik úton érkezik a kérés.
//
// MASTRA: a szerver a `@mastra/mcp` `MCPServer`-e. A toolok Mastra `createTool`-ok, tehát
// UGYANAZOK az objektumok, amiket az agentek is használnak — az MCP csak egy másik felület
// rájuk. A TOOLMAP KULCSA adja a modell felé látszó nevet, ezért a külső szerződés
// (search_plants / search_knowledge / ask_plantbase) változatlan marad, még akkor is, ha
// a core-beli tool id-je magyar (`tudasbazis_kereses`).
//
// HÁROM TOOL, HÁROM STÍLUS — szándékosan:
//   search_plants    → ADAT-tool: strukturált szűrő → paraméterezett SELECT → nyers sorok.
//   search_knowledge → ÁTKÖTÖTT core-tool: a Mastra RAG-toolja, változtatás nélkül, új néven.
//   ask_plantbase    → AGENT-as-tool: a query-agent teljes futása egy tool mögé rejtve.

const SERVER_NAME = 'plantbase';
const SERVER_VERSION = '0.1.0';

/** Egy friss, felkonfigurált MCP-szerver. HTTP-n kérésenként újat építünk (stateless mód). */
export function buildPlantbaseServer(): MCPServer {
  return new MCPServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    // A hostnak szóló használati útmutató — ez a modell kontextusába kerül a toolok mellé.
    instructions:
      'A Plantbase egy magyar növény-webshop katalógusa (products) és gondozási tudásbázisa. ' +
      'Nyers katalógus-adathoz a search_plants, gondozási kérdéshez a search_knowledge, kész ' +
      'szakértői válaszhoz (a kettő együtt, magyarul megfogalmazva) az ask_plantbase toolt hívd. ' +
      'A felület csak olvas: a katalógust ezen keresztül nem lehet módosítani.',
    tools: {
      search_plants: searchPlantsTool,
      search_knowledge: tudasbazisTool,
      ask_plantbase: askPlantbaseTool,
    },
  });
}

export const TOOL_NAMES = [
  'search_plants',
  'search_knowledge',
  'ask_plantbase',
] as const;
