import { getVektortar, TUDASBAZIS_INDEX } from './vektortar.js';

// tudasbazis-debug.ts — BELESLÉS A RAG DOBOZÁBA. Ezek a lekérdezések nem a terméknek szólnak,
// hanem az órának: milyen dokumentumok vannak bent, hány darabban, mi van egy darabban.
//
// A Mastra `PgVector` indexe egy sima Postgres-tábla (vector_id, embedding, metadata JSONB),
// ezért ide elég a nyers SQL — ez a réteg szándékosan a tár BELSEJÉT mutatja.
// A `PgVector` a saját `pool`-ját közzéteszi, így nem nyitunk MÁSODIK kapcsolatot.

export interface TudasForras {
  source: string;
  title: string;
  category: string;
  chunkCount: number;
  totalChars: number;
}

export interface TudasDarabSor {
  id: string;
  source: string;
  title: string;
  category: string;
  chunkIndex: number;
  content: string;
  chars: number;
}

const ALAP_LIMIT = 1000;

/** Milyen dokumentumok vannak a tudásbázisban, hány darabban. */
export async function listazForrasokat(): Promise<TudasForras[]> {
  const eredmeny = await getVektortar().pool.query(
    `SELECT metadata->>'source'   AS source,
            MIN(metadata->>'title')    AS title,
            MIN(metadata->>'category') AS category,
            COUNT(*)::int              AS chunk_count,
            SUM(LENGTH(metadata->>'text'))::int AS total_chars
       FROM ${TUDASBAZIS_INDEX}
      GROUP BY metadata->>'source'
      ORDER BY MIN(metadata->>'title')`,
  );
  return eredmeny.rows.map((sor) => ({
    source: (sor.source as string) ?? '',
    title: (sor.title as string) ?? '',
    category: (sor.category as string) ?? '',
    chunkCount: sor.chunk_count as number,
    totalChars: (sor.total_chars as number) ?? 0,
  }));
}

/** A chunkok kiöntése (opcionálisan egy dokumentumra szűrve). */
export async function listazDarabokat(
  opciok: { source?: string; limit?: number } = {},
): Promise<TudasDarabSor[]> {
  const limit = opciok.limit ?? ALAP_LIMIT;
  const szurt = opciok.source !== undefined;
  const eredmeny = await getVektortar().pool.query(
    `SELECT vector_id,
            metadata->>'source'     AS source,
            metadata->>'title'      AS title,
            metadata->>'category'   AS category,
            metadata->>'chunkIndex' AS chunk_index,
            metadata->>'text'       AS content
       FROM ${TUDASBAZIS_INDEX}
      ${szurt ? "WHERE metadata->>'source' = $1" : ''}
      ORDER BY metadata->>'title', (metadata->>'chunkIndex')::int
      LIMIT ${szurt ? '$2' : '$1'}`,
    szurt ? [opciok.source, limit] : [limit],
  );
  return eredmeny.rows.map((sor) => ({
    id: sor.vector_id as string,
    source: (sor.source as string) ?? '',
    title: (sor.title as string) ?? '',
    category: (sor.category as string) ?? '',
    chunkIndex: Number(sor.chunk_index ?? 0),
    content: (sor.content as string) ?? '',
    chars: ((sor.content as string) ?? '').length,
  }));
}
