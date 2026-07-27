import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { chatThread, esc, openInBrowser } from './lib/html.js';
import { isFailureFlag } from './lib/matchers.js';

// report-html.ts — a battery-eredményből (+ opcionális javaslatokból) ÖNÁLLÓ, self-contained
// „fancy" HTML-riportot rendel. Determinisztikus: a tartalmat az agent adja (JSON), a forma itt
// dől el. Nincs külső függőség (CDN/font tiltva), a stílus inline, téma-érzékeny (light/dark).
//
// Használat:
//   pnpm tsx .claude/skills/autotest/scripts/report-html.ts <battery.json> [suggestions.json] [out.html]

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

interface QResult {
  id: string;
  q: string;
  ms: number;
  ttfcMs?: number;
  tokens?: number | null;
  answer: string;
  flags: string[];
  /** Ha volt determinisztikus elvárás: a ground truth leírása. */
  truth?: string;
  /** A harness saját ítélete: elfogadva-e és miért. */
  verdict?: { accepted: boolean; reason: string };
}
interface Tier {
  name: string;
  intent: string;
  results: QResult[];
}
interface ConsistencyItem {
  id: string;
  question: string;
  runs: number;
  acceptedCount: number;
  agreement: number;
  stable: boolean;
  answers: string[];
}
interface BatteryData {
  meta: {
    generatedAt: string;
    web: string;
    testSource: string;
    totalQuestions: number;
    flaggedCount: number;
    avgMs: number;
    avgTtfcMs?: number;
    totalTokens?: number;
    avgTokens?: number;
  };
  tiers: Tier[];
  consistency?: ConsistencyItem[];
}
interface Suggestion {
  id: string;
  title: string;
  severity: Severity;
  area: string;
  rationale: string;
  /** Szabad szöveges hivatkozás (opcionális felirat). */
  evidence?: string;
  /** Kérdés-id-k a battery-ből — a report a VALÓDI kérdést+választ mutatja bizonyítékként. */
  evidenceRefs?: string[];
}



const SEV_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** A bizonyíték: a valódi kérdés + a problémás válasz kivonata, a futásból. */
function proofBlock(refIds: string[], byId: Map<string, QResult>): string {
  const proofs = refIds
    .map((id) => byId.get(id))
    .filter((r): r is QResult => Boolean(r))
    .map((r) => {
      const fail = r.flags.some(isFailureFlag);
      return `
        <div class="proof ${fail ? 'proof-fail' : ''}">
          <div class="proof-q">🔎 <code>${esc(r.id)}</code> · ${esc(r.q)}</div>
          ${r.truth ? `<div class="proof-truth">✔️ Helyes: ${esc(r.truth)}</div>` : ''}
          <div class="proof-a">💬 „${esc(clip(r.answer, 500)) || '<em>üres</em>'}”</div>
          ${r.verdict ? `<div class="verdict ${r.verdict.accepted ? 'v-ok' : 'v-fail'}">${esc(r.verdict.reason)}</div>` : ''}
        </div>`;
    })
    .join('\n');
  return proofs
    ? `<div class="proofs"><div class="proofs-label">Bizonyíték (a futásból)</div>${proofs}</div>`
    : '';
}

function clip(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}


function suggestionsSection(suggestions: Suggestion[], byId: Map<string, QResult>): string {
  if (suggestions.length === 0) {
    return '<p class="muted">Nincs javaslat — a battery jelzés nélkül futott.</p>';
  }
  const sorted = [...suggestions].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return sorted
    .map(
      (s) => `
      <div class="card sug sev-${s.severity}">
        <div class="sug-head">
          <span class="pill sev-${s.severity}">${s.severity}</span>
          <span class="pill area">${esc(s.area)}</span>
          <span class="sug-id">${esc(s.id)}</span>
        </div>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.rationale)}</p>
        ${s.evidence ? `<p class="evidence">📌 ${esc(s.evidence)}</p>` : ''}
        ${s.evidenceRefs && s.evidenceRefs.length ? proofBlock(s.evidenceRefs, byId) : ''}
      </div>`,
    )
    .join('\n');
}

function tierSection(tier: Tier): string {
  const rows = tier.results
    .map((r) => {
      const fail = r.flags.some(isFailureFlag);
      const status = fail
        ? '<span class="status fail">✗</span>'
        : r.flags.length
          ? '<span class="status warn">⚠️</span>'
          : '<span class="status ok">✓</span>';
      const ttfc = r.ttfcMs != null ? `<span class="metric">⚡ ${(r.ttfcMs / 1000).toFixed(1)} s</span>` : '';
      const tok = r.tokens != null ? `<span class="metric">🎟 ${r.tokens} tok</span>` : '';
      const flagLine = r.flags.length
        ? `<div class="flagline ${fail ? 'fail' : 'warn'}">${fail ? '✗' : '⚠️'} ${esc(r.flags.join('; '))}</div>`
        : '';
      // Alapból ZÁRVA: csak a cím + metrikák látszanak; kattintásra nyílik a beszélgetés.
      return `
      <details class="case-d ${fail ? 'failed' : r.flags.length ? 'flagged' : ''}" id="q-${esc(r.id)}">
        <summary class="case-sum"><div class="sum-row">
          ${status}
          <span class="case-title">${esc(clip(r.q, 96))}</span>
          <span class="case-metrics"><span class="latency">${(r.ms / 1000).toFixed(1)} s</span>${ttfc}${tok}</span>
        </div></summary>
        <div class="case-body">
          ${chatThread(r.q, r.answer)}
          ${r.truth ? `<div class="truth">✔️ Ground truth: ${esc(r.truth)}</div>` : ''}
          ${flagLine}
          ${r.verdict ? `<div class="verdict ${r.verdict.accepted ? 'v-ok' : 'v-fail'}">${esc(r.verdict.reason)}</div>` : ''}
        </div>
      </details>`;
    })
    .join('\n');
  return `
    <section class="tier">
      <h2>${esc(tier.name)}</h2>
      <p class="intent">${esc(tier.intent)}</p>
      ${rows}
    </section>`;
}

function consistencySection(items?: ConsistencyItem[]): string {
  if (!items || items.length === 0) return '';
  const rows = items
    .map((it) => {
      const cls = it.stable ? 'ok' : 'bad';
      const mark = it.stable ? '✓ stabil' : '✗ ingadozik';
      return `<div class="card q ${it.stable ? '' : 'failed'}">
        <div class="q-head"><span class="pill ${it.stable ? 'ok' : 'fail'}">${mark}</span>
          <span class="latency">${it.acceptedCount}/${it.runs} elfogadva · egyezés ${Math.round(it.agreement * 100)}%</span></div>
        <div class="q-text">${esc(it.question)}</div>
        <div class="verdict ${cls === 'ok' ? 'v-ok' : 'v-fail'}">${it.runs} futásból ${it.acceptedCount} elfogadva — a verdict ${it.stable ? 'MINDEN futásban egyezett' : 'FUTÁSONKÉNT VÁLTOZOTT (LLM-flakiness)'}.</div>
        <details><summary>A ${it.runs} válasz</summary><div class="answer">${it.answers.map((a, i) => `#${i + 1}: ${esc(clip(a, 200))}`).join('\n\n')}</div></details>
      </div>`;
    })
    .join('\n');
  return `<section class="tier"><h2>Konzisztencia (ismételt futás)</h2>
    <p class="intent">Ugyanaz a kérdés többször — a verdict egyezése méri az LLM-flakiness-t.</p>${rows}</section>`;
}

function render(data: BatteryData, suggestions: Suggestion[]): string {
  const m = data.meta;
  const highs = suggestions.filter((s) => s.severity === 'HIGH').length;
  const allResults = data.tiers.flatMap((t) => t.results);
  const byId = new Map(allResults.map((r) => [r.id, r]));
  const failCount = allResults.filter((r) => r.flags.some(isFailureFlag)).length;
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Plantbase — teszt-riport (${esc(m.testSource)})</title>
<style>
  :root {
    --bg:#f7f8f7; --fg:#1a2b22; --muted:#5c6b63; --card:#ffffff; --line:#e2e8e4;
    --accent:#2f9e6f; --high:#d64545; --medium:#e08a2b; --low:#3b82c4; --ok:#2f9e6f;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1512; --fg:#e6efe9; --muted:#93a49b; --card:#161d19; --line:#26332c;
      --accent:#4bbd8a; --high:#f06a6a; --medium:#f0a94b; --low:#6aa8e0; --ok:#4bbd8a; }
  }
  :root[data-theme="dark"] { --bg:#0f1512; --fg:#e6efe9; --muted:#93a49b; --card:#161d19; --line:#26332c;
      --accent:#4bbd8a; --high:#f06a6a; --medium:#f0a94b; --low:#6aa8e0; --ok:#4bbd8a; }
  :root[data-theme="light"] { --bg:#f7f8f7; --fg:#1a2b22; --muted:#5c6b63; --card:#ffffff; --line:#e2e8e4;
      --accent:#2f9e6f; --high:#d64545; --medium:#e08a2b; --low:#3b82c4; --ok:#2f9e6f; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:860px; margin:0 auto; padding:32px 20px 80px; }
  header h1 { margin:0 0 4px; font-size:26px; letter-spacing:-0.02em; }
  header .sub { color:var(--muted); margin:0 0 24px; }
  .stats { display:flex; flex-wrap:wrap; gap:12px; margin:0 0 32px; }
  .stat { flex:1 1 120px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .stat .n { font-size:24px; font-weight:700; }
  .stat .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
  h2 { font-size:18px; margin:32px 0 4px; }
  .intent { color:var(--muted); margin:0 0 14px; font-size:13px; }
  .stat.stat-fail { border-color:var(--high); } .stat.stat-fail .n { color:var(--high); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:10px 0; }
  .card.flagged { border-color:var(--medium); }
  .card.failed { border-color:var(--high); border-left-width:4px; }
  /* összecsukható eset — alapból zárva, csak cím + metrikák */
  .case-d { background:var(--card); border:1px solid var(--line); border-radius:12px; margin:8px 0; overflow:hidden; }
  .case-d.flagged { border-color:var(--medium); } .case-d.failed { border-color:var(--high); border-left-width:4px; }
  .case-sum { cursor:pointer; padding:11px 14px; list-style:none; }
  .case-sum::-webkit-details-marker { display:none; }
  .sum-row { display:flex; align-items:center; gap:10px; }
  .status { font-weight:800; font-size:15px; flex:none; }
  .status.ok { color:var(--ok); } .status.warn { color:var(--medium); } .status.fail { color:var(--high); }
  .case-title { font-weight:600; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .case-metrics { margin-left:auto; display:flex; gap:10px; align-items:center; flex:none; }
  .case-body { padding:2px 14px 14px; border-top:1px solid var(--line); }
  .flagline { margin:8px 0 0; font-size:12.5px; font-weight:600; }
  .flagline.fail { color:var(--high); } .flagline.warn { color:var(--medium); }
  .pill.fail { background:color-mix(in srgb,var(--high) 22%,transparent); color:var(--high); }
  .truth { margin-top:6px; font-size:12.5px; color:var(--muted); }
  .verdict { margin-top:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.45;
    padding:6px 10px; border-radius:7px; border-left:3px solid var(--line); }
  .verdict.v-ok { background:color-mix(in srgb,var(--ok) 10%,transparent); border-left-color:var(--ok); color:color-mix(in srgb,var(--ok) 80%,var(--fg)); }
  .verdict.v-fail { background:color-mix(in srgb,var(--high) 12%,transparent); border-left-color:var(--high); color:color-mix(in srgb,var(--high) 85%,var(--fg)); }
  .proofs { margin-top:10px; border-top:1px dashed var(--line); padding-top:10px; }
  .proofs-label { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:6px; }
  .proof { background:color-mix(in srgb,var(--line) 35%,transparent); border-radius:8px; padding:9px 11px; margin:6px 0; font-size:13px; }
  .proof.proof-fail { background:color-mix(in srgb,var(--high) 12%,transparent); border:1px solid color-mix(in srgb,var(--high) 30%,transparent); }
  .proof-q { font-weight:600; margin-bottom:3px; }
  .proof-q code { background:color-mix(in srgb,var(--muted) 20%,transparent); padding:1px 5px; border-radius:5px; font-size:11px; }
  .proof-truth { color:var(--accent); font-size:12.5px; margin:2px 0; }
  .proof-flag { color:var(--high); font-weight:600; font-size:12.5px; margin:2px 0; }
  .proof-a { color:var(--fg); margin-top:3px; font-style:italic; opacity:0.9; }
  .q-head, .sug-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .latency { font-variant-numeric:tabular-nums; font-weight:600; color:var(--accent); }
  .metric { font-variant-numeric:tabular-nums; font-size:12px; color:var(--muted); }
  .q-text { font-weight:600; }
  details { margin-top:8px; } summary { cursor:pointer; color:var(--muted); font-size:13px; }
  .answer { margin-top:8px; white-space:pre-wrap; font-size:13px; color:var(--fg); border-left:3px solid var(--line); padding-left:12px; overflow-x:auto; }
  /* chat-nézet — a teljes beszélgetés buborékokban (szemléltetőfelület) */
  .chat { margin:12px 0 4px; display:flex; flex-direction:column; gap:8px; }
  .msg { max-width:88%; padding:9px 13px; border-radius:14px; font-size:13.5px; line-height:1.5; }
  .msg.user { align-self:flex-end; background:color-mix(in srgb,var(--accent) 16%,transparent); border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-bottom-right-radius:4px; white-space:pre-wrap; }
  .msg.bot { align-self:flex-start; background:var(--card); border:1px solid var(--line); border-bottom-left-radius:4px; }
  .rendered { font-size:13.5px; }
  .rendered h3,.rendered h4,.rendered h5 { margin:8px 0 3px; font-size:13.5px; }
  .rendered p { margin:5px 0; } .rendered p:first-child { margin-top:0; } .rendered p:last-child { margin-bottom:0; }
  .rendered ul,.rendered ol { margin:5px 0; padding-left:20px; } .rendered li { margin:2px 0; }
  .rendered code { background:color-mix(in srgb,var(--muted) 18%,transparent); padding:1px 5px; border-radius:5px; }
  .tbl-wrap { overflow-x:auto; margin:6px 0; }
  .rendered table { border-collapse:collapse; font-size:12px; } .rendered td,.rendered th { border:1px solid var(--line); padding:3px 7px; text-align:left; white-space:nowrap; }
  .rendered th { background:color-mix(in srgb,var(--muted) 12%,transparent); }
  .pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:0.03em; }
  .pill.ok { background:color-mix(in srgb,var(--ok) 18%,transparent); color:var(--ok); }
  .pill.flag { background:color-mix(in srgb,var(--medium) 20%,transparent); color:var(--medium); }
  .pill.area { background:color-mix(in srgb,var(--muted) 18%,transparent); color:var(--muted); }
  .pill.sev-HIGH { background:color-mix(in srgb,var(--high) 20%,transparent); color:var(--high); }
  .pill.sev-MEDIUM { background:color-mix(in srgb,var(--medium) 20%,transparent); color:var(--medium); }
  .pill.sev-LOW { background:color-mix(in srgb,var(--low) 20%,transparent); color:var(--low); }
  .sug { border-left:4px solid var(--line); }
  .sug.sev-HIGH { border-left-color:var(--high); } .sug.sev-MEDIUM { border-left-color:var(--medium); } .sug.sev-LOW { border-left-color:var(--low); }
  .sug h3 { margin:6px 0 4px; font-size:15px; } .sug-id { margin-left:auto; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .evidence { color:var(--muted); font-size:13px; margin:6px 0 0; }
  .muted { color:var(--muted); }
  .banner { background:color-mix(in srgb,var(--accent) 12%,transparent); border:1px solid color-mix(in srgb,var(--accent) 30%,transparent); border-radius:12px; padding:12px 16px; margin:0 0 24px; font-size:14px; }
  .tabs { display:flex; gap:6px; border-bottom:1px solid var(--line); margin:0 0 8px; }
  .tab { appearance:none; background:none; border:none; cursor:pointer; font:inherit; font-weight:600;
    color:var(--muted); padding:9px 14px; border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab:hover { color:var(--fg); }
  .tab.active { color:var(--accent); border-bottom-color:var(--accent); }
  .panel { display:none; }
  .panel.active { display:block; }
  .panel > .tier:first-child h2 { margin-top:16px; }
</style>
<noscript><style>.panel { display:block !important; }</style></noscript>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🌿 Plantbase — teszt-riport</h1>
    <p class="sub">Nehézségi létra (${esc(m.testSource)}) · ${esc(m.web)} · ${esc(m.generatedAt)}</p>
  </header>

  <div class="stats">
    <div class="stat"><div class="n">${m.totalQuestions}</div><div class="l">Kérdés</div></div>
    <div class="stat"><div class="n">${(m.avgMs / 1000).toFixed(1)} s</div><div class="l">Átlag válaszidő</div></div>
    ${m.avgTtfcMs != null ? `<div class="stat"><div class="n">${(m.avgTtfcMs / 1000).toFixed(1)} s</div><div class="l">Átlag TTFC</div></div>` : ''}
    ${m.totalTokens != null ? `<div class="stat"><div class="n">${m.totalTokens.toLocaleString('hu')}</div><div class="l">Össz token (${m.avgTokens}/kérdés)</div></div>` : ''}
    <div class="stat ${failCount ? 'stat-fail' : ''}"><div class="n">${failCount}</div><div class="l">Bukott (HIBA/szivárgás)</div></div>
    <div class="stat"><div class="n">${highs}</div><div class="l">HIGH javaslat</div></div>
  </div>

  <div class="banner">Ez a riport egy döntési ponthoz vezet: a <em>Javaslatok</em> fülről a
  csapat kiválasztja, melyiket ültetjük át — a döntés (elfogadott <em>és</em> elvetett)
  egy ADR-be kerül (<code>docs/adr/</code>).</div>

  <div class="tabs" role="tablist">
    <button class="tab active" data-tab="tests" role="tab">Tesztesetek · ${m.totalQuestions}</button>
    <button class="tab" data-tab="suggestions" role="tab">Javaslatok · ${suggestions.length}</button>
  </div>

  <div id="panel-tests" class="panel active" role="tabpanel">
    ${data.tiers.map(tierSection).join('\n')}
    ${consistencySection(data.consistency)}
  </div>
  <div id="panel-suggestions" class="panel" role="tabpanel">
    ${suggestionsSection(suggestions, byId)}
  </div>
</div>
<script>
  (function () {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        t.classList.add('active');
        var panel = document.getElementById('panel-' + t.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
  })();
</script>
</body>
</html>`;
}

/** JSON beolvasás tiszta, magyar hibaüzenettel — nyers fs-stacktrace helyett. */
function readJson<T>(path: string, label: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`Nem olvasható a ${label} fájl: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`A ${label} fájl nem érvényes JSON: ${path}`);
    process.exit(1);
  }
}


function main(): void {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const [batteryPath, maybeSug, maybeOut] = argv.filter((a) => a !== '--no-open');
  if (!batteryPath) {
    console.error(
      'Használat: report-html.ts <battery.json> [suggestions.json] [out.html] [--no-open]',
    );
    process.exit(1);
  }
  const data = readJson<BatteryData>(batteryPath, 'battery');

  let suggestions: Suggestion[] = [];
  let outPath = maybeOut;
  if (maybeSug && maybeSug.endsWith('.json')) {
    suggestions = readJson<{ suggestions: Suggestion[] }>(maybeSug, 'suggestions').suggestions;
  } else if (maybeSug && !outPath) {
    outPath = maybeSug; // a 2. argumentum a kimenet, ha nem .json
  }

  const out =
    outPath ?? join(dirname(batteryPath), basename(batteryPath).replace(/\.json$/, '-report.html'));
  writeFileSync(out, render(data, suggestions));
  console.log(`📄 HTML riport: ${out}`);

  // A riport a teszt után magától megnyílik (--no-open kikapcsolja, pl. CI-ben).
  if (!noOpen) {
    openInBrowser(out);
    console.log('🌐 Megnyitás a böngészőben…');
  }
}

main();
