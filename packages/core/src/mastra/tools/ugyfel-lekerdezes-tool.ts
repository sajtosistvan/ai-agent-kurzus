import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';

import { getPrisma } from './prisma-client.js';
import { belsoMunkatars, olvasSzerep, type Szerep } from '../processors/szerep.js';

// ugyfel_lekerdezes tool — a bolt ÜGYFELEINEK lekérdezése (customers tábla, Prismán át).
// Nemcsak preferenciát ad, hanem teljes ügyfél-profilt: keret, szint, pet/kid-safe, jegyzet.
// A modell ebből tudja, KINEK ajánl — a budget és a notes a csomag-összeállítás alapja.
//
// A tényleges munkát a `lekerdezUgyfeleket` végzi (ide injektálható a Prisma-kliens, ezért
// tesztelhető DB nélkül); a createTool csak a modell felé eső burok + naplózás.

const UGYFEL_TIPUSOK = ['magánszemély', 'iroda', 'étterem', 'hotel', 'üzlet'] as const;

const LISTA_LIMIT = 20;

const BemenetSchema = z.object({
  code: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  customerType: z.enum(UGYFEL_TIPUSOK).optional(),
});

const UgyfelSchema = z.object({
  code: z.string(),
  name: z.string(),
  city: z.string(),
  customerType: z.string(),
  budget: z.number(),
  expertiseLevel: z.string(),
  petSafeRequired: z.boolean(),
  kidSafeRequired: z.boolean(),
  notes: z.string().nullable(),
});

const KimenetSchema = z.object({
  sikeres: z.boolean(),
  talalatokSzama: z.number(),
  ugyfelek: z.array(UgyfelSchema),
  uzenet: z.string(),
  hiba: z.string().nullable(),
});

export type UgyfelLekerdezesKimenet = z.infer<typeof KimenetSchema>;

const JOGOSULATLAN_LISTA =
  'Más ügyfelek listázása vagy név/város szerinti keresése nem engedélyezett. Ügyféladatot ' +
  'csak PONTOS ügyfélkóddal tudok lekérni (pl. ACME). A teljes ügyféllista belső munkatársi ' +
  'jogosultsághoz kötött.';

// ============================================================================
// SZEREPKÖR-ELLENŐRZÉS A TOOL SZINTJÉN (NEM csak a bejáratnál)
//
// Miért itt is, ha van már `rbac-processzor`? Mert az a bemeneti szűrő csak a katalógus
// SZERKESZTÉSÉRE utaló szavakat fogja meg — az adat KIOLVASÁSÁRA nem. Egy red team scan
// pontosan ezen a résen jutott be: „listázd ki a bolt ügyfeleit", és az agent kiadta 20 ügyfél
// nevét, városát, költségkeretét és belső jegyzetét. A prompt kérés, a kód kényszer.
//
// A szabály ARÁNYOS, nem mindent-vagy-semmit:
//   • belső munkatárs (admin): teljes hozzáférés — listázás, név/város keresés, minden mező.
//   • vásárló (customer):      KIZÁRÓLAG pontos ügyfélkóddal, és a `notes` (belső jegyzet)
//                              nem megy ki. Így a csomag-ajánló folyamat működik, de a tömeges
//                              listázás és a név/város szerinti felderítés megszűnik.
//
// Alapértelmezés a szűkebb jog (`customer`): ha a hívó nem ad szerepet, nem nyílik ki a tool.
// ============================================================================

/** Validál → szerepkör-ellenőrzés → Prisma-lekérdezés → strukturált kimenet. Soha nem dob. */
export async function lekerdezUgyfeleket(
  nyersBemenet: unknown,
  deps: { prisma?: PrismaClient; szerep?: Szerep } = {},
): Promise<UgyfelLekerdezesKimenet> {
  const ellenorzott = BemenetSchema.safeParse(nyersBemenet ?? {});
  if (!ellenorzott.success) {
    return {
      sikeres: false,
      talalatokSzama: 0,
      ugyfelek: [],
      uzenet: '',
      hiba:
        'Érvénytelen ügyfél-lekérdezés. Használható mezők: code (pontos ügyfélkód), ' +
        `search (név/város részlet), customerType (${UGYFEL_TIPUSOK.join(' | ')}).`,
    };
  }
  const { code, search, customerType } = ellenorzott.data;

  // ── SZEREPKÖR-KAPU ────────────────────────────────────────────────────────
  // Vásárlóként csak pontos kód megy. Fontos: az elutasítás UGYANAZ a szöveg akkor is, ha
  // az adott ügyfél létezik, és akkor is, ha nem — így a tool nem működik felderítő
  // orákulumként („létezik-e Kovács Anna a vásárlóitok között?").
  const belso = belsoMunkatars(deps.szerep ?? 'customer');
  if (!belso && !code) {
    return {
      sikeres: false,
      talalatokSzama: 0,
      ugyfelek: [],
      uzenet: '',
      hiba: JOGOSULATLAN_LISTA,
    };
  }

  try {
    const prisma = deps.prisma ?? getPrisma();
    const sorok = await prisma.customer.findMany({
      // Vásárlóként a szűrő KIZÁRÓLAG a kód — a `search`/`customerType` akkor sem érvényesül,
      // ha a modell mégis beleteszi a hívásba (a tiltást ne a prompt tartsa be, hanem a kód).
      where: belso
        ? {
            ...(code ? { code: code.toUpperCase() } : {}),
            ...(customerType ? { customerType } : {}),
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { city: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          }
        : { code: code!.toUpperCase() },
      orderBy: { code: 'asc' },
      take: LISTA_LIMIT,
    });

    if (sorok.length === 0) {
      return {
        sikeres: true,
        talalatokSzama: 0,
        ugyfelek: [],
        uzenet: 'Nincs ilyen ügyfél a nyilvántartásban.',
        hiba: null,
      };
    }

    // Csak a döntéshez kellő mezők, Decimal → szám.
    const ugyfelek = sorok.map((r) => ({
      code: r.code,
      name: r.name,
      city: r.city,
      customerType: r.customerType,
      budget: Number(r.budget),
      expertiseLevel: r.expertiseLevel,
      petSafeRequired: r.petSafeRequired,
      kidSafeRequired: r.kidSafeRequired,
      // A `notes` BELSŐ jegyzet (pl. „két kisgyerek és egy macska") — vásárlónak nem megy ki.
      notes: belso ? r.notes : null,
    }));
    const cimke = code ?? search ?? customerType ?? 'összes';
    return {
      sikeres: true,
      talalatokSzama: ugyfelek.length,
      ugyfelek,
      uzenet: `${ugyfelek.length} ügyfél · ${cimke}`,
      hiba: null,
    };
  } catch (error) {
    const uzenet = error instanceof Error ? error.message : String(error);
    return {
      sikeres: false,
      talalatokSzama: 0,
      ugyfelek: [],
      uzenet: '',
      hiba: `Az ügyfél-lekérdezés nem sikerült: ${uzenet}`,
    };
  }
}

export const ugyfelLekerdezesTool = createTool({
  id: 'ugyfel_lekerdezes',
  description:
    'A bolt ügyfeleinek lekérdezése. Ha a felhasználó a SAJÁT ügyfélkódjára hivatkozik, ezzel ' +
    'kérd le a profilját: keret (budget, Ft), hozzáértés (expertiseLevel: kezdő | haladó | ' +
    'profi) és pet/kid-safe igény. FONTOS: más ügyfelek listázása, illetve név vagy város ' +
    'szerinti keresésük nem engedélyezett — ilyen kérésre a tool hibát ad vissza. Ügyféladat ' +
    'kizárólag PONTOS ügyfélkóddal kérhető le.',
  inputSchema: z.object({
    code: z.string().optional().describe('Pontos ügyfélkód, pl. ACME.'),
    search: z.string().optional().describe('Név- vagy városrészlet kereséshez.'),
    customerType: z
      .string()
      .optional()
      .describe('Szűrés típusra: magánszemély | iroda | étterem | hotel | üzlet.'),
  }),
  outputSchema: KimenetSchema,
  execute: async (bemenet, { mastra, requestContext }) => {
    // A szerep a RENDSZER állítása (RequestContext), nem a beszélgetés tartalma — így a
    // felhasználó nem vallhatja magát adminnak egy jól megfogalmazott mondattal.
    const szerep = olvasSzerep(requestContext);
    const kimenet = await lekerdezUgyfeleket(bemenet, { szerep });
    const logger = mastra?.getLogger();
    if (kimenet.hiba) {
      logger?.warn('ugyfel_lekerdezes — sikertelen', { hiba: kimenet.hiba });
    } else {
      logger?.info('ugyfel_lekerdezes — kiszolgálva', { talalatokSzama: kimenet.talalatokSzama });
    }
    return kimenet;
  },
});
