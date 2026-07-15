import { traceLog } from '../trace.js';
import { c } from '../ansi.js';
import { embedText } from './embed.js';
import { hypotheticalAnswer } from './hyde.js';
import { rerankHits, type RerankedHit } from './rerank.js';
import { searchChunks, type KnowledgeHit } from './knowledge-store.js';

// retrieve.ts — A RAG "R"-je: a KERESÉS teljes folyamata, egy helyen, lépésről lépésre.
// Ez a fájl a tananyag térképe is: minden sor egy tanítható lépés, és MINDEGYIK kiírja magát
// a konzolra (traceLog), hogy az órán a chat mellett élőben lássuk, mi történik.
//
//   kérdés
//     └─(1) HyDE: kitalált válasz (opcionális) ─────────► amit valójában keresünk
//           └─(2) embedding: szöveg → 1536 szám
//                 └─(3) pgvector: a K legközelebbi chunk + TÁVOLSÁG
//                       └─(4) rerank: kis modell átrangsorol (opcionális)
//                             └─(5) kontextus: a megmaradt chunkok + FORRÁS → a nagy modellnek

/** Ennyit hozunk be a vektorkeresésből, ha reranking van: tág háló, hogy legyen mit rangsorolni. */
const WIDE_NET = 20;
/** Ennyi chunk megy be végül a modellnek. */
const KEEP_TOP = 5;

export interface RetrieveOptions {
  /** Hipotetikus válasz generálása kereséshez (HyDE). Alap: be. */
  useHyde?: boolean;
  /** Átrangsorolás kis modellel. Alap: be. */
  useRerank?: boolean;
  /** Hány chunk menjen végül a modellnek. */
  topK?: number;
}

export interface RetrieveResult {
  hits: RerankedHit[];
  /** Amit valójában embeddeltünk (a kérdés, vagy a HyDE-válasz) — a demóban ezt is mutatjuk. */
  searchText: string;
}

// ── Színes, olvasható kiírás. Ugyanabba a control-room logba megy, mint a többi trace. ──

function bar(distance: number): string {
  // 0.0 = tökéletes találat, 0.6+ = gyenge. 20 karakteres sáv, hogy szemre is látszódjon.
  const filled = Math.max(0, Math.min(20, Math.round((1 - distance) * 20)));
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

function logHits(label: string, hits: KnowledgeHit[]): void {
  traceLog(c.cyan(label));
  for (const hit of hits) {
    const distance = hit.distance.toFixed(3);
    const score =
      'score' in hit && (hit as RerankedHit).score >= 0
        ? ' ' + c.yellow(`rerank:${(hit as RerankedHit).score}/10`)
        : '';
    traceLog(
      `   ${c.dim(bar(hit.distance))} dist=${c.green(distance)}${score} ` +
        c.bold(hit.title) + ' ' + c.dim(`#${hit.chunkIndex} · ${hit.content.length} kar`),
    );
  }
}

/**
 * A teljes retrieval. A visszaadott chunkok forrással együtt mennek — a válaszban hivatkozni kell rájuk.
 */
export async function retrieveKnowledge(
  question: string,
  options: RetrieveOptions = {},
): Promise<RetrieveResult> {
  const useHyde = options.useHyde ?? true;
  const useRerank = options.useRerank ?? true;
  const topK = options.topK ?? KEEP_TOP;

  traceLog(c.magenta('━━ RAG ━━') + ' kérdés: ' + c.bold(question));

  // (1) HyDE — a kérdés helyett egy kitalált VÁLASZT keresünk (lásd hyde.ts).
  let searchText = question;
  if (useHyde) {
    searchText = await hypotheticalAnswer(question);
    traceLog(
      c.cyan('1) HyDE') +
        ' (gpt-4.1-nano) — ezt keressük a kérdés helyett:\n   ' +
        c.dim(`${searchText.replace(/\s+/g, ' ').slice(0, 220)}…`),
    );
  }

  // (2) Embedding — szöveg → 1536 szám. A kérdést UGYANAZZAL a modellel, mint a dokumentumokat.
  const queryEmbedding = await embedText(searchText);
  const preview = queryEmbedding
    .slice(0, 5)
    .map((n) => n.toFixed(3))
    .join(', ');
  traceLog(
    c.cyan('2) embedding') +
      ` — ${queryEmbedding.length} dimenzió: ` +
      c.dim(`[${preview}, …]`),
  );

  // (3) Vektorkeresés — egy SQL, koszinusz-távolsággal (lásd knowledge-store.ts).
  const wideNet = useRerank ? WIDE_NET : topK;
  const hits = await searchChunks(queryEmbedding, wideNet);
  logHits(
    `3) pgvector — a ${hits.length} legközelebbi chunk (embedding <=> query, kisebb = jobb):`,
    hits,
  );

  if (hits.length === 0) {
    traceLog(c.red('   nincs találat — üres a tudásbázis?'));
    return { hits: [], searchText };
  }

  // (4) Rerank — a kis modell elolvassa és átrangsorolja a tág hálót (lásd rerank.ts).
  if (!useRerank) {
    const asRanked = hits.slice(0, topK).map((hit) => ({ ...hit, score: -1 }));
    return { hits: asRanked, searchText };
  }

  const reranked = await rerankHits(question, hits, topK);
  logHits(
    `4) rerank (claude-haiku-4-5) — a ${topK} legjobb a ${hits.length}-ből, ÚJ sorrendben:`,
    reranked,
  );

  // (5) Ennyi szöveg megy be a nagy modell kontextusába — ez pénz, ezért számoljuk.
  const chars = reranked.reduce((sum, hit) => sum + hit.content.length, 0);
  traceLog(
    c.cyan('5) kontextus') +
      ` — ${reranked.length} chunk, ${chars} karakter (~${Math.round(chars / 4)} token) megy a modellnek`,
  );

  return { hits: reranked, searchText };
}
