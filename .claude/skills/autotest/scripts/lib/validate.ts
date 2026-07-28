// validate.ts — könnyű, fail-fast validáció a KÜLSŐ case-JSON-okra (Zod nélkül, mert az nem
// oldható fel ezekből a szkriptekből). A cél: egy elgépelt kulcs (pl. `redFlag` a `redFlags`
// helyett) NE csússzon át némán ellenőrizetlen esetként — beszédes hibával álljunk meg.

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`case-validáció: ${msg}`);
}

function asObj(x: unknown, ctx: string): Record<string, unknown> {
  assert(x && typeof x === 'object' && !Array.isArray(x), `${ctx}: objektum várt`);
  return x as Record<string, unknown>;
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], ctx: string): void {
  for (const k of Object.keys(obj)) {
    assert(allowed.includes(k), `ismeretlen kulcs "${k}" itt: ${ctx} — elgépelés? (engedélyezett: ${allowed.join(', ')})`);
  }
}

const EXPECT_KEYS = ['includesAny', 'excludesAll', 'truth'] as const;
const QUESTION_KEYS = ['id', 'q', 'redFlags', 'expect', 'sqlCheck'] as const;
const CONV_KEYS = ['id', 'title', 'steps', 'redFlags', 'expect', 'verifyDb', 'truth', 'idealTurns'] as const;
const TIER_KEYS = ['name', 'intent', 'questions', 'conversations'] as const;

/** A battery-cases.json validálása. Visszaadja az inputot (a hívó biztonságosan castolhat). */
export function validateBatteryCases<T>(raw: unknown): T {
  const root = asObj(raw, 'battery-cases.json');
  assert(Array.isArray(root['tiers']), 'battery-cases.json: hiányzó vagy hibás "tiers" tömb');
  for (const rawTier of root['tiers'] as unknown[]) {
    const t = asObj(rawTier, 'tier');
    checkKeys(t, TIER_KEYS, 'tier');
    assert(typeof t['name'] === 'string' && typeof t['intent'] === 'string', 'tier: name/intent kötelező');
    for (const rawQ of (t['questions'] as unknown[]) ?? []) {
      const q = asObj(rawQ, 'kérdés');
      checkKeys(q, QUESTION_KEYS, `kérdés "${String(q['id'])}"`);
      assert(q['id'] && q['q'], `kérdés: id/q kötelező (${JSON.stringify(rawQ).slice(0, 60)})`);
      if (q['expect']) checkKeys(asObj(q['expect'], 'expect'), EXPECT_KEYS, `expect "${String(q['id'])}"`);
    }
    for (const rawC of (t['conversations'] as unknown[]) ?? []) {
      const c = asObj(rawC, 'beszélgetés');
      checkKeys(c, CONV_KEYS, `beszélgetés "${String(c['id'])}"`);
      assert(
        c['id'] && c['title'] && Array.isArray(c['steps']) && (c['steps'] as unknown[]).length > 0,
        `beszélgetés: id/title/steps kötelező (${String(c['id'])})`,
      );
      if (c['expect']) checkKeys(asObj(c['expect'], 'expect'), EXPECT_KEYS, `expect "${String(c['id'])}"`);
    }
  }
  return raw as T;
}

/** A rag-cases.json validálása. */
export function validateRagCases<T>(raw: unknown): T {
  const root = asObj(raw, 'rag-cases.json');
  assert(Array.isArray(root['cases']), 'rag-cases.json: hiányzó vagy hibás "cases" tömb');
  for (const rawCase of root['cases'] as unknown[]) {
    const c = asObj(rawCase, 'rag-eset');
    checkKeys(c, ['id', 'question', 'groundTruth'], `rag-eset "${String(c['id'])}"`);
    assert(c['id'] && c['question'] && c['groundTruth'], `rag-eset: id/question/groundTruth kötelező (${String(c['id'])})`);
  }
  return raw as T;
}
