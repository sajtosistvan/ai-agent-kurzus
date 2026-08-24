import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ensureReadOnlySelect, runReadOnlyQuery } from '@plantbase/core';
import { buildPlantSearchSql, PlantSearchSchema } from './plant-search-sql.js';

// search_plants — az ADAT-tool. Nincs benne modell: strukturált szűrőkből SQL lesz, a sorokat
// visszaadjuk. A GONDOLKODÁS a hívó oldalán (Claude-ban) történik — ez a klasszikus MCP-minta:
// gyors, olcsó, kiszámítható, és a hívó modell szabadon kombinálja a saját kontextusával.
//
// Vö. ask_plantbase: ott a MI agentünk gondolkodik, és kész magyar választ ad vissza.
//
// MASTRA: ez már `createTool` — ugyanaz az alak, mint a core tooljainál. Az MCPServer ebből
// generálja az MCP tool-sémát; a NEVET a `plantbase-server.ts` toolmapjának KULCSA adja
// (`search_plants`), hogy a külső hostok szerződése ne változzon.

export const searchPlantsTool = createTool({
  id: 'search_plants',
  description:
    'Strukturált keresés a Plantbase növény-katalógusban (kategória, fény, nehézség, ár, ' +
    'pet-safe, készlet). Read-only. Nyers sorokat ad vissza JSON-ban — akkor használd, ha ' +
    'magad akarod értelmezni az adatot. Ha kész, magyar nyelvű tanácsot kérnél, az ' +
    'ask_plantbase toolt hívd.',
  inputSchema: PlantSearchSchema,
  outputSchema: z.object({
    sikeres: z.boolean(),
    sorokSzama: z.number(),
    sorok: z.array(z.record(z.string(), z.unknown())),
    hibaüzenet: z.string().nullable(),
  }),
  execute: async (bemenet, ctx) => {
    const logger = ctx?.mastra?.getLogger();
    const { sql, params } = buildPlantSearchSql(bemenet);

    try {
      // Védelmi rétegek egymáson: paraméterezett SQL + a core SELECT-guardja + read-only
      // szerepkör + read-only tranzakció (NFR1). A guard itt „öv és nadrágtartó" — a
      // lekérdezést mi írtuk, de a szabály ugyanaz marad minden úton, ami a DB-hez ér.
      const result = await runReadOnlyQuery(ensureReadOnlySelect(sql), params);
      return {
        sikeres: true,
        sorokSzama: result.rowCount,
        sorok: result.rows as Record<string, unknown>[],
        hibaüzenet: null,
      };
    } catch (error: unknown) {
      // A tool NEM dob: a hibát is eredményként adjuk vissza, hogy a hívó modell tudjon
      // vele mit kezdeni.
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn('search_plants: adatbázis-hiba', { message });
      return {
        sikeres: false,
        sorokSzama: 0,
        sorok: [],
        hibaüzenet: `Adatbázis-hiba: ${message}`,
      };
    }
  },
});
