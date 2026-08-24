import { PgVector } from '@mastra/pg';
import { z } from 'zod';

// vektortar.ts — a VEKTORTÁR. Nálunk ez nem külön termék: a MEGLÉVŐ Postgres, bekapcsolt
// `pgvector` bővítménnyel. A különbség a régi kézzel írt réteghez képest: a táblát és a
// keresést már nem mi írjuk SQL-ben, hanem a Mastra `PgVector` adaptere.
//
// A Mastra konvenciója: EGY INDEX = EGY TÁBLA, ezekkel az oszlopokkal:
//   tudasbazis(id, vector_id TEXT UNIQUE, embedding vector(1536), metadata JSONB)
// A chunk SZÖVEGE a metadata.text mezőben lakik — a PgVector-nak nincs külön content oszlopa.
//
// A keresés ugyanaz a koszinusz-távolság, mint eddig, csak a Mastra fordítja SQL-re:
// `pgVector.query({ indexName, queryVector, topK })` → találatok `score`-ral (1 = azonos irány).
// FIGYELEM: a régi rétegben TÁVOLSÁG volt (kisebb = jobb), a Mastra HASONLÓSÁGOT ad (nagyobb = jobb).

// ÁTÁLLÁS A RÉGI TÁBLÁRÓL: a `knowledge_chunks` oszlopai NEM egyeznek a Mastra konvenciójával
// (ott `content` oszlop van, itt `metadata.text`), ezért nem lehet ráilleszteni az indexet —
// új tábla kell. A benne lévő 2041 vektort viszont KÁR volt újra beágyazni (pénz és idő):
// ugyanaz a modell, ugyanaz a dimenzió, tehát az embeddingek átmásolhatók — EZ MÁR MEGTÖRTÉNT,
// a `tudasbazis` indexben mind a 2041 chunk bent van. Így nézett ki, ha újra kell játszani:
//
//   -- előbb jöjjön létre a tábla: letrehozTudasbazisIndex() (ezt hívja a feltöltés és a keresés is)
//   INSERT INTO tudasbazis (vector_id, embedding, metadata)
//   SELECT source || '#' || chunk_index,
//          embedding,
//          jsonb_build_object('text', content, 'source', source, 'title', title,
//                             'category', category, 'chunkIndex', chunk_index)
//     FROM knowledge_chunks WHERE embedding IS NOT NULL
//   ON CONFLICT (vector_id) DO NOTHING;
//
// A teljes újraépítés útja ugyanez, csak drágábban: `pnpm knowledge:ingest`.

/** Az index (és egyben a tábla) neve. A régi `knowledge_chunks` táblát ez VÁLTJA KI. */
export const TUDASBAZIS_INDEX = 'tudasbazis';

/** A text-embedding-3-small dimenziószáma. A tábla ekkora vektorokat fogad. */
export const BEAGYAZAS_DIMENZIO = 1536;

const EnvSchema = z.object({ DATABASE_URL: z.string().min(1) });

let vektortar: PgVector | null = null;

/**
 * A közös PgVector-példány (lusta, egyszeri). Ugyanaz a Postgres, mint a katalógusé —
 * a tudásbázis nem külön adatbázis, csak egy másik tábla.
 */
export function getVektortar(): PgVector {
  if (vektortar) {
    return vektortar;
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'Hiányzó DATABASE_URL — a tudásbázis (pgvector) ezen a kapcsolaton érhető el.',
    );
  }
  vektortar = new PgVector({
    id: 'plantbase-tudasbazis',
    connectionString: parsed.data.DATABASE_URL,
  });
  return vektortar;
}

/**
 * Létrehozza az indexet, ha még nincs (idempotens). A pgvector bővítményt és a táblát
 * maga a Mastra hozza létre — nekünk nincs SQL-ünk hozzá.
 */
export async function letrehozTudasbazisIndex(): Promise<void> {
  await getVektortar().createIndex({
    indexName: TUDASBAZIS_INDEX,
    dimension: BEAGYAZAS_DIMENZIO,
    metric: 'cosine',
  });
}

/** Kapcsolat lezárása (szkriptek végén). */
export async function zarVektortar(): Promise<void> {
  if (vektortar) {
    await vektortar.disconnect();
    vektortar = null;
  }
}
