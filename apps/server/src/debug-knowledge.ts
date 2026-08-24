import { Router, type Router as ExpressRouter } from 'express';
import {
  atrangsorol,
  beagyazSzoveget,
  getVektortar,
  hipotetikusValasz,
  listazDarabokat,
  listazForrasokat,
  TUDASBAZIS_INDEX,
} from '@plantbase/core';

// debug-knowledge.ts — BELESLÉS A RAG DOBOZÁBA. Ezek a végpontok nem a terméknek szólnak,
// hanem NEKÜNK: szétszedik a RAG-ot a két felére, hogy külön lehessen hibázni bennük.
//
//   RETRIEVAL (keresés)  ← ezek a végpontok ezt mutatják, LLM nélkül
//   GENERÁLÁS (válasz)   ← ez a /api/chat
//
// Ha rossz a válasz, ELŐSZÖR ide nézz: ha a keresés nem hozta be a jó chunkot, hiába okos a
// modell. A RAG-hibák többsége retrieval-hiba (rossz chunkolás, rossz kérdés-megfogalmazás),
// nem generálás-hiba.
//
//   GET  /debug/knowledge/sources              — milyen dokumentumok vannak, hány darabban
//   GET  /debug/knowledge/sources/:id          — EGY dokumentum, a chunkjaival, teljes szöveggel
//   GET  /debug/knowledge/chunks               — minden chunk (limit 1000)
//   GET  /debug/knowledge/chunks?search=...    — top-K keresés nyers vektor-hasonlósággal
//   GET  /debug/knowledge/chunks?search=...&pipeline=full — HyDE + rerank is (mint a tool)
//
// A tudásbázis a Mastra `PgVector` indexében él (`tudasbazis` tábla), ezért ez a réteg is
// azon keresztül olvas — ugyanazokat a lépéseket rakja össze, mint a `tudasbazis_kereses` tool.

export const debugKnowledgeRouter: ExpressRouter = Router();

const DEFAULT_CHUNK_LIMIT = 1000;
const DEFAULT_TOP_K = 5;
/** A tág háló mérete a teljes pipeline-ban — a tool is ennyivel dolgozik. */
const TAG_HALO = 20;

/** A dokumentum-azonosító a forrás-URL utolsó szelete (pl. "bug-off-fungus-gnats"). */
function sourceIdOf(source: string): string {
  return source.replace(/\/$/, '').split('/').pop() ?? source;
}

/** Egy vektortalálat lapos, olvasható alakja a debug-JSON-hoz. */
function talalatSora(hit: {
  score: number;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const meta = hit.metadata ?? {};
  const content = String(meta['text'] ?? '');
  return {
    title: meta['title'] ?? '',
    source: meta['source'] ?? '',
    score: Number(hit.score.toFixed(4)),
    chars: content.length,
    content,
  };
}

debugKnowledgeRouter.get('/sources', async (_req, res) => {
  try {
    const sources = await listazForrasokat();
    res.json({
      count: sources.length,
      totalChunks: sources.reduce((sum, s) => sum + s.chunkCount, 0),
      sources: sources.map((s) => ({
        id: sourceIdOf(s.source),
        title: s.title,
        category: s.category,
        url: s.source,
        chunks: s.chunkCount,
        chars: s.totalChars,
      })),
    });
  } catch (error: unknown) {
    res.status(500).json({ error: String(error) });
  }
});

debugKnowledgeRouter.get('/sources/:id', async (req, res) => {
  try {
    const sources = await listazForrasokat();
    const match = sources.find((s) => sourceIdOf(s.source) === req.params.id);
    if (!match) {
      res
        .status(404)
        .json({ error: `Nincs ilyen dokumentum: ${req.params.id}` });
      return;
    }

    const chunks = await listazDarabokat({ source: match.source });
    res.json({
      id: req.params.id,
      title: match.title,
      category: match.category,
      url: match.source,
      chunkCount: chunks.length,
      // A teljes dokumentum, ahogy a darabok összeállnak — így LÁTSZIK, hol vágtunk.
      fullText: chunks.map((c) => c.content).join('\n\n'),
      chunks: chunks.map((c) => ({
        id: c.id,
        index: c.chunkIndex,
        chars: c.chars,
        content: c.content,
      })),
    });
  } catch (error: unknown) {
    res.status(500).json({ error: String(error) });
  }
});

debugKnowledgeRouter.get('/chunks', async (req, res) => {
  const search =
    typeof req.query['search'] === 'string' ? req.query['search'] : '';
  const full = req.query['pipeline'] === 'full';
  const topK = Number(req.query['topK'] ?? DEFAULT_TOP_K);

  try {
    // Keresés nélkül: minden chunk kiöntése (limit 1000).
    if (search === '') {
      const chunks = await listazDarabokat({ limit: DEFAULT_CHUNK_LIMIT });
      res.json({ count: chunks.length, limit: DEFAULT_CHUNK_LIMIT, chunks });
      return;
    }

    // Keresés + teljes pipeline (HyDE + vektor + rerank) — ugyanaz, amit a tool futtat.
    if (full) {
      const keresettSzoveg = await hipotetikusValasz(search);
      const nyers = await getVektortar().query({
        indexName: TUDASBAZIS_INDEX,
        queryVector: await beagyazSzoveget(keresettSzoveg),
        topK: TAG_HALO,
      });
      const rangsorolt = await atrangsorol(search, nyers, topK);
      res.json({
        query: search,
        pipeline: 'HyDE → embedding → pgvector (20) → rerank → top-K',
        hypotheticalAnswer: keresettSzoveg,
        hits: rangsorolt.map((sor) => ({
          ...talalatSora(sor.result),
          rerankScore: sor.score,
        })),
      });
      return;
    }

    // NYERS vektorkeresés: csak embedding + hasonlóság. Ez a „mit tud a puszta vektor" nézet.
    const queryEmbedding = await beagyazSzoveget(search);
    const hits = await getVektortar().query({
      indexName: TUDASBAZIS_INDEX,
      queryVector: queryEmbedding,
      topK,
    });
    res.json({
      query: search,
      pipeline: 'embedding → pgvector (nyers hasonlóság, rerank nélkül)',
      embeddingDimensions: queryEmbedding.length,
      embeddingPreview: queryEmbedding
        .slice(0, 8)
        .map((n) => Number(n.toFixed(4))),
      hits: hits.map((hit) => talalatSora(hit)),
    });
  } catch (error: unknown) {
    res.status(500).json({ error: String(error) });
  }
});
