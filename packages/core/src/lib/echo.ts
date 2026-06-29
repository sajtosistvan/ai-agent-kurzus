// B1 — echo: a legegyszerűbb "válasz" még LLM nélkül. A CLI ezt hívja a bemenetre.
// A B2-ben ezt váltja le az askAgent (LLM), a B3-ban a runSql-es agent.
// Tiszta, mellékhatás nélküli függvény, hogy egységgel tesztelhető legyen.

export function echo(input: string): string {
  const trimmed = input.trim();
  return `echo: ${trimmed === '' ? '(üres bemenet)' : trimmed}`;
}
