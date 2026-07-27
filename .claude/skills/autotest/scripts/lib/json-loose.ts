// json-loose.ts — LLM-válaszból JSON kinyerése robusztusan. Külön modul, hogy TESZTELHETŐ legyen
// (a fő scriptek main()-t futtatnak importra). Itt élnek a korábban élesben talált parse-bugok
// javításai — ezekre van regressziós teszt a json-loose.spec.ts-ben.

/**
 * Laza JSON-parse: a modell néha prózát ír a JSON elé, ```json fence-be teszi, vagy szöveget fűz
 * utána. Kiegyensúlyozott, string-tudatos zárójel-illesztéssel vágjuk ki az első teljes [..]/{..}
 * blokkot. A LEGELÖL szereplő nyitó zárójelből indulunk — különben egy {"questions":[...]} alakból
 * a belső tömböt vágnánk ki (N1 bug: az answerRelevancy csendben 0-t adott).
 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json\s*|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* tovább a kivágásra */
  }
  const brackets = ([['[', ']'], ['{', '}']] as const).slice().sort((a, b) => {
    const ia = cleaned.indexOf(a[0]);
    const ib = cleaned.indexOf(b[0]);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  for (const [open, close] of brackets) {
    const start = cleaned.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]!;
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Tömbbé alakítás — a judge néha objektumba csomagolja a tömböt (pl. {"claims":[...]}). Ilyenkor
 * a bare-tömb feltételezés miatt minden állítás „nem támogatott"-ra esne (hamis noise=1.00), ezért
 * kibontjuk az első tömb-értékű mezőt.
 */
export function coerceArray<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === 'object') {
    const arr = Object.values(x as Record<string, unknown>).find((v) => Array.isArray(v));
    if (arr) return arr as T[];
  }
  return [];
}
