import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { embedBatch, loadConfig, retrieveKnowledge } from '@plantbase/core';
import { coerceArray, parseJsonLoose } from './lib/json-loose.js';

// rag-eval.ts — RAGAS-stílusú RAG-kiértékelés, in-repo, TS-ben, LÁTHATÓ számítással.
// Nem a böngésző-battery: ez közvetlenül a pipeline-t hajtja, mert a metrikákhoz látni kell a
// VISSZAKAPOTT chunkokat, nem elég a végső válasz.
//
//   kérdés → retrieveKnowledge (a termék retrievere) → chunkok(+táv) → válasz a kontextusból
//          → 4 metrika: faithfulness · answer relevancy · context precision · context recall
//
// Hibrid ítélő: embedding (cosine) az answer relevancy-hez (determinisztikus, látható), és a
// chunk↔kérdés hasonlóságot MINDIG kiírjuk; a nehezebb relevancia-/fedés-/hűség-döntést viszont
// LLM-judge hozza (kiírt indoklással) — mert egy fix cosine-küszöb a rövid kérdés + HyDE rezsimben
// megbízhatatlan (ezt a kiírt sim-értékek meg is mutatják). Futtatás:
//   pnpm tsx --conditions=@plantbase/source --env-file=.env .claude/skills/autotest/scripts/rag-eval.ts

const TOP_K = 5;

interface EvalCase {
  id: string;
  question: string;
  /** Kurált referencia-válasz — a context recall-hoz (mit KELLETT volna előhozni). */
  groundTruth: string;
}

// A korpusz gondozási cikkek (ask-the-sill, plants-101). A kérdések ezt célozzák.
// A RAG-esetek KÜLÖN JSON-ban élnek (jól bemutatható): rag-cases.json.
const CASES: EvalCase[] = (
  JSON.parse(readFileSync('.claude/skills/autotest/rag-cases.json', 'utf8')) as { cases: EvalCase[] }
).cases;

const cfg = loadConfig();
const model = createAnthropic({ apiKey: cfg.apiKey })(cfg.model);

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Mondatokra bontás — a claim-szintű metrikákhoz. Md-markerek le, sor- ÉS mondat-határon. */
function splitSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // kódblokk ki
    .split(/\n+|(?<=[.!?])\s+/) // sor- ÉS mondat-határ
    .map((s) => s.replace(/^[#>\-*\d.\s]+/, '').trim()) // vezető md-markerek le
    .filter((s) => s.length > 15);
}

// Token-számláló: minden LLM-hívás usage-ét ide gyűjtjük (per eset resetelve).
let usageTokens = 0;
function addUsage(usage: { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined): void {
  if (!usage) return;
  usageTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** generateText a token-usage begyűjtésével (latency + cost metrikákhoz). Bőséges output-budget,
 *  hogy a hosszú judge-JSON ne vágódjon le (a levágás okozott ritka parse-hibát). */
async function genText(prompt: string): Promise<string> {
  const { text, usage } = await generateText({ model, prompt, maxOutputTokens: 3000 });
  addUsage(usage);
  return text;
}


/** LLM-hívás, ami szigorú JSON-t vár — zod nélkül, robusztus parse-szal. */
async function askJson<T>(prompt: string): Promise<T | null> {
  const text = await genText(prompt);
  return (parseJsonLoose(text) as T) ?? null;
}


/** A kiértékelendő „rendszer-válasz": kizárólag a visszakapott kontextusból, magyarul. */
async function answerFromContext(question: string, contexts: string[]): Promise<string> {
  const text = await genText(
    'Válaszolj a kérdésre KIZÁRÓLAG az alábbi forrás-részletek alapján, magyarul, tömören. ' +
      'Ha a források nem fedik a kérdést, mondd ki, hogy erről nincs információ.\n\n' +
      `Kérdés: ${question}\n\nForrások:\n${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`,
  );
  return text.trim();
}

interface ChunkEval {
  title: string;
  distance: number;
  /** Kérdés↔chunk koszinusz (megjelenítve — mutatja, miért nem elég egy fix küszöb). */
  sim: number;
  relevant: boolean;
  reason: string;
  content: string;
}
interface ClaimEval {
  claim: string;
  supported: boolean;
  reason: string;
}
interface RecallEval {
  claim: string;
  covered: boolean;
  reason: string;
}
interface CaseResult {
  id: string;
  question: string;
  groundTruth: string;
  answer: string;
  chunks: ChunkEval[];
  metrics: {
    contextPrecision: number;
    contextRecall: number;
    faithfulness: number;
    answerRelevancy: number;
    /** Válasz ↔ ground truth szemantikai egyezés (embedding cosine). */
    answerCorrectness: number;
    /** Mennyire ront a válaszon, ha irreleváns chunkot injektálunk (0 = robusztus, 1 = érzékeny). */
    noiseSensitivity: number;
  };
  faithClaims: ClaimEval[];
  recallClaims: RecallEval[];
  generatedQuestions: { q: string; sim: number }[];
  /** Operatív: teljes latency (ms) és LLM-token az eset kiértékeléséhez. */
  latencyMs: number;
  tokens: number;
  /** Noise sensitivity részlet: a zajos válasz + állítás-szintű alátámasztottság a valódi forrásból. */
  noise: { answer: string; supported: number; total: number; claims: ClaimEval[] };
}

// Noise sensitivity: szándékosan IRRELEVÁNS „chunkok", amiket a valódi kontextus közé keverünk.
// Ha ezektől a válasz hallucinálni kezd (a valódi forrás nem támasztja alá), akkor zaj-érzékeny.
const DISTRACTORS = [
  'A dízelmotor nyomatéka alacsony fordulaton is magas, ezért vontatásra alkalmas. A turbófeltöltő növeli a teljesítményt.',
  'A tökéletes carbonara alapja a tojássárgája, a pecorino sajt és a guanciale; tejszín semmiképp nem kerül bele.',
];

// ── Metrikák ────────────────────────────────────────────────────────────────

/** Context precision (rank-aware): a releváns chunkok elöl vannak-e a top-K-ban. */
function contextPrecisionScore(relevantFlags: boolean[]): number {
  let hits = 0;
  let sum = 0;
  relevantFlags.forEach((rel, i) => {
    if (rel) {
      hits++;
      sum += hits / (i + 1); // precision@(i+1)
    }
  });
  return hits ? sum / hits : 0;
}

/** LLM-judge: releváns-e minden visszakapott chunk a kérdéshez (context precision alapja). */
async function judgeChunkRelevance(
  question: string,
  contexts: string[],
): Promise<{ relevant: boolean; reason: string }[]> {
  const raw = await askJson<unknown>(
    'Döntsd el minden FORRÁS-részletről, hogy releváns-e (hasznos-e) az adott KÉRDÉS ' +
      'megválaszolásához. Szigorú JSON tömb, a forrásokkal azonos sorrendben: ' +
      '[{"relevant": true, "reason": "rövid magyar indok"}].\n\n' +
      `KÉRDÉS: ${question}\n\nFORRÁSOK:\n${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`,
  );
  const result = coerceArray<{ relevant: boolean; reason: string }>(raw);
  return contexts.map((_, i) => ({
    relevant: Boolean(result[i]?.relevant),
    reason: result[i]?.reason ?? '—',
  }));
}

/** LLM-judge: a referencia-válasz állításait megtalálni-e a visszakapott chunkokban (recall). */
async function judgeRecall(refClaims: string[], contexts: string[]): Promise<RecallEval[]> {
  const raw = await askJson<unknown>(
    'Döntsd el minden ELVÁRT ÁLLÍTÁSRÓL, hogy megtalálható-e (alátámasztható-e) a FORRÁSOKBAN. ' +
      'Szigorú JSON tömb, az állításokkal azonos sorrendben: ' +
      '[{"covered": true, "reason": "rövid magyar indok"}].\n\n' +
      `FORRÁSOK:\n${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n\n` +
      `ELVÁRT ÁLLÍTÁSOK:\n${refClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  );
  const result = coerceArray<{ covered: boolean; reason: string }>(raw);
  return refClaims.map((claim, i) => ({
    claim,
    covered: Boolean(result[i]?.covered),
    reason: result[i]?.reason ?? '—',
  }));
}

/** Faithfulness (LLM-judge): a válasz minden állítását alátámasztja-e a kontextus. */
async function faithfulness(answer: string, contexts: string[]): Promise<ClaimEval[]> {
  const claims = splitSentences(answer).slice(0, 6);
  if (claims.length === 0) return [];
  const raw = await askJson<unknown>(
    'Egy RAG-válasz állításait kell ellenőrizned a FORRÁSOK alapján. Minden állításról döntsd el, ' +
      'hogy a források ALÁTÁMASZTJÁK-e (supported: true), vagy nem/ellentmond (false). ' +
      'Csak a forrásokra támaszkodj, ne a saját tudásodra. Szigorú JSON tömb, az állításokkal ' +
      'azonos sorrendben: [{"supported": true, "reason": "rövid magyar indok"}].\n\n' +
      `FORRÁSOK:\n${contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n\n` +
      `ÁLLÍTÁSOK:\n${claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  );
  const result = coerceArray<{ supported: boolean; reason: string }>(raw);
  return claims.map((claim, i) => ({
    claim,
    supported: Boolean(result[i]?.supported),
    reason: result[i]?.reason ?? '—',
  }));
}

/** Answer relevancy (embedding): a válaszból visszagenerált kérdések hasonlósága az eredetihez. */
async function answerRelevancy(
  answer: string,
  qEmb: number[],
): Promise<{ q: string; sim: number }[]> {
  const gen = await askJson<{ questions: string[] }>(
    'Az alábbi VÁLASZ alapján fogalmazz meg 2 kérdést, amelyekre ez a válasz pontosan felelne, magyarul. ' +
      'Szigorú JSON: {"questions": ["...", "..."]}.\n\n' +
      `VÁLASZ:\n${answer}`,
  );
  const qs = gen?.questions?.slice(0, 2) ?? [];
  if (qs.length === 0) return [];
  const embs = await embedBatch(qs);
  return qs.map((q, i) => ({ q, sim: cosineSim(qEmb, embs[i]!) }));
}

/** Answer correctness (embedding): a válasz szemantikai egyezése a referencia-válasszal. */
async function answerCorrectness(answer: string, groundTruth: string): Promise<number> {
  const [aEmb, gEmb] = await embedBatch([answer, groundTruth]);
  return cosineSim(aEmb!, gEmb!);
}

/**
 * Noise sensitivity: a valódi kontextus közé IRRELEVÁNS chunkokat keverünk, újragenerálunk, majd
 * a zajos választ a VALÓDI források ellen ellenőrizzük. Ha állításai már nem támaszthatók alá,
 * a modell hagyta magát félrevinni. sensitivity = nem-alátámasztott / összes állítás (0 = robusztus).
 */
async function noiseSensitivity(
  question: string,
  cleanContexts: string[],
): Promise<{ answer: string; supported: number; total: number; score: number; claims: ClaimEval[] }> {
  const noisy = [...cleanContexts, ...DISTRACTORS];
  const noisyAnswer = await answerFromContext(question, noisy);
  const claims = await faithfulness(noisyAnswer, cleanContexts); // a VALÓDI források ellen
  const total = claims.length;
  const supported = claims.filter((c) => c.supported).length;
  const score = total ? (total - supported) / total : 0;
  return { answer: noisyAnswer, supported, total, score, claims };
}

type Hit = { content: string; title: string; distance: number };

async function evalCase(c: EvalCase): Promise<CaseResult> {
  usageTokens = 0;
  const t0 = Date.now();

  const { hits } = (await retrieveKnowledge(c.question, { topK: TOP_K })) as { hits: Hit[] };
  const contexts = hits.map((h) => h.content);
  const refClaims = splitSentences(c.groundTruth);

  // Embeddingek egyben: kérdés + chunkok (a megjelenített sim-hez).
  const [qEmb, ...chunkEmbs] = await embedBatch([c.question, ...contexts]);

  const answer = await answerFromContext(c.question, contexts);

  // A metrikák párhuzamosan (retrieval már megvan).
  const [relevance, recallClaims, faithClaims, generatedQuestions, correctness, noise] =
    await Promise.all([
      judgeChunkRelevance(c.question, contexts),
      judgeRecall(refClaims, contexts),
      faithfulness(answer, contexts),
      answerRelevancy(answer, qEmb!),
      answerCorrectness(answer, c.groundTruth),
      noiseSensitivity(c.question, contexts),
    ]);

  const chunks: ChunkEval[] = hits.map((h, i) => ({
    title: h.title,
    distance: h.distance,
    sim: cosineSim(qEmb!, chunkEmbs[i]!),
    relevant: relevance[i]!.relevant,
    reason: relevance[i]!.reason,
    content: h.content,
  }));

  const metrics = {
    contextPrecision: contextPrecisionScore(chunks.map((ch) => ch.relevant)),
    contextRecall: recallClaims.length ? recallClaims.filter((r) => r.covered).length / recallClaims.length : 0,
    faithfulness: faithClaims.length ? faithClaims.filter((f) => f.supported).length / faithClaims.length : 0,
    answerRelevancy: generatedQuestions.length
      ? generatedQuestions.reduce((s, g) => s + g.sim, 0) / generatedQuestions.length
      : 0,
    answerCorrectness: correctness,
    noiseSensitivity: noise.score,
  };

  return {
    id: c.id, question: c.question, groundTruth: c.groundTruth, answer, chunks, metrics,
    faithClaims, recallClaims, generatedQuestions,
    latencyMs: Date.now() - t0, tokens: usageTokens,
    noise: { answer: noise.answer, supported: noise.supported, total: noise.total, claims: noise.claims },
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--dump-cases')) {
    process.stdout.write(JSON.stringify({ cases: CASES }, null, 2) + '\n');
    return;
  }
  const results: CaseResult[] = [];
  for (const c of CASES) {
    console.log(`\n[RAG] ${c.id} — ${c.question}`);
    const r = await evalCase(c);
    results.push(r);
    const m = r.metrics;
    console.log(
      `  faith=${m.faithfulness.toFixed(2)} relev=${m.answerRelevancy.toFixed(2)} ` +
        `ctx-prec=${m.contextPrecision.toFixed(2)} ctx-rec=${m.contextRecall.toFixed(2)} ` +
        `correct=${m.answerCorrectness.toFixed(2)} noise=${m.noiseSensitivity.toFixed(2)} ` +
        `| ${(r.latencyMs / 1000).toFixed(1)}s ${r.tokens} tok`,
    );
  }

  const avg = (sel: (r: CaseResult) => number): number =>
    results.reduce((s, r) => s + sel(r), 0) / results.length;
  const aggregate = {
    faithfulness: avg((r) => r.metrics.faithfulness),
    answerRelevancy: avg((r) => r.metrics.answerRelevancy),
    contextPrecision: avg((r) => r.metrics.contextPrecision),
    contextRecall: avg((r) => r.metrics.contextRecall),
    answerCorrectness: avg((r) => r.metrics.answerCorrectness),
    noiseSensitivity: avg((r) => r.metrics.noiseSensitivity),
  };
  const ops = {
    avgLatencyMs: Math.round(avg((r) => r.latencyMs)),
    avgTokens: Math.round(avg((r) => r.tokens)),
    totalTokens: results.reduce((s, r) => s + r.tokens, 0),
  };

  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('logs/flow-test', `${stamp}-rag-eval.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { meta: { generatedAt: new Date().toISOString(), topK: TOP_K, cases: results.length, ...ops }, aggregate, results },
      null,
      2,
    ),
  );
  console.log(`\n📦 RAG-eval JSON: ${file}`);
  console.log(
    `Átlag — faith=${aggregate.faithfulness.toFixed(2)} relev=${aggregate.answerRelevancy.toFixed(2)} ` +
      `ctx-prec=${aggregate.contextPrecision.toFixed(2)} ctx-rec=${aggregate.contextRecall.toFixed(2)} ` +
      `correct=${aggregate.answerCorrectness.toFixed(2)} noise=${aggregate.noiseSensitivity.toFixed(2)} ` +
      `| ${(ops.avgLatencyMs / 1000).toFixed(1)}s ${ops.avgTokens} tok/eset`,
  );
}

main().catch((error) => {
  console.error(`rag-eval hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
