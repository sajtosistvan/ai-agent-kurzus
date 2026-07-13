import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  chunkMarkdown,
  embedBatch,
  insertChunks,
  clearKnowledge,
  closeKnowledgePool,
  type KnowledgeChunkInput,
} from '@plantbase/core';

// ingest-knowledge.ts — A TUDÁSBÁZIS FELÉPÍTÉSE. Futtatás: `pnpm knowledge:ingest`
//
// A teljes pipeline, négy lépésben — pontosan az, amit egy RAG-rendszer üzemeltetése jelent:
//   1. BEOLVAS   — seed/knowledge/*.md (letöltött gondozási cikkek, forrás-URL a fejlécben)
//   2. DARABOL   — chunkMarkdown: bekezdés-határon, ~1000 karakter, átfedéssel
//   3. VEKTORIZÁL— embedBatch: minden darab → 1536 szám (OpenAI, kötegelten)
//   4. BEÍR      — knowledge_chunks tábla (pgvector)
//
// FRISSÍTÉS: a tudásbázis nem statikus. A bolt holnap ír egy új cikket, átírja a régit —
// ettől a te vektoraid még a tegnapi igazságot mondják. A legegyszerűbb stratégia (és amit itt
// használunk): teljes újraépítés (TRUNCATE + újratöltés). Kis korpusznál ez a helyes válasz.
// Nagynál inkrementális kell (mi változott? mit töröltek?) — ez a "tudásbázis-gondozás" költsége.

const KNOWLEDGE_DIR = join(process.cwd(), 'seed', 'knowledge');
const EMBED_BATCH_SIZE = 100; // ennyi darabot embeddelünk egy API-hívásban

interface Document {
  source: string;
  title: string;
  category: string;
  body: string;
}

/** A markdown fejléc (front matter) kiolvasása: innen jön a forrás-URL és a cím. */
function parseDocument(markdown: string, fallbackTitle: string): Document {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return {
      source: '',
      title: fallbackTitle,
      category: 'egyéb',
      body: markdown,
    };
  }

  const [, frontMatter, body] = match;
  const field = (name: string): string =>
    frontMatter?.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';

  return {
    source: field('source'),
    title: field('title') || fallbackTitle,
    category: field('category') || 'egyéb',
    body: body ?? '',
  };
}

async function main(): Promise<void> {
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  console.log(`1) BEOLVASÁS — ${files.length} dokumentum a seed/knowledge mappából`);

  // 1-2. Beolvasás + darabolás.
  const pending: Omit<KnowledgeChunkInput, 'embedding'>[] = [];
  for (const file of files) {
    const raw = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8');
    const doc = parseDocument(raw, file.replace('.md', ''));
    for (const chunk of chunkMarkdown(doc.body)) {
      pending.push({
        source: doc.source,
        title: doc.title,
        category: doc.category,
        chunkIndex: chunk.index,
        content: chunk.content,
      });
    }
  }

  const avgChars = Math.round(
    pending.reduce((sum, c) => sum + c.content.length, 0) / pending.length,
  );
  console.log(
    `2) DARABOLÁS — ${pending.length} chunk (átlag ${avgChars} karakter, ~${Math.round(avgChars / 4)} token)`,
  );

  // 3-4. Vektorizálás kötegelten + beírás. Előtte ürítünk (teljes újraépítés).
  await clearKnowledge();
  console.log(`3) VEKTORIZÁLÁS — ${EMBED_BATCH_SIZE}-as kötegekben (OpenAI text-embedding-3-small)`);

  let written = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((c) => c.content));
    const rows: KnowledgeChunkInput[] = batch.map((chunk, j) => ({
      ...chunk,
      embedding: embeddings[j] as number[],
    }));
    written += await insertChunks(rows);
    process.stdout.write(`   ${written}/${pending.length} chunk vektorizálva\r`);
  }

  console.log(`\n4) KÉSZ — ${written} chunk a knowledge_chunks táblában.`);
  console.log('   Nézd meg: GET http://localhost:3000/debug/knowledge/sources');
  await closeKnowledgePool();
}

main().catch(async (error: unknown) => {
  console.error('Ingest hiba:', error instanceof Error ? error.message : error);
  await closeKnowledgePool();
  process.exit(1);
});
