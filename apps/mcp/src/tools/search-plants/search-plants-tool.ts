import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureReadOnlySelect, runReadOnlyQuery } from '@plantbase/core';
import { buildPlantSearchSql, PlantSearchSchema } from './plant-search-sql.js';

// search_plants — az ADAT-tool. Nincs benne modell: strukturált szűrőkből SQL lesz, a sorokat
// visszaadjuk. A GONDOLKODÁS a hívó oldalán (Claude-ban) történik — ez a klasszikus MCP-minta:
// gyors, olcsó, kiszámítható, és a hívó modell szabadon kombinálja a saját kontextusával.
//
// Vö. ask_plantbase: ott a mi agentünk gondolkodik, és kész magyar választ ad vissza.

/** A Zod-séma mezőnkénti alakja — az MCP SDK ebből generálja a tool JSON Schema-ját. */
const inputShape = PlantSearchSchema.shape;

export function registerSearchPlants(server: McpServer): void {
  server.registerTool(
    'search_plants',
    {
      title: 'Növénykeresés a katalógusban',
      description:
        'Strukturált keresés a Plantbase növény-katalógusban (kategória, fény, nehézség, ár, ' +
        'pet-safe, készlet). Read-only. Nyers sorokat ad vissza JSON-ban — akkor használd, ha ' +
        'magad akarod értelmezni az adatot. Ha kész, magyar nyelvű tanácsot kérnél, az ' +
        'ask_plantbase toolt hívd.',
      inputSchema: inputShape,
      // A hívó hostnak (Claude) szóló jelzés: ez a tool nem módosít semmit, biztonságos hívni.
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (filters) => {
      const { sql, params } = buildPlantSearchSql(filters);

      try {
        // Védelmi rétegek egymáson: paraméterezett SQL + a core SELECT-guardja + read-only
        // szerepkör + read-only tranzakció. A guard itt "öv és nadrágtartó" — a lekérdezést
        // mi írtuk, de a szabály ugyanaz marad minden úton, ami a DB-hez ér.
        const result = await runReadOnlyQuery(ensureReadOnlySelect(sql), params);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { rowCount: result.rowCount, rows: result.rows },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // A tool NEM dob: hibát is eredményként adunk vissza (isError), hogy a hívó modell
        // tudjon vele mit kezdeni — ugyanaz az elv, mint a core ToolOutcome-jában.
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Adatbázis-hiba: ${message}` }],
        };
      }
    },
  );
}
