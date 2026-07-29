import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { askAgent } from '@plantbase/core';

// ask_plantbase — az AGENT-AS-TOOL. A hívó host (Claude) számára ez egy sima tool-hívás, de
// mögötte a MI teljes agent-loopunk fut: saját system prompt, saját toolkészlet (runSql,
// searchKnowledge, queryCustomers), több kör, majd kész magyar válasz.
//
//   Claude (a hívó)  →  MCP tool: ask_plantbase  →  plantbase query-agent
//                                                     ├── runSql          (katalógus)
//                                                     └── searchKnowledge (RAG tudásbázis)
//
// MIÉRT ÍGY: a domén-tudás (SQL-szabályok, séma, magyar hangnem, RAG-forrásidézés) a MI
// promptunkban van, nem a hívóéban. A hívó modell nem tudja — és nem is kell tudnia —, hogyan
// néz ki a products tábla. Cserébe lassabb (több modellhívás), és a hívó nem lát bele a
// lépésekbe: neki ez egy fekete doboz. A trace nálunk marad (logs/<ts>.json).
//
// SZEREP: fixen 'customer'. Adminként a query-agent megkapná a delegateToIngest toolt, azzal
// pedig az MCP-n keresztül BE lehetne írni a katalógusba. Az MCP-felület read-only marad.

const QUESTION_MAX = 1000;

export function registerAskPlantbase(server: McpServer): void {
  server.registerTool(
    'ask_plantbase',
    {
      title: 'Kérdezd meg a Plantbase növény-szakértőt',
      description:
        'Természetes nyelvű kérdést tesz fel a Plantbase szakértő agentnek, ami a növény-' +
        'katalógusból (ár, készlet, fény- és vízigény, pet-safe) és a gondozási tudásbázisból ' +
        'dolgozik, és kész, magyar nyelvű választ ad forrásokkal. Akkor használd, ha ajánlást, ' +
        'gondozási tanácsot vagy összetett, több szempontú kérdésre választ kérsz. Ha csak ' +
        'nyers katalógus-sorokra van szükséged, a search_plants gyorsabb; ha csak gondozási ' +
        'cikkekre, a search_knowledge.',
      inputSchema: {
        kerdes: z
          .string()
          .trim()
          .min(1)
          .max(QUESTION_MAX)
          .describe('A kérdés — magyarul a legjobb, pl. "milyen pet-safe növény bírja az árnyékot?"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ kerdes }) => {
      try {
        const result = await askAgent(kerdes, {
          // KRITIKUS stdio-transporton: a színes trace a stdout-ra menne, és szétverné a
          // JSON-RPC üzenetfolyamot. A nyom így is elkészül a logs/<ts>.json fájlba.
          print: false,
          role: 'customer',
        });

        return {
          content: [
            { type: 'text' as const, text: result.answer },
            {
              type: 'text' as const,
              text: `— plantbase agent · ${result.usage.inputTokens}/${result.usage.outputTokens} token · nyom: ${result.tracePath}`,
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `A plantbase agent hibára futott: ${message}` }],
        };
      }
    },
  );
}
