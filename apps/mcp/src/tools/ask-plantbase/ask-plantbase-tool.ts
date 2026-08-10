import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mastra } from '@plantbase/core';

// ask_plantbase — az AGENT-AS-TOOL. A hívó host (Claude) számára ez egy sima tool-hívás, de
// mögötte a MI Mastra agentünk fut: saját instructions, saját toolkészlet (katalógus-SQL,
// tudásbázis), több kör, majd kész magyar válasz.
//
//   Claude (a hívó)  →  MCP tool: ask_plantbase  →  Mastra agent 'plantbase-query'
//                                                     ├── katalógus-SQL (read-only)
//                                                     └── tudásbázis    (RAG)
//
// MIÉRT ÍGY: a domén-tudás (SQL-szabályok, séma, magyar hangnem, RAG-forrásidézés) a MI
// agentünkben van, nem a hívóéban. Cserébe lassabb (több modellhívás), és a hívó nem lát
// bele a lépésekbe: neki ez egy fekete doboz. A nyom nálunk marad — a Mastra observability
// (Studio) mutatja meg.
//
// MIÉRT NEM az MCPServer `agents:` mezője? Mert az `ask_<kulcs>` néven, `message` paraméterrel
// generálna toolt. A KÜLSŐ SZERZŐDÉS (`ask_plantbase` + `kerdes`) viszont fix — hostok vannak
// rákötve —, ezért saját toolba burkoljuk az agentet.
//
// OLVASÓ ÚT: szándékosan a query-agent, nem a katalógus-agent. Az MCP-felület nem ír.

const KERDES_MAX = 1000;

export const askPlantbaseTool = createTool({
  id: 'ask_plantbase',
  description:
    'Természetes nyelvű kérdést tesz fel a Plantbase szakértő agentnek, ami a növény-' +
    'katalógusból (ár, készlet, fény- és vízigény, pet-safe) és a gondozási tudásbázisból ' +
    'dolgozik, és kész, magyar nyelvű választ ad forrásokkal. Akkor használd, ha ajánlást, ' +
    'gondozási tanácsot vagy összetett, több szempontú kérdésre választ kérsz. Ha csak ' +
    'nyers katalógus-sorokra van szükséged, a search_plants gyorsabb; ha csak gondozási ' +
    'cikkekre, a search_knowledge.',
  inputSchema: z.object({
    kerdes: z
      .string()
      .trim()
      .min(1)
      .max(KERDES_MAX)
      .describe(
        'A kérdés — magyarul a legjobb, pl. "milyen pet-safe növény bírja az árnyékot?"',
      ),
  }),
  outputSchema: z.object({
    sikeres: z.boolean(),
    valasz: z.string(),
    hibaüzenet: z.string().nullable(),
  }),
  execute: async ({ kerdes }, ctx) => {
    const logger = ctx?.mastra?.getLogger();
    try {
      // Nincs memória-opció: minden MCP-hívás önálló kérdés, előzmény nélkül. A hívó host
      // a saját beszélgetésében tartja a kontextust.
      const result = await mastra.getAgentById('plantbase-query').generate(kerdes);
      return { sikeres: true, valasz: result.text, hibaüzenet: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error('ask_plantbase: az agent hibára futott', { message });
      return {
        sikeres: false,
        valasz: '',
        hibaüzenet: `A plantbase agent hibára futott: ${message}`,
      };
    }
  },
});
