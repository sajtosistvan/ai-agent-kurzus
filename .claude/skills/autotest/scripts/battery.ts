import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Page } from 'playwright';

const execFileAsync = promisify(execFile);

// KÖLTSÉG: a szerver kérdésenként egy logs/<ts>.json-t ír a teljes usage-dzsel. A battery
// szekvenciális (egy request egyszerre), így a kérdés kezdete UTÁN keletkezett log(ok) tokenjeit
// összegezve pontos per-kérdés költséget kapunk — a böngésző maga nem látja a tokent.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function sumTokensSince(sinceMs: number, minCount = 1): Promise<number | null> {
  for (let attempt = 0; attempt < 25; attempt++) {
    let recent: string[] = [];
    try {
      recent = readdirSync('logs')
        .filter((f) => f.endsWith('.json'))
        .map((f) => join('logs', f))
        .filter((p) => statSync(p).mtimeMs > sinceMs);
    } catch {
      recent = [];
    }
    if (recent.length >= minCount) {
      let sum = 0;
      for (const p of recent) {
        try {
          const d = JSON.parse(readFileSync(p, 'utf8')) as { usage?: { inputTokens?: number; outputTokens?: number } };
          sum += (d.usage?.inputTokens ?? 0) + (d.usage?.outputTokens ?? 0);
        } catch {
          /* skip */
        }
      }
      return sum;
    }
    await sleep(200);
  }
  return null;
}

// ── Szemléltető HUD: Playwright-injektált doboz a sarokban, ami mutatja, épp mi történik.
// NEM az app része — minden goto törli, ezért fázisonként újrarajzoljuk. `--no-hud` kikapcsolja.
const HUD_ENABLED = !process.argv.includes('--no-hud');
const HUD_PAUSE_MS = HUD_ENABLED ? 900 : 0; // az ítélet legyen látható a demón, mielőtt tovább lép

// Rövid órai demóhoz: `--only <részlet[,részlet]>` csak a névre illeszkedő tiereket futtatja,
// `--no-consistency` kihagyja a lassú (3×) consistency-passt.
const ONLY = ((): string[] => {
  const inline = process.argv.find((a) => a.startsWith('--only='));
  const i = process.argv.indexOf('--only');
  const val = inline ? inline.slice('--only='.length) : i >= 0 ? (process.argv[i + 1] ?? '') : '';
  return val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
})();
const SKIP_CONSISTENCY = process.argv.includes('--no-consistency');
let hudLabel = '';
let hudSub = '';
function hudEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 200);
}
async function setHud(page: Page, phase: string, tone: 'run' | 'ok' | 'fail' = 'run'): Promise<void> {
  if (!HUD_ENABLED) return;
  const color = tone === 'ok' ? '#4bbd8a' : tone === 'fail' ? '#f06a6a' : '#e0a94b';
  try {
    await page.evaluate(
      (o: { label: string; sub: string; phase: string; color: string }) => {
        let el = document.getElementById('__pw_hud');
        if (!el) {
          el = document.createElement('div');
          el.id = '__pw_hud';
          document.body.appendChild(el);
        }
        el.setAttribute(
          'style',
          "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;" +
            "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
            "background:rgba(15,21,18,.96);color:#e6efe9;border:1px solid " + o.color + ";" +
            "border-radius:12px;padding:12px 15px;box-shadow:0 10px 34px rgba(0,0,0,.45);pointer-events:none;",
        );
        el.innerHTML =
          '<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#93a49b;margin-bottom:5px">🎬 autotest · Playwright</div>' +
          '<div style="font-weight:700;margin-bottom:3px">' + o.label + '</div>' +
          (o.sub ? '<div style="color:#b9c7bf;font-size:12px;margin-bottom:7px">' + o.sub + '</div>' : '') +
          '<div style="color:' + o.color + ';font-weight:600">' + o.phase + '</div>';
      },
      { label: hudEsc(hudLabel), sub: hudEsc(hudSub), phase, color },
    );
  } catch {
    /* navigáció közben nincs body — nem kritikus */
  }
}

/**
 * Üzenet küldése + két latency-mérés: TTFC (time-to-first-character: az első nem-üres
 * válasz-buborék megjelenése) és a teljes idő (streaming vége). A böngésző DOM-jából mérve.
 */
async function sendAndMeasure(page: Page, message: string): Promise<{ answer: string; ttfcMs: number }> {
  const before = await page.locator('.prose').count();
  const t0 = Date.now();
  await page.getByPlaceholder('Írd be a kérdésed…').fill(message);
  await setHud(page, '✍️ kérdés beírása…');
  await page.keyboard.press('Enter');
  await setHud(page, '⏳ várakozás a válaszra…');

  let ttfcMs = 0;
  while (Date.now() - t0 < ANSWER_TIMEOUT_MS) {
    if ((await page.locator('.prose').count()) > before) {
      const txt = await page.locator('.prose').last().innerText().catch(() => '');
      if (txt.trim().length > 0) {
        ttfcMs = Date.now() - t0;
        await setHud(page, `💬 válasz érkezik… (első karakter ${(ttfcMs / 1000).toFixed(1)} s)`);
        break;
      }
    }
    await page.waitForTimeout(50);
  }
  await page.getByText('gondolkodik…').waitFor({ state: 'hidden', timeout: ANSWER_TIMEOUT_MS }).catch(() => undefined);
  const answer = ((await page.locator('.prose').last().innerText().catch(() => '')) ?? '').trim();
  await setHud(page, `✅ válasz kész (${((Date.now() - t0) / 1000).toFixed(1)} s) — ellenőrzés…`);
  return { answer, ttfcMs };
}

// battery.ts — Playwright „nehézségi létra": egyre bonyolultabb kérdéseket tesz fel a valódi
// web UI-nak, sorban (single → multi → komplex → stressz → trollkodás), kérdésenként FRISS
// oldallal (izoláció, hogy ne szivárogjon a kontextus), és a végén markdown-riportot ír.
//
// Előfeltétel: `pnpm web` (4200) + szerver (3001) fut. Futtatás:
//   pnpm tsx --env-file=.env .claude/skills/autotest/scripts/battery.ts

const WEB = process.env['FLOW_TEST_WEB'] ?? 'http://localhost:4200';
const ANSWER_TIMEOUT_MS = 180_000;

// A csomag-mentés NEM a válasz szövegéből dől el (az félrevezethet), hanem a DB-ből: jött-e
// létre új sor a `packages` táblában. A már futó Postgres-konténerben kérdezünk `psql`-lel
// (mint a demo.sh) — nincs hozzá extra függőség. A konténer neve a docker-compose-ból: plantbase-pg.
const PG_CONTAINER = process.env['FLOW_TEST_PG_CONTAINER'] ?? 'plantbase-pg';
async function psql(sql: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec', '-i', PG_CONTAINER,
      'psql', '-U', 'plantbase', '-d', 'plantbase', '-tAc', sql,
    ]);
    return stdout;
  } catch {
    return null;
  }
}
async function countPackages(): Promise<number | null> {
  const out = await psql('SELECT count(*) FROM packages');
  if (out === null) return null;
  const n = Number.parseInt(out.trim(), 10);
  return Number.isNaN(n) ? null : n;
}
/** Egy referencia-SQL név-halmaza (SQL execution accuracy). */
async function queryNameSet(sql: string): Promise<string[] | null> {
  const out = await psql(sql);
  if (out === null) return null;
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}
let allCatalogNames: string[] | null = null;
async function getAllCatalogNames(): Promise<string[]> {
  // CSAK sikeres eredményt cache-elünk — különben egy tranziens DB-hiba az üres tömböt az egész
  // futásra bekonzerválná (a `[]` truthy), és minden sqlCheck 0 talált névvel dolgozna.
  if (allCatalogNames === null) {
    const result = await queryNameSet('SELECT name FROM products');
    if (result) allCatalogNames = result;
  }
  return allCatalogNames ?? [];
}

/**
 * Determinisztikus korrektség-elvárás — DB-ből számolt ground truth alapján.
 * Ha nem teljesül, `HIBA:` flag kerül a válaszra (a report ezt bizonyítékként mutatja).
 */
interface Expect {
  /** Legalább az egyiknek szerepelnie kell a válaszban (különben HIBA). */
  includesAny?: string[];
  /** Egyik sem szerepelhet a válaszban (különben HIBA). */
  excludesAll?: string[];
  /** Emberi leírás a helyes válaszról — a riportban megjelenik. */
  truth: string;
}

interface Question {
  /** Stabil azonosító — erre hivatkoznak a javaslatok (proof-linkelés). */
  id: string;
  q: string;
  /** Trollkodásnál: mik NE legyenek a válaszban (leak/veszély jelei). */
  redFlags?: string[];
  /** Buktató kérdéseknél: determinisztikus korrektség-ellenőrzés. */
  expect?: Expect;
  /**
   * SQL execution accuracy: a referencia-SQL egy név-HALMAZT ad; a válaszban említett katalógus-
   * neveket ehhez mérjük (precision/recall/F1) — nem substring-heurisztika, hanem halmaz-egyezés.
   */
  sqlCheck?: { sql: string };
}

/**
 * Több-körös (multi-turn) eset: egy session, több egymásra épülő üzenet. A kontextust az
 * agentnek meg kell tartania a körök között — itt derül ki, ha „elfelejti", amit korábban mondtak.
 */
interface ConversationCase {
  id: string;
  /** Rövid cél/leírás — ez lesz a riportban a „kérdés". */
  title: string;
  /** A user üzenetei sorban, ugyanabban a beszélgetésben. */
  steps: string[];
  redFlags?: string[];
  /** Elvárás az UTOLSÓ kör válaszára (elérte-e a beszélgetés a kívánt végállapotot). */
  expect?: Expect;
  /** Determinisztikus DB-ellenőrzés a szöveg helyett (jelenleg: „package-saved"). */
  verifyDb?: 'package-saved';
  /** Ground truth leírása (a riportnak) — verifyDb esetén itt, expect nélkül. */
  truth?: string;
  /** Turn efficiency: hány kör az ideális a cél eléréséhez (hatékonyság = ideális / ténylegesen kellett). */
  idealTurns?: number;
}

interface Tier {
  name: string;
  intent: string;
  /** Egy-körös kérdések (friss oldal kérdésenként). */
  questions?: Question[];
  /** Több-körös beszélgetés-esetek (egy oldal, több üzenet). */
  conversations?: ConversationCase[];
}

// A tesztesetek KÜLÖN JSON-ban élnek (jól bemutatható, kódtól független): battery-cases.json.
const TIERS: Tier[] = (
  JSON.parse(readFileSync('.claude/skills/autotest/battery-cases.json', 'utf8')) as { tiers: Tier[] }
).tiers;

/** A harness saját ítélete: elfogadja-e a választ, és MIÉRT — emberi mondatban. */
interface Verdict {
  accepted: boolean;
  reason: string;
}

interface Result {
  tier: string;
  id: string;
  q: string;
  ms: number;
  /** Time to first character: az első válasz-karakter megjelenéséig eltelt idő (ms). */
  ttfcMs: number;
  /** LLM-token (input+output) a kérdéshez — a szerver trace-éből (null, ha nem olvasható). */
  tokens: number | null;
  answer: string;
  flags: string[];
  /** Ha volt determinisztikus elvárás: a ground truth leírása (a riportnak). */
  truth?: string;
  /** A harness által írt indoklás — miért elfogadva/elutasítva. */
  verdict: Verdict;
}

/** Determinisztikus korrektség-ellenőrzés — a bukás flag-ként kerül a válaszra. */
/**
 * Token-illesztés: SZÁMNÁL pontos szám-egyezés (a „15" NE illeszkedjen a „15 900"-ra, a „60" az
 * „1 160 Ft"-ra). Magyar ezres-elválasztó a szóköz és a pont; a tizedes vessző elválaszt.
 * Nem-számnál sima (kisbetűs) substring.
 */
function containsToken(answer: string, token: string): boolean {
  const t = token.trim();
  if (/^\d[\d\s.]*\d$|^\d$/.test(t)) {
    const target = t.replace(/[\s.]/g, '');
    const nums = answer.match(/\d[\d\s.]*\d|\d/g) ?? [];
    return nums.some((n) => n.replace(/[\s.]/g, '') === target);
  }
  return answer.toLowerCase().includes(t.toLowerCase());
}

/**
 * Szivárgás/engedés-illesztés TAGADÁS-tudatosan: ha a találatot közvetlenül (kb. egy tagmondaton
 * belül) tagadószó előzi meg („nem törölve", „nem módosítottam"), az NEM szivárgás — a helyes
 * elutasítás gyakran idézi a tiltott műveletet. Csak a nem-tagadott előfordulás számít jelnek.
 */
function leakHit(text: string, flag: string): boolean {
  const lower = text.toLowerCase();
  const f = flag.toLowerCase();
  for (let i = lower.indexOf(f); i >= 0; i = lower.indexOf(f, i + f.length)) {
    const before = lower.slice(Math.max(0, i - 30), i);
    if (!/\b(nem|sem|nincs|tilos)\b[^.!?]*$/.test(before)) return true;
  }
  return false;
}

function checkExpect(answer: string, expect: Expect): string[] {
  const flags: string[] = [];
  if (expect.includesAny && !expect.includesAny.some((s) => containsToken(answer, s))) {
    flags.push(`HIBA: egyik elvárt sem szerepel (${expect.includesAny.join(' / ')})`);
  }
  for (const forbidden of expect.excludesAll ?? []) {
    if (containsToken(answer, forbidden)) {
      flags.push(`HIBA: tiltott szerepel ("${forbidden}")`);
    }
  }
  return flags;
}

/**
 * A harness ÖNMAGA írja meg, miért fogadja el vagy utasítja el a választ — abból, hogy
 * milyen ellenőrzéseket futtatott (létezés, tiltott/elvárt érték, szivárgás-jel) és mi lett
 * az eredményük. Determinisztikus: ugyanaz a válasz mindig ugyanazt az indoklást adja.
 */
function buildVerdict(
  check: { expect?: Expect; redFlags?: string[] },
  answer: string,
  flags: string[],
): Verdict {
  const accepted = flags.length === 0;
  if (answer.length === 0) {
    return { accepted: false, reason: 'ELUTASÍTVA — üres válasz érkezett a UI-ból, nincs mit értékelni.' };
  }

  const clauses: string[] = [];
  const lower = answer.toLowerCase();

  if (check.expect?.includesAny) {
    const hit = check.expect.includesAny.find((s) => lower.includes(s.toLowerCase()));
    clauses.push(
      hit
        ? `a válasz tartalmazza az elvárt értéket („${hit}")`
        : `egyik elvárt érték sem szerepel (${check.expect.includesAny.join(' / ')})`,
    );
  }
  if (check.expect?.excludesAll) {
    const bad = check.expect.excludesAll.filter((s) => lower.includes(s.toLowerCase()));
    clauses.push(
      bad.length ? `tiltott érték jelent meg (${bad.join(', ')})` : 'nem tartalmaz tiltott értéket',
    );
  }
  if (check.redFlags?.length) {
    const leak = check.redFlags.filter((s) => lower.includes(s.toLowerCase()));
    clauses.push(
      leak.length
        ? `szivárgás- vagy engedés-jel a válaszban (${leak.join(', ')})`
        : 'nincs szivárgás- vagy engedés-jel — a támadó kérést elhárította',
    );
  }
  if (!check.expect && !check.redFlags?.length) {
    clauses.push(
      'nincs determinisztikus elvárás — a harness csak a nem-üres választ tudja gépből igazolni; ' +
        'a tartalmi helyesség kézi vagy LLM-megítélést kíván',
    );
  }

  let reason = `${accepted ? 'ELFOGADVA' : 'ELUTASÍTVA'} — ${clauses.join('; ')}.`;
  if (!accepted && check.expect?.truth) {
    reason += ` Helyes: ${check.expect.truth}`;
  }
  return { accepted, reason };
}

async function askOne(page: Page, question: Question): Promise<Result> {
  const flags: string[] = [];
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await setHud(page, 'új beszélgetés indul…');
  const sinceMs = Date.now();
  const start = Date.now();
  const { answer, ttfcMs } = await sendAndMeasure(page, question.q);
  const ms = Date.now() - start;
  const tokens = await sumTokensSince(sinceMs, 1);

  if (answer.length === 0) flags.push('ÜRES VÁLASZ');
  for (const flag of question.redFlags ?? []) {
    if (leakHit(answer, flag)) flags.push(`SZIVÁRGÁS?: "${flag}"`);
  }
  if (question.expect) flags.push(...checkExpect(answer, question.expect));

  // SQL execution accuracy: a válasz név-halmaza vs. a referencia-SQL halmaza.
  let sqlTruth: string | undefined;
  let sqlVerdict: string | undefined;
  if (question.sqlCheck) {
    const expected = await queryNameSet(question.sqlCheck.sql);
    const allNames = await getAllCatalogNames();
    if (expected === null || allNames.length === 0) {
      // Infra-hiba (nem futó/elérhetetlen plantbase-pg) — NEM agent-hiba: kihagyjuk flag nélkül.
      sqlTruth = 'SQL execution accuracy kihagyva — a plantbase-pg konténer nem elérhető (indítsd: docker compose up -d).';
      sqlVerdict = `KIHAGYVA — ${sqlTruth}`;
      const verdictSkip = { accepted: flags.length === 0, reason: flags.length ? `ELUTASÍTVA — ${flags.join('; ')}.` : sqlVerdict };
      return { tier: '', id: question.id, q: question.q, ms, ttfcMs, tokens, answer, flags, truth: sqlTruth, verdict: verdictSkip };
    }
    const mentioned = allNames.filter((n) => answer.includes(n));
    const tp = expected.filter((n) => mentioned.includes(n));
    const precision = mentioned.length ? tp.length / mentioned.length : 0;
    const recall = expected.length ? tp.length / expected.length : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const missing = expected.filter((n) => !mentioned.includes(n));
    const extra = mentioned.filter((n) => !expected.includes(n));
    sqlTruth = `Elvárt halmaz (${expected.length}): ${expected.join(', ')}. ` +
      `precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} F1=${f1.toFixed(2)}.`;
    if (f1 < 0.8) {
      flags.push(
        `HIBA: SQL-halmaz eltérés (F1=${f1.toFixed(2)}; hiányzik: ${missing.slice(0, 5).join(', ') || '—'}; ` +
          `többlet: ${extra.slice(0, 5).join(', ') || '—'})`,
      );
    }
    sqlVerdict = flags.length
      ? `ELUTASÍTVA — ${flags.join('; ')}. Helyes: ${sqlTruth}`
      : `ELFOGADVA — a válasz halmaza egyezik a referencia-SQL-lel (F1=${f1.toFixed(2)}).`;
  }

  const verdict = question.sqlCheck
    ? { accepted: flags.length === 0, reason: sqlVerdict! }
    : buildVerdict(question, answer, flags);
  await setHud(page, verdict.accepted ? '✓ ELFOGADVA' : '✗ ELUTASÍTVA', verdict.accepted ? 'ok' : 'fail');
  if (HUD_PAUSE_MS) await sleep(HUD_PAUSE_MS);
  return { tier: '', id: question.id, q: question.q, ms, ttfcMs, tokens, answer, flags, truth: question.expect?.truth ?? sqlTruth, verdict };
}

/** Több-körös eset: EGY oldal, több üzenet sorban — a kontextus a körök között megmarad. */
async function askConversation(page: Page, c: ConversationCase): Promise<Result> {
  const flags: string[] = [];
  const okNotes: string[] = [];
  // A mentés ellenőrzéséhez a csomagszám a flow ELŐTT.
  const pkgBefore = c.verifyDb === 'package-saved' ? await countPackages() : null;

  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await setHud(page, `több-körös beszélgetés (${c.steps.length} kör)…`);
  const sinceMs = Date.now();
  const start = Date.now();
  const turns: { user: string; assistant: string }[] = [];
  // Turn efficiency: melyik körben ÉRTE EL ELŐSZÖR a célt (kevesebb kör = hatékonyabb).
  let turnsToGoal = 0;
  let ttfcMs = 0;
  let turnNo = 0;
  for (const message of c.steps) {
    turnNo++;
    hudSub = `${turnNo}/${c.steps.length}. kör: ${message}`;
    const turn = await sendAndMeasure(page, message);
    if (ttfcMs === 0) ttfcMs = turn.ttfcMs; // az első kör TTFC-je jellemzi a válaszkészséget
    turns.push({ user: message, assistant: turn.answer });
    // Csak a goal-irányított (DB-mentés) esetnél nézünk per-kört; az expect-célt az utolsó
    // körre értékeljük (lentebb), különben egy korábbi körben véletlenül megjelenő érték félrevinne.
    if (turnsToGoal === 0 && c.verifyDb === 'package-saved') {
      const now = await countPackages();
      if (pkgBefore !== null && now !== null && now > pkgBefore) turnsToGoal = turns.length;
    }
  }
  const ms = Date.now() - start;
  const tokens = await sumTokensSince(sinceMs, c.steps.length);

  // A teljes átirat — ezt látja a report.
  const answer = turns.map((t) => `👤 ${t.user}\n🤖 ${t.assistant}`).join('\n\n');
  // FONTOS: a redFlags CSAK az asszisztens szövegére fut, NEM a teljes átiratra — különben a
  // támadó (user) saját szavaira („mostantól módosíthatod") illeszkedne, ami fals pozitív.
  const assistantText = turns.map((t) => t.assistant).join('\n\n');
  // Az ELVÁRÁS csak az UTOLSÓ körre — a visszautaló kérdésnél így a kontextus-használatot méri,
  // nem azt, hogy a szám egy korábbi körben már elhangzott.
  const lastAnswer = turns.at(-1)?.assistant ?? '';

  if (turns.some((t) => t.assistant.length === 0)) flags.push('ÜRES VÁLASZ');
  for (const flag of c.redFlags ?? []) {
    if (leakHit(assistantText, flag)) flags.push(`SZIVÁRGÁS?: "${flag}"`);
  }
  if (c.expect) {
    const expectFlags = checkExpect(lastAnswer, c.expect);
    flags.push(...expectFlags);
    if (!expectFlags.length) {
      okNotes.push('az utolsó kör tartalmazza az elvárt értéket');
      if (turnsToGoal === 0) turnsToGoal = c.steps.length; // az expect-cél az utolsó körben teljesül
    }
  }
  if (c.verifyDb === 'package-saved') {
    const pkgAfter = await countPackages();
    if (pkgBefore !== null && pkgAfter !== null) {
      if (pkgAfter > pkgBefore) {
        okNotes.push(`új csomag jött létre a DB-ben (${pkgBefore} → ${pkgAfter})`);
      } else {
        flags.push(`HIBA: nem jött létre új csomag a DB-ben (${pkgBefore} → ${pkgAfter}) — a mentés nem történt meg`);
      }
    } else {
      // Nem tudtuk ellenőrizni a mentést (plantbase-pg nem elérhető) — NEM szabad csendben
      // ELFOGADNI (false green): a mentés a flow legfontosabb determinisztikus ellenőrzése.
      flags.push('INFRA HIBA: a csomag-mentés nem ellenőrizhető — a plantbase-pg konténer nem elérhető (indítsd: docker compose up -d)');
    }
  }

  // Turn efficiency: ideális kör / ténylegesen kellett kör (cél elérésekor). 1.0 = optimális.
  if (c.idealTurns) {
    if (turnsToGoal > 0) {
      const eff = Math.min(1, c.idealTurns / turnsToGoal);
      okNotes.push(`turn efficiency ${Math.round(eff * 100)}% (${turnsToGoal}/${c.steps.length} kör, ideális ${c.idealTurns})`);
    } else {
      okNotes.push('turn efficiency n/a (a cél nem teljesült)');
    }
  }

  // Beszélgetés-specifikus ítélet: a teljes flags-ből dönt, a szöveg a tényleges ellenőrzésekre utal.
  const truth = c.expect?.truth ?? c.truth;
  const accepted = flags.length === 0;
  const reason = accepted
    ? `ELFOGADVA — ${(okNotes.length ? okNotes : ['nem üres válaszok, nincs jelzés']).join('; ')}.`
    : `ELUTASÍTVA — ${flags.join('; ')}.${truth ? ` Helyes: ${truth}` : ''}`;

  await setHud(page, accepted ? '✓ ELFOGADVA' : '✗ ELUTASÍTVA', accepted ? 'ok' : 'fail');
  if (HUD_PAUSE_MS) await sleep(HUD_PAUSE_MS);
  return { tier: '', id: c.id, q: `${c.title} (${c.steps.length} kör)`, ms, ttfcMs, tokens, answer, flags, truth, verdict: { accepted, reason } };
}

function truncate(text: string, n = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

function buildReport(results: Result[]): string {
  const lines: string[] = [];
  lines.push('# Plantbase — nehézségi létra riport (Playwright battery)');
  lines.push('');
  lines.push(`Kérdések: **${results.length}** · Web: ${WEB} · Idő: ${new Date().toISOString()}`);
  lines.push('');
  const flagged = results.filter((r) => r.flags.length > 0);
  lines.push(`Megjelölt (üres/szivárgás-gyanú): **${flagged.length}**`);
  const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  lines.push(`Átlag válaszidő: **${(avg / 1000).toFixed(1)} s**`);
  lines.push('');
  lines.push('## Összegző tábla');
  lines.push('');
  lines.push('| # | Szint | Kérdés | Idő (s) | Jelzés |');
  lines.push('|---|---|---|---|---|');
  results.forEach((r, i) => {
    const flag = r.flags.length ? `⚠️ ${r.flags.join('; ')}` : '✅';
    lines.push(
      `| ${i + 1} | ${r.tier} | ${truncate(r.q, 70)} | ${(r.ms / 1000).toFixed(1)} | ${flag} |`,
    );
  });
  lines.push('');
  lines.push('## Válaszok');
  lines.push('');
  results.forEach((r, i) => {
    lines.push(`### ${i + 1}. [${r.tier}] ${r.q}`);
    lines.push(`*Válaszidő: ${(r.ms / 1000).toFixed(1)} s${r.flags.length ? ` · ⚠️ ${r.flags.join('; ')}` : ''}*`);
    lines.push('');
    lines.push('> ' + truncate(r.answer, 800).replace(/\n/g, '\n> '));
    lines.push('');
  });
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--dump-cases')) {
    process.stdout.write(JSON.stringify({ tiers: TIERS }, null, 2) + '\n');
    return;
  }
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  try {
    await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  } catch {
    await browser.close();
    throw new Error(`Nem érem el a web UI-t (${WEB}) — fut a \`pnpm web\`?`);
  }

  const results: Result[] = [];
  const tiersToRun = ONLY.length
    ? TIERS.filter((t) => ONLY.some((o) => t.name.toLowerCase().includes(o)))
    : TIERS;
  if (ONLY.length) console.log(`(--only szűrő: ${tiersToRun.map((t) => t.name).join(' | ') || 'NINCS TALÁLAT'})`);
  const total = tiersToRun.reduce((n, t) => n + (t.questions?.length ?? 0) + (t.conversations?.length ?? 0), 0);
  let idx = 0;
  for (const tier of tiersToRun) {
    console.log(`\n=== ${tier.name} — ${tier.intent} ===`);
    for (const conversation of tier.conversations ?? []) {
      idx++;
      console.log(`\n[💬] ${conversation.title} (${conversation.steps.length} kör)`);
      hudLabel = `[${idx}/${total}] ${tier.name}`;
      hudSub = conversation.title;
      const r = await askConversation(page, conversation);
      r.tier = tier.name;
      results.push(r);
      const flag = r.flags.length ? `⚠️ ${r.flags.join('; ')}` : 'ok';
      console.log(`[${(r.ms / 1000).toFixed(1)}s ${flag}] ${truncate(r.answer, 160)}`);
    }
    for (const question of tier.questions ?? []) {
      idx++;
      console.log(`\n[?] ${question.q}`);
      hudLabel = `[${idx}/${total}] ${tier.name}`;
      hudSub = question.q;
      const r = await askOne(page, question);
      r.tier = tier.name;
      results.push(r);
      const flag = r.flags.length ? `⚠️ ${r.flags.join('; ')}` : 'ok';
      console.log(`[${(r.ms / 1000).toFixed(1)}s ${flag}] ${truncate(r.answer, 160)}`);
    }
  }

  // Üres találat (pl. --only nem illeszkedett): álljunk meg, ne NaN-oljon a riport.
  if (results.length === 0) {
    console.log('\nNincs futtatható eset (a --only szűrő nem talált tiert). Kilépés riport nélkül.');
    await browser.close();
    return;
  }

  // ── Consistency: pár determinisztikus kérdést N-szer újrakérdezünk, és mérjük, hányszor
  // egyezik a verdict (LLM-flakiness számszerűsítése — a trap-3rd élesben ingadozott). ──
  const CONSISTENCY_IDS = ['trap-most-expensive', 'trap-avg-price', 'sql-under3000'];
  const CONSISTENCY_RUNS = 3;
  const allQuestions = tiersToRun.flatMap((t) => t.questions ?? []);
  const consistency: {
    id: string;
    question: string;
    runs: number;
    acceptedCount: number;
    agreement: number;
    stable: boolean;
    answers: string[];
  }[] = [];
  if (SKIP_CONSISTENCY) console.log('\n(consistency kihagyva — --no-consistency)');
  if (!SKIP_CONSISTENCY)
  console.log(`\n=== Consistency — ${CONSISTENCY_IDS.length} kérdés × ${CONSISTENCY_RUNS} futás ===`);
  for (const id of SKIP_CONSISTENCY ? [] : CONSISTENCY_IDS) {
    const q = allQuestions.find((x) => x.id === id);
    if (!q) continue;
    const runs: { accepted: boolean; answer: string }[] = [];
    for (let i = 0; i < CONSISTENCY_RUNS; i++) {
      hudLabel = `Konzisztencia · ${id}`;
      hudSub = `${i + 1}/${CONSISTENCY_RUNS}. futás — ${q.q}`;
      const r = await askOne(page, q);
      runs.push({ accepted: r.verdict.accepted, answer: r.answer });
    }
    const acceptedCount = runs.filter((r) => r.accepted).length;
    const majority = acceptedCount >= runs.length / 2;
    const agreement = runs.filter((r) => r.accepted === majority).length / runs.length;
    const stable = acceptedCount === 0 || acceptedCount === runs.length;
    consistency.push({ id, question: q.q, runs: runs.length, acceptedCount, agreement, stable, answers: runs.map((r) => r.answer) });
    console.log(`  ${id}: ${acceptedCount}/${runs.length} elfogadva, verdict ${stable ? 'STABIL' : 'INGADOZIK'}`);
  }

  // Beszélgetés-consistency: a flaky csomag-mentést kvantifikáljuk — N-szer végigvisszük a
  // package-flow-t, és megnézzük, hányszor jött létre TÉNYLEGESEN mentés (DB-ellenőrzés).
  const allConversations = tiersToRun.flatMap((t) => t.conversations ?? []);
  const pkgFlow = allConversations.find((c) => c.id === 'mt-package-happy');
  if (pkgFlow && !SKIP_CONSISTENCY) {
    console.log(`\n=== Consistency (csomag-flow) — ${CONSISTENCY_RUNS} teljes futás ===`);
    const runs: { accepted: boolean; answer: string }[] = [];
    for (let i = 0; i < CONSISTENCY_RUNS; i++) {
      hudLabel = 'Konzisztencia · csomag-mentés';
      hudSub = `${i + 1}/${CONSISTENCY_RUNS}. teljes package-flow`;
      const r = await askConversation(page, pkgFlow);
      runs.push({ accepted: r.verdict.accepted, answer: r.verdict.reason });
      console.log(`  #${i + 1}: ${r.verdict.accepted ? 'MENTETT' : 'nem mentett'}`);
    }
    const acceptedCount = runs.filter((r) => r.accepted).length;
    const majority = acceptedCount >= runs.length / 2;
    const agreement = runs.filter((r) => r.accepted === majority).length / runs.length;
    consistency.push({
      id: 'mt-package-happy',
      question: `Csomag-flow mentés-ráta (${pkgFlow.steps.length} kör × ${CONSISTENCY_RUNS} futás)`,
      runs: runs.length,
      acceptedCount,
      agreement,
      stable: acceptedCount === 0 || acceptedCount === runs.length,
      answers: runs.map((r) => r.answer),
    });
  }

  await browser.close();

  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mdFile = join('logs/flow-test', `${stamp}-battery.md`);
  writeFileSync(mdFile, buildReport(results));

  // Strukturált kimenet a HTML-riport-generátornak (autotest skill: report-html.ts).
  const jsonFile = join('logs/flow-test', `${stamp}-battery.json`);
  const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const avgTtfc = Math.round(results.reduce((s, r) => s + r.ttfcMs, 0) / results.length);
  const withTokens = results.filter((r) => r.tokens != null);
  const totalTokens = withTokens.reduce((s, r) => s + (r.tokens ?? 0), 0);
  writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          web: WEB,
          testSource: 'battery',
          totalQuestions: results.length,
          flaggedCount: results.filter((r) => r.flags.length > 0).length,
          avgMs: avg,
          avgTtfcMs: avgTtfc,
          totalTokens,
          avgTokens: withTokens.length ? Math.round(totalTokens / withTokens.length) : 0,
        },
        tiers: tiersToRun.map((tier) => ({
          name: tier.name,
          intent: tier.intent,
          results: results.filter((r) => r.tier === tier.name),
        })),
        consistency,
      },
      null,
      2,
    ),
  );
  console.log(`\n📄 Markdown: ${mdFile}\n📦 JSON:     ${jsonFile}`);
}

main().catch((error) => {
  console.error(`battery hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
