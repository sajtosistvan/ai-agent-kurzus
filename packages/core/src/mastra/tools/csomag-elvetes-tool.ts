import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// csomag_elvetes tool — a csomag-folyamatból való kilépés EGYIK útja (a másik a sikeres
// csomag_mentes). Az execute csak nyugtáz és RÖGZÍT: a lemondás ténye maga a tool-hívás,
// amit a Mastra trace és a Logs fül megőriz. Nincs DB-írás: a le nem zárt csomagterv
// csak a beszélgetésben élt.

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  indok: z.string(),
  uzenet: z.string(),
});

export type CsomagElvetesKimenet = z.infer<typeof KimenetSchema>;

export const csomagElvetesTool = createTool({
  id: 'csomag_elvetes',
  description:
    'A csomag-összeállítás LEMONDÁSA. Akkor hívd, ha a felhasználó kifejezetten lemondja ' +
    'a csomagot (nem kéri, elhalasztja, meggondolta magát). Ez zárja le a csomag-folyamatot ' +
    'mentés nélkül.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Rövid magyar indok, ha a felhasználó mondott.'),
  }),
  outputSchema: KimenetSchema,
  execute: async ({ reason }, { mastra }) => {
    const indok = reason?.trim() ? reason.trim() : 'a felhasználó lemondta';
    mastra?.getLogger()?.info('csomag_elvetes — a folyamat mentés nélkül lezárva', { indok });
    return {
      sikeres: true,
      indok,
      uzenet:
        'A csomag-összeállítást lemondtuk, semmi nem került mentésre. ' +
        'Nyugtázd a felhasználónak egy mondatban, és jelezd, hogy bármikor újrakezdhetitek.',
    };
  },
});
