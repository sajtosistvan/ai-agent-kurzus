import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { platform } from 'node:process';

// rag-report-html.ts — a rag-eval.json-ból ÖNÁLLÓ, self-contained „fancy" HTML-riport. Ez a
// KÜLÖN riport-verzió a RAG-metrikákkal (a battery-riporttól elkülönítve). RAGAS-stílus:
// faithfulness · answer relevancy · context precision · context recall — per kérdés + aggregát,
// állítás-szintű indoklással. Használat:
//   pnpm tsx rag-report-html.ts <rag-eval.json> [out.html] [--no-open]

interface ChunkEval {
  title: string;
  distance: number;
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
interface Metrics {
  contextPrecision: number;
  contextRecall: number;
  faithfulness: number;
  answerRelevancy: number;
  answerCorrectness: number;
  noiseSensitivity: number;
}
interface CaseResult {
  id: string;
  question: string;
  groundTruth: string;
  answer: string;
  chunks: ChunkEval[];
  metrics: Metrics;
  faithClaims: ClaimEval[];
  recallClaims: RecallEval[];
  generatedQuestions: { q: string; sim: number }[];
  latencyMs: number;
  tokens: number;
  noise: { answer: string; supported: number; total: number; claims: ClaimEval[] };
}
interface RagData {
  meta: { generatedAt: string; topK: number; cases: number; avgLatencyMs?: number; avgTokens?: number; totalTokens?: number };
  aggregate: Metrics;
  results: CaseResult[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markdown: **félkövér**, *dőlt*, `kód` — a szöveg már escape-elt. */
function mdInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

/** Mini markdown → HTML: címsorok, listák, félkövér. Self-contained (nincs külső lib). */
function md(src: string): string {
  const lines = esc(src).split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  const close = (): void => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
    if (inOl) {
      html += '</ol>';
      inOl = false;
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      close();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(#{1,4})\s+(.*)/))) {
      close();
      const lvl = Math.min(6, m[1]!.length + 2);
      html += `<h${lvl}>${mdInline(m[2]!)}</h${lvl}>`;
    } else if ((m = t.match(/^[-*]\s+(.*)/))) {
      if (inOl) close();
      if (!inUl) {
        html += '<ul>';
        inUl = true;
      }
      html += `<li>${mdInline(m[1]!)}</li>`;
    } else if ((m = t.match(/^\d+\.\s+(.*)/))) {
      if (inUl) close();
      if (!inOl) {
        html += '<ol>';
        inOl = true;
      }
      html += `<li>${mdInline(m[1]!)}</li>`;
    } else {
      close();
      html += `<p>${mdInline(t)}</p>`;
    }
  }
  close();
  return html || '<em>üres</em>';
}
function pct(v: number): number {
  return Math.round(v * 100);
}
/** invert=true: a kisebb érték a jobb (noise sensitivity) — a színt eszerint fordítjuk. */
function band(v: number, invert = false): 'hi' | 'mid' | 'lo' {
  const g = invert ? 1 - v : v;
  return g >= 0.8 ? 'hi' : g >= 0.5 ? 'mid' : 'lo';
}

interface MetricDef {
  key: keyof Metrics;
  label: string;
  hint: string;
  invert?: boolean;
  /** Bővebb, közérthető definíció a legendához: mit mér, hogyan, mi a jó érték. */
  what: string;
  how: string;
  good: string;
}
const METRIC_LABELS: MetricDef[] = [
  {
    key: 'faithfulness',
    label: 'Faithfulness',
    hint: 'megbízhatóság: a válasz állításai a forrásból jönnek-e (nem hallucinál)',
    what: 'A válasz mennyire hű a visszakapott forrásokhoz — minden állítása alá van-e támasztva a chunkokkal, vagy „kitalál" dolgokat.',
    how: 'A választ állításokra bontjuk, és egy LLM-bíró minden állításról eldönti, alátámasztja-e a kontextus. Pontszám = alátámasztott / összes állítás.',
    good: 'MAGAS a jó (1.0 = semmit nem hallucinál). Alacsony érték = a modell a forráson túl beszél.',
  },
  {
    key: 'answerRelevancy',
    label: 'Answer relevancy',
    hint: 'relevancia: a válasz tényleg a feltett kérdésre felel-e',
    what: 'A válasz mennyire szól a feltett kérdésről — nem tér-e el, nem kerülgeti-e a lényeget.',
    how: 'A válaszból visszagenerálunk néhány kérdést, embeddeljük őket, és megnézzük, mennyire hasonlítanak (koszinusz) az eredeti kérdéshez. Átlaguk a pontszám.',
    good: 'MAGAS a jó. Alacsony = a válasz elkalandozik vagy csak részben felel a kérdésre.',
  },
  {
    key: 'answerCorrectness',
    label: 'Answer correctness',
    hint: 'helyesség: a válasz mennyire egyezik a referencia-válasszal',
    what: 'A válasz tartalmi egyezése a kézzel megadott „helyes" (referencia) válasszal.',
    how: 'A válasz és a referencia-válasz embeddingjének koszinusz-hasonlósága.',
    good: 'MAGAS a jó. Alacsony = a válasz eltér attól, amit elvártunk (más tartalom/hangsúly).',
  },
  {
    key: 'contextPrecision',
    label: 'Context precision',
    hint: 'a retriever pontossága: a top-K chunk tényleg releváns-e, és elöl vannak-e a jók',
    what: 'A VISSZAKAPOTT chunkok mennyire relevánsak a kérdéshez, és a relevánsak elöl vannak-e a rangsorban.',
    how: 'Egy LLM-bíró minden chunkról eldönti, releváns-e; a pontszám rang-érzékeny (a lista elején lévő találatok többet érnek).',
    good: 'MAGAS a jó. Alacsony = a retriever irreleváns/zajos chunkokat hoz elő (rossz keresés).',
  },
  {
    key: 'contextRecall',
    label: 'Context recall',
    hint: 'a retriever teljessége: a válaszhoz KELLŐ tények bekerültek-e a chunkokba',
    what: 'A helyes válaszhoz szükséges információ mekkora részét hozta elő egyáltalán a keresés.',
    how: 'A referencia-válasz állításaira bontva, egy LLM-bíró eldönti, mindegyik megtalálható-e a visszakapott chunkokban. Pontszám = lefedett / összes.',
    good: 'MAGAS a jó. Alacsony = a keresés kihagyott lényeges forrás-részeket (a korpusz vagy a retriever hiánya).',
  },
  {
    key: 'noiseSensitivity',
    label: 'Noise sensitivity',
    hint: 'zaj-érzékenység: irreleváns chunktól elkezd-e hallucinálni (KEVESEBB a jobb)',
    invert: true,
    what: 'Mennyire téríti el a modellt, ha a jó források közé irreleváns („zajos") chunk keveredik.',
    how: 'A valódi chunkok közé szándékosan irreleváns részleteket keverünk, újrageneráljuk a választ, majd a VALÓDI forrás ellen ellenőrizzük — hány állítás vált alátámasztatlanná.',
    good: 'ALACSONY a jó (0% = a modell figyelmen kívül hagyta a zajt, robusztus). Magas = a zaj hamis állításokat csal a válaszba.',
  },
];

function bar(v: number, invert = false): string {
  return `<div class="bar"><div class="fill ${band(v, invert)}" style="width:${pct(v)}%"></div><span class="barval">${pct(v)}%</span></div>`;
}

function metricCard(m: Metrics, key: keyof Metrics, label: string, hint: string, invert = false): string {
  return `<div class="mcard"><div class="mlabel">${label}</div>${bar(m[key], invert)}<div class="mhint">${hint}</div></div>`;
}

/** Metrika-blokk: cím + pontszám + bar + állítás-lista (score-fejléc a jobb szemléltetésért). */
function metricBlock(
  label: string,
  hint: string,
  score: number,
  countLabel: string,
  items: { text: string; ok: boolean; reason: string }[],
  invert = false,
): string {
  const rows = items
    .map(
      (it) => `<li class="${it.ok ? 'ok' : 'bad'}"><span class="mark">${it.ok ? '✓' : '✗'}</span>
        <span class="ctext">${esc(it.text)}<span class="creason"> — ${esc(it.reason)}</span></span></li>`,
    )
    .join('\n');
  return `<div class="mblock">
    <div class="mblock-h"><span class="mblock-title">${label}</span><span class="mblock-score">${pct(score)}% · ${esc(countLabel)}</span></div>
    <div class="mblock-hint">${esc(hint)}</div>
    ${bar(score, invert)}
    ${items.length ? `<ul class="claims-ul">${rows}</ul>` : ''}
  </div>`;
}

function caseSection(r: CaseResult): string {
  const chunks = r.chunks
    .map(
      (c) => `<li class="${c.relevant ? 'ok' : 'bad'}">
        <span class="mark">${c.relevant ? '✓' : '✗'}</span>
        <span class="ctext"><strong>${esc(c.title)}</strong>
          <span class="nums">dist ${c.distance.toFixed(2)} · sim ${c.sim.toFixed(2)}</span>
          <span class="creason"> — ${esc(c.reason)}</span></span></li>`,
    )
    .join('\n');
  const genq = r.generatedQuestions
    .map(
      (g) => `<li><div class="genq-q">„${esc(g.q)}”</div><div class="genq-bar">${bar(g.sim)}</div></li>`,
    )
    .join('\n');
  const faithScore = r.metrics.faithfulness;
  const faithN = r.faithClaims.filter((f) => f.supported).length;
  const recScore = r.metrics.contextRecall;
  const recN = r.recallClaims.filter((rc) => rc.covered).length;
  const noiseClaims = r.noise.claims ?? [];
  const noiseFailed = noiseClaims.length > 0 && noiseClaims.every((c) => c.reason === '—');

  return `
    <details class="case-d">
      <summary class="case-sum">
        <div class="case-title">${esc(r.id)} · ${esc(r.question)}</div>
        <div class="ops-line">⏱ ${(r.latencyMs / 1000).toFixed(1)} s · 🎟 ${r.tokens} token</div>
        <div class="minibars">
          ${METRIC_LABELS.map((ml) => `<div class="mini"><span>${ml.label}</span>${bar(r.metrics[ml.key], ml.invert)}</div>`).join('')}
        </div>
      </summary>
      <div class="case-body">

      <div class="gt"><div class="gt-h">✔️ Elvárt válasz (ground truth)</div><div class="rendered">${md(r.groundTruth)}</div></div>
      <div class="ans"><div class="ans-h">🤖 RAG-válasz</div><div class="rendered">${md(r.answer)}</div></div>

      <div class="claims"><div class="claims-h">Visszakapott chunkok (context precision alapja)</div><ul class="claims-ul">${chunks}</ul></div>

      ${metricBlock('Faithfulness', 'a válasz állításai a forrásokból jönnek-e (nem hallucinál)', faithScore, `${faithN}/${r.faithClaims.length} állítás alátámasztva`, r.faithClaims.map((f) => ({ text: f.claim, ok: f.supported, reason: f.reason })))}
      ${metricBlock('Context recall', 'a referencia-válasz állításait fedik-e a chunkok', recScore, `${recN}/${r.recallClaims.length} referencia-állítás lefedve`, r.recallClaims.map((rc) => ({ text: rc.claim, ok: rc.covered, reason: rc.reason })))}

      <div class="mblock">
        <div class="mblock-h"><span class="mblock-title">Answer relevancy</span><span class="mblock-score">${pct(r.metrics.answerRelevancy)}%</span></div>
        <div class="mblock-hint">a válaszból visszagenerált kérdéseket embeddeljük, és az eredeti kérdéshez mért koszinusz-hasonlóságuk átlaga a pontszám — ha a válasz a kérdésre felel, a visszagenerált kérdések hasonlítanak rá.</div>
        <ul class="genq">${genq}</ul>
      </div>

      <div class="mblock noiseblk">
        <div class="mblock-h"><span class="mblock-title">Noise sensitivity</span><span class="mblock-score">${noiseFailed ? 'n/a' : `${pct(r.metrics.noiseSensitivity)}%`} <span class="lowbetter">(kevesebb a jobb)</span></span></div>
        <div class="mblock-hint">A valódi chunkok közé szándékosan IRRELEVÁNS részleteket (pl. autó, recept) kevertünk, és újrageneráltuk a választ. Ez a zajos válasz azon állításainak aránya, amelyeket a VALÓDI források már NEM támasztanak alá — vagyis mennyire térítette el a zaj. 0% = a modell figyelmen kívül hagyta a zajt (robusztus).${noiseFailed ? ' <strong>Ebben az esetben a judge válasza nem volt értelmezhető (parse-hiba) — n/a, kihagyva az átlagból.</strong>' : ''}</div>
        ${noiseFailed ? '' : bar(r.metrics.noiseSensitivity, true)}
        <details><summary>Zajos válasz + állítás-ellenőrzés (${r.noise.supported}/${r.noise.total} alátámasztott)</summary>
          <div class="rendered">${md(r.noise.answer)}</div>
          ${noiseClaims.length ? `<ul class="claims-ul">${noiseClaims.map((c) => `<li class="${c.supported ? 'ok' : 'bad'}"><span class="mark">${c.supported ? '✓' : '✗'}</span><span class="ctext">${esc(c.claim)}<span class="creason"> — ${esc(c.reason)}</span></span></li>`).join('')}</ul>` : ''}
        </details>
      </div>
      </div>
    </details>`;
}

function render(data: RagData): string {
  // A noise aggregátum a parse-hibás eseteket (minden claim indoka „—") kihagyja — különben
  // egy értelmezhetetlen judge-válasz hamis 100%-ként húzná fel az átlagot.
  const noiseOk = data.results.filter(
    (r) => !(r.noise.claims?.length && r.noise.claims.every((c) => c.reason === '—')),
  );
  const correctedNoise = noiseOk.length
    ? noiseOk.reduce((s, r) => s + r.metrics.noiseSensitivity, 0) / noiseOk.length
    : 0;
  const a: Metrics = { ...data.aggregate, noiseSensitivity: correctedNoise };
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Plantbase — RAG-eval (RAGAS-stílus)</title>
<style>
  :root { --bg:#f7f8f7; --fg:#1a2b22; --muted:#5c6b63; --card:#fff; --line:#e2e8e4;
    --accent:#2f9e6f; --hi:#2f9e6f; --mid:#e08a2b; --lo:#d64545; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1512; --fg:#e6efe9; --muted:#93a49b; --card:#161d19; --line:#26332c;
    --accent:#4bbd8a; --hi:#4bbd8a; --mid:#f0a94b; --lo:#f06a6a; } }
  :root[data-theme="dark"] { --bg:#0f1512; --fg:#e6efe9; --muted:#93a49b; --card:#161d19; --line:#26332c; --accent:#4bbd8a; --hi:#4bbd8a; --mid:#f0a94b; --lo:#f06a6a; }
  :root[data-theme="light"] { --bg:#f7f8f7; --fg:#1a2b22; --muted:#5c6b63; --card:#fff; --line:#e2e8e4; --accent:#2f9e6f; --hi:#2f9e6f; --mid:#e08a2b; --lo:#d64545; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:860px; margin:0 auto; padding:32px 20px 80px; }
  h1 { margin:0 0 4px; font-size:24px; letter-spacing:-0.02em; }
  .sub { color:var(--muted); margin:0 0 20px; }
  .banner { background:color-mix(in srgb,var(--accent) 12%,transparent); border:1px solid color-mix(in srgb,var(--accent) 30%,transparent); border-radius:12px; padding:12px 16px; margin:0 0 16px; font-size:13.5px; }
  .legend { border:1px solid var(--line); border-radius:12px; padding:4px 14px; margin:0 0 22px; background:var(--card); }
  .legend > summary { cursor:pointer; font-weight:700; font-size:13.5px; padding:8px 0; }
  .legend-body { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; padding:6px 0 12px; }
  .legend-item { border-left:3px solid var(--accent); padding:2px 0 2px 10px; }
  .legend-name { font-weight:700; font-size:13px; margin-bottom:3px; }
  .legend-txt { font-size:12px; color:var(--muted); margin:2px 0; } .legend-txt strong { color:var(--fg); }
  .agg { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin:0 0 28px; }
  .mcard { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .mlabel { font-weight:700; font-size:14px; margin-bottom:8px; }
  .mhint { color:var(--muted); font-size:12px; margin-top:6px; }
  .bar { position:relative; background:color-mix(in srgb,var(--muted) 18%,transparent); border-radius:999px; height:20px; overflow:hidden; }
  .fill { height:100%; border-radius:999px; }
  .fill.hi { background:var(--hi); } .fill.mid { background:var(--mid); } .fill.lo { background:var(--lo); }
  .barval { position:absolute; right:8px; top:0; line-height:20px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  h2 { font-size:16px; margin:28px 0 10px; }
  .case { border-top:1px solid var(--line); padding-top:8px; }
  /* összecsukható eset — alapból zárva, a summary a cím + ops + 6 metrika-bar */
  .case-d { background:var(--card); border:1px solid var(--line); border-radius:12px; margin:10px 0; overflow:hidden; }
  .case-sum { cursor:pointer; padding:12px 14px; list-style:none; }
  .case-sum::-webkit-details-marker { display:none; }
  .case-title { font-weight:700; font-size:14px; margin-bottom:6px; }
  .case-body { padding:4px 14px 14px; border-top:1px solid var(--line); }
  .ops-line { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; margin:0 0 10px; }
  .case-sum .minibars { margin-bottom:0; }
  .minibars { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px 16px; margin:0 0 12px; }
  .mini span { font-size:11px; color:var(--muted); display:block; margin-bottom:3px; }
  details { margin:10px 0; } summary { cursor:pointer; color:var(--muted); font-size:13px; }
  .answer { margin-top:8px; white-space:pre-wrap; font-size:13px; border-left:3px solid var(--line); padding-left:12px; overflow-x:auto; }
  .claims { margin:12px 0; }
  .claims-h { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:6px; }
  .claims ul { list-style:none; margin:0; padding:0; }
  .claims li { display:flex; gap:8px; padding:6px 0; border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent); font-size:13px; }
  .claims li .mark { font-weight:800; }
  .claims li.ok .mark { color:var(--hi); } .claims li.bad .mark { color:var(--lo); }
  .claims-ul { list-style:none; margin:0; padding:0; }
  .claims-ul li { display:flex; gap:8px; padding:6px 0; border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent); font-size:13px; }
  .claims-ul li .mark { font-weight:800; }
  .claims-ul li.ok .mark { color:var(--hi); } .claims-ul li.bad .mark { color:var(--lo); }
  .nums { color:var(--muted); font-size:11.5px; font-variant-numeric:tabular-nums; margin-left:6px; }
  .creason { color:var(--muted); }
  /* rendered markdown (válasz + ground truth) */
  .rendered { font-size:13.5px; }
  .rendered h3,.rendered h4,.rendered h5 { margin:10px 0 4px; font-size:13.5px; }
  .rendered p { margin:6px 0; } .rendered ul,.rendered ol { margin:6px 0; padding-left:22px; }
  .rendered li { margin:2px 0; } .rendered code { background:color-mix(in srgb,var(--muted) 18%,transparent); padding:1px 5px; border-radius:5px; }
  .gt { background:color-mix(in srgb,var(--hi) 8%,transparent); border:1px solid color-mix(in srgb,var(--hi) 25%,transparent); border-radius:10px; padding:10px 14px; margin:12px 0; }
  .ans { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin:12px 0; }
  .gt-h,.ans-h { font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted); margin-bottom:4px; }
  .mblock { border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:12px 0; }
  .mblock-h { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:2px; }
  .mblock-title { font-weight:700; font-size:14px; } .mblock-score { font-variant-numeric:tabular-nums; font-weight:700; font-size:13px; }
  .mblock-hint { color:var(--muted); font-size:12px; margin-bottom:8px; }
  .mblock .bar { margin-bottom:8px; }
  .noiseblk { border-color:color-mix(in srgb,var(--mid) 35%,transparent); }
  .lowbetter { color:var(--muted); font-weight:400; font-size:11px; }
  .genq { list-style:none; margin:0; padding:0; }
  .genq li { padding:5px 0; }
  .genq-q { font-size:13px; margin-bottom:3px; } .genq-bar { max-width:260px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🌿 Plantbase — RAG-eval <span style="font-size:14px;color:var(--muted)">(RAGAS-stílus)</span></h1>
  <p class="sub">${data.results.length} kérdés · top-K ${data.meta.topK} · ${esc(data.meta.generatedAt)}${
    data.meta.avgLatencyMs != null
      ? ` · ⏱ ${(data.meta.avgLatencyMs / 1000).toFixed(1)} s/eset · 🎟 ${data.meta.avgTokens} token/eset (∑ ${data.meta.totalTokens})`
      : ''
  }</p>
  <div class="banner">Ez a <strong>külön RAG-riport</strong> (a battery-riporttól elkülönítve). A metrikák a
  <em>retrieval→generálás</em> minőségét mérik: a faithfulness, context precision/recall és noise
  sensitivity LLM-judge-dzsal, az answer relevancy/correctness embedding-gel. Minden döntés indoklással,
  állítás-szinten. A <em>noise sensitivity</em> fordított: kevesebb a jobb.</div>

  <details class="legend" open>
    <summary>📖 Metrika-definíciók — mit mérnek és mi a jó érték</summary>
    <div class="legend-body">
      ${METRIC_LABELS.map(
        (ml) => `<div class="legend-item">
        <div class="legend-name">${ml.label}</div>
        <div class="legend-txt"><strong>Mit mér:</strong> ${esc(ml.what)}</div>
        <div class="legend-txt"><strong>Hogyan:</strong> ${esc(ml.how)}</div>
        <div class="legend-txt"><strong>Jó érték:</strong> ${esc(ml.good)}</div>
      </div>`,
      ).join('\n')}
    </div>
  </details>

  <div class="agg">
    ${METRIC_LABELS.map((ml) => metricCard(a, ml.key, ml.label, ml.hint, ml.invert)).join('\n')}
  </div>

  ${data.results.map(caseSection).join('\n')}
</div>
</body>
</html>`;
}

function openInBrowser(path: string): void {
  const opener = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(opener, [path], { detached: true, stdio: 'ignore', shell: platform === 'win32' });
    child.unref();
  } catch {
    /* headless/CI: nem kritikus */
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const [inPath, maybeOut] = argv.filter((x) => x !== '--no-open');
  if (!inPath) {
    console.error('Használat: rag-report-html.ts <rag-eval.json> [out.html] [--no-open]');
    process.exit(1);
  }
  let data: RagData;
  try {
    data = JSON.parse(readFileSync(inPath, 'utf8')) as RagData;
  } catch {
    console.error(`Nem olvasható/érvénytelen rag-eval JSON: ${inPath}`);
    process.exit(1);
  }
  const out = maybeOut ?? join(dirname(inPath), basename(inPath).replace(/\.json$/, '-report.html'));
  writeFileSync(out, render(data));
  console.log(`📄 RAG-riport: ${out}`);
  if (!noOpen) {
    openInBrowser(out);
    console.log('🌐 Megnyitás a böngészőben…');
  }
}

main();
