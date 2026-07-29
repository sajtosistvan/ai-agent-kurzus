import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeSearchKnowledge } from '@plantbase/core';

// search_knowledge — a HARMADIK stílus: nem új logika, hanem egy MEGLÉVŐ core-tool átkötése
// MCP-re. A core-ban a tool két részre van vágva (konvenció, lásd CLAUDE.md „Tool layer"):
//
//   executeSearchKnowledge(input) → ToolOutcome   ← a HATÁRVÉDELEM és a logika (Zod, retrieval)
//   searchKnowledgeTool(report)                   ← az AI SDK-nak szóló tool-definíció
//
// Az MCP-nek csak a MÁSODIK fele idegen: a saját tool-alakja van. Az elsőt változtatás nélkül
// újrahasználjuk — ugyanaz a validáció, ugyanaz a magyar hibaszöveg, ugyanaz a RAG-pipeline
// (HyDE + vektorkeresés + rerank), akár az agent hívja, akár egy idegen host.
//
// Ez a tanulság: ha a tool logikája nem tapad az SDK-hoz, egy új felület pár sor.
//
// MELLÉKHATÁS: a retrieval színes nyomot ír (traceLog → stdout). stdio-transporton ez halálos
// lenne — a main.ts captureStdout()-ja miatt a stderr-re megy, ahol a host naplózza.

export function registerSearchKnowledge(server: McpServer): void {
  server.registerTool(
    'search_knowledge',
    {
      title: 'Keresés a gondozási tudásbázisban',
      description:
        'Szemantikus keresés a bolt növénygondozási cikkeiben: kártevők, betegségek, öntözés, ' +
        'fény, átültetés, évszakos teendők. Minden találat a FORRÁS-URL-jével jön — a válaszban ' +
        'hivatkozz rájuk. "Hogyan / miért / mit tegyek" jellegű kérdésekhez való; a katalógus ' +
        'tényeihez (ár, készlet, méret) a search_plants a helyes eszköz.',
      inputSchema: {
        kerdes: z
          .string()
          .trim()
          .min(1)
          .describe(
            'A kérdés természetes nyelven, ahogy elhangzott — ne alakítsd kulcsszavakká, ' +
              'a keresés jelentés alapján dolgozik.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ kerdes }) => {
      // A core execute-ja SOHA nem dob: hibát is ToolOutcome-ként ad vissza. Csak az alakot
      // kell MCP-re fordítani (content-tömb + isError).
      const outcome = await executeSearchKnowledge({ question: kerdes });

      return {
        isError: outcome.isError,
        content: [{ type: 'text' as const, text: outcome.content }],
      };
    },
  );
}
