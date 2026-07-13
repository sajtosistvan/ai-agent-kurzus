import { Router, type Router as ExpressRouter } from 'express';
import {
  listSources,
  listChunks,
  retrieveKnowledge,
  embedText,
  searchChunks,
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
//   GET  /debug/knowledge/chunks?search=...    — top-K keresés vektortávolsággal (nyers, LLM nélkül)
//   GET  /debug/knowledge/chunks?search=...&pipeline=full — HyDE + rerank is (mint a tool)

export const debugKnowledgeRouter: ExpressRouter = Router();

const DEFAULT_CHUNK_LIMIT = 1000;
const DEFAULT_TOP_K = 5;

/** A dokumentum-azonosító a forrás-URL utolsó szelete (pl. "bug-off-fungus-gnats"). */
function sourceIdOf(source: string): string {
  return source.replace(/\/$/, '').split('/').pop() ?? source;
}

debugKnowledgeRouter.get('/sources', async (_req, res) => {
  try {
    const sources = await listSources();
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
    const sources = await listSources();
    const match = sources.find((s) => sourceIdOf(s.source) === req.params.id);
    if (!match) {
      res.status(404).json({ error: `Nincs ilyen dokumentum: ${req.params.id}` });
      return;
    }

    const chunks = await listChunks({ source: match.source });
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
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : '';
  const full = req.query['pipeline'] === 'full';
  const topK = Number(req.query['topK'] ?? DEFAULT_TOP_K);

  try {
    // Keresés nélkül: minden chunk kiöntése (limit 1000).
    if (search === '') {
      const chunks = await listChunks({ limit: DEFAULT_CHUNK_LIMIT });
      res.json({ count: chunks.length, limit: DEFAULT_CHUNK_LIMIT, chunks });
      return;
    }

    // Keresés + teljes pipeline (HyDE + vektor + rerank) — ugyanaz, amit a tool futtat.
    if (full) {
      const { hits, searchText } = await retrieveKnowledge(search, { topK });
      res.json({
        query: search,
        pipeline: 'HyDE → embedding → pgvector (20) → rerank (gpt-4.1-nano) → top-K',
        hypotheticalAnswer: searchText,
        hits: hits.map((hit) => ({
          title: hit.title,
          source: hit.source,
          distance: Number(hit.distance.toFixed(4)),
          rerankScore: hit.score,
          chars: hit.content.length,
          content: hit.content,
        })),
      });
      return;
    }

    // NYERS vektorkeresés: csak embedding + távolság. Ez a "mit tud a puszta vektor" nézet.
    const queryEmbedding = await embedText(search);
    const hits = await searchChunks(queryEmbedding, topK);
    res.json({
      query: search,
      pipeline: 'embedding → pgvector (nyers vektortávolság, rerank nélkül)',
      embeddingDimensions: queryEmbedding.length,
      embeddingPreview: queryEmbedding.slice(0, 8).map((n) => Number(n.toFixed(4))),
      hits: hits.map((hit) => ({
        title: hit.title,
        source: hit.source,
        distance: Number(hit.distance.toFixed(4)),
        chars: hit.content.length,
        content: hit.content,
      })),
    });
  } catch (error: unknown) {
    res.status(500).json({ error: String(error) });
  }
});
