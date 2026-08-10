import { PostgresStore } from '@mastra/pg';
import type { PgVector } from '@mastra/pg';
import { z } from 'zod';

import { getVektortar } from './rag/vektortar.js';

// tarolas.ts — MI HOL LAKIK. A Mastra két tárolót használ, és nálunk MINDKETTŐ ugyanaz a
// Postgres: a `PostgresStore` a beszélgetés-szálakat, üzeneteket, working memory-t, trace-eket
// és scorer-pontokat tárolja (`mastra_*` táblák, az első futáskor magától létrejönnek), a
// `PgVector` pedig a szemantikus felidézés és a tudásbázis vektorait.
//
// MIÉRT LEHET `undefined`: ha nincs DATABASE_URL, a Mastra tároló nélkül is fut — csak nincs
// mit visszanézni és nincs memória. Ez az egyszeri, lusta-nélküli felépítés szándékos: a
// Mastra példány (index.ts) importáláskor épül fel, tehát a tárolónak is akkor kell megvolnia.

const EnvSchema = z.object({ DATABASE_URL: z.string().min(1) });

const kornyezet = EnvSchema.safeParse(process.env);

/** A Mastra fő tárolója (szálak, üzenetek, working memory, trace, score). */
export const plantbaseTarolo: PostgresStore | undefined = kornyezet.success
  ? new PostgresStore({
      id: 'plantbase-mastra-tarolo',
      connectionString: kornyezet.data.DATABASE_URL,
    })
  : undefined;

/** A vektortár — UGYANAZ a példány, amit a RAG-réteg használ (egy pool, egy pgvector). */
export const plantbaseVektortar: PgVector | undefined = kornyezet.success
  ? getVektortar()
  : undefined;
