import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// evaluate.ts — a flow-test trace értékelése. KÉT rétegben:
//   1. DETERMINISZTIKUS assertek a data-partokból (jó agent; validate a save előtt; a flow
//      nem zárult jelzés nélkül) — ezek buknak keményen (exit 1).
//   2. LLM-értékelés a puha szempontokra (visszaterelés minősége, kérdés-sorrend) + javítási
//      javaslatok a promptokra/toolokra.
// Több log-fájllal hívva módonként csoportosított ÖSSZEVETŐ riportot ad.

interface TraceFile {
  scenario: string;
  mode: string;
  expectations: Record<string, unknown>;
  turns: { user: string; assistant: string; dataParts: { type: string; data: unknown }[] }[];
}

interface ToolEvent { toolName?: string; targetAgent?: string; isError?: boolean }

function toolEvents(trace: TraceFile): ToolEvent[] {
  return trace.turns.flatMap((t) =>
    t.dataParts.filter((p) => p.type === 'data-tool').map((p) => p.data as ToolEvent),
  );
}

function agentsSeen(trace: TraceFile): string[] {
  return [...new Set(
    trace.turns.flatMap((t) =>
      t.dataParts.filter((p) => p.type === 'data-agent').map((p) => (p.data as { agent: string }).agent),
    ),
  )];
}

function assertTrace(trace: TraceFile): string[] {
  const failures: string[] = [];
  const events = toolEvents(trace);
  const e = trace.expectations;
  const names = events.filter((ev) => !ev.isError).map((ev) => ev.toolName);
  const seen = agentsSeen(trace);

  for (const agent of (e['expectAgents'] as string[] | undefined) ?? []) {
    if (!seen.includes(agent)) failures.push(`nem kapta meg a labdát a(z) ${agent} agent (látott: ${seen.join(', ') || 'senki'})`);
  }
  if (e['expectSave'] === true && !names.includes('savePackage')) failures.push('nem történt sikeres savePackage');
  if (e['expectSave'] === false && names.includes('savePackage')) failures.push('savePackage történt, pedig nem kellett volna');
  if (e['expectCancel'] === true && !names.includes('cancelPackage')) failures.push('nem történt cancelPackage');
  if (e['expectValidateBeforeSave'] === true) {
    const vi = names.indexOf('validatePackage');
    const si = names.indexOf('savePackage');
    if (si !== -1 && (vi === -1 || vi > si)) failures.push('a savePackage előtt nem futott sikeres validatePackage');
  }
  if (e['expectValidationError'] === true && !events.some((ev) => ev.toolName === 'validatePackage' && ev.isError)) {
    failures.push('nem volt hibás validatePackage (visszalépést vártunk)');
  }
  if (e['expectLockHold'] === true) {
    // A lock tartása: miután a routeTo package-re nyitott, minden KÉSŐBBI routeTo is package.
    let opened = false;
    for (const ev of events) {
      if (ev.toolName !== 'routeTo') continue;
      if (ev.targetAgent === 'package') opened = true;
      else if (opened && ev.targetAgent === 'info') failures.push('a flow-lock kiengedett: nyitott flow közben info-agenthez routolt');
    }
  }
  // Univerzális szabály: ha a flow megnyílt, csak jelzéssel zárulhatott (vagy nyitva maradt).
  const openedFlow = events.some((ev) => ev.toolName === 'routeTo' && ev.targetAgent === 'package');
  const closedFlow = names.includes('savePackage') || names.includes('cancelPackage');
  if (openedFlow && !closedFlow && trace.expectations['expectSave'] === true) {
    failures.push('a flow nyitva maradt, pedig mentést vártunk');
  }
  return failures;
}

async function softReview(trace: TraceFile): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return '(LLM-értékelés kihagyva: nincs ANTHROPIC_API_KEY)';
  const anthropic = createAnthropic({ apiKey });
  const transcript = trace.turns.map((t) => `U: ${t.user}\nA: ${t.assistant}`).join('\n\n');
  const { text } = await generateText({
    model: anthropic(process.env['FLOW_TEST_USER_MODEL'] ?? 'claude-haiku-4-5'),
    system:
      'Egy csomag-összeállító chat-agent beszélgetését értékeled magyarul, tömören. Szempontok: ' +
      '(1) egyszerre egy kérdés, jó sorrendben? (2) előtöltött javaslatok az ügyfél-profilból? ' +
      '(3) témától eltérésnél kedves, határozott visszaterelés? (4) mentés előtt megerősítés? ' +
      'Végül adj 1-3 KONKRÉT javítási javaslatot a promptra vagy a toolokra.',
    prompt: transcript,
  });
  return text;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Használat: evaluate.ts <logs/flow-test/*.json>');
    process.exit(1);
  }
  let failed = false;
  const byMode = new Map<string, { name: string; failures: string[]; turnCount: number }[]>();
  for (const file of files) {
    const trace = JSON.parse(readFileSync(file, 'utf8')) as TraceFile;
    const failures = assertTrace(trace);
    failed ||= failures.length > 0;
    const rows = byMode.get(trace.mode) ?? [];
    rows.push({ name: trace.scenario, failures, turnCount: trace.turns.length });
    byMode.set(trace.mode, rows);
    console.log(`\n=== ${trace.scenario} [${trace.mode}] — ${failures.length === 0 ? 'OK' : 'HIBA'} ===`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log(await softReview(trace));
  }
  if (byMode.size > 1) {
    console.log('\n=== ÖSSZEVETÉS módonként ===');
    for (const [mode, rows] of byMode) {
      const ok = rows.filter((r) => r.failures.length === 0).length;
      console.log(`${mode}: ${ok}/${rows.length} forgatókönyv zöld · átlag körszám: ${(rows.reduce((s, r) => s + r.turnCount, 0) / rows.length).toFixed(1)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`evaluate hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
