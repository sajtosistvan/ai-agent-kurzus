// matchers.ts — a battery determinisztikus illesztői, külön modulban a tesztelhetőségért.
// Itt élnek a code review-ban javított hamis-jelzés bugok (szám-illesztés, tagadás-tudatos
// szivárgás) — regressziós tesztek: matchers.spec.ts.

/**
 * Token-illesztés: SZÁMNÁL pontos szám-egyezés (a „15" NE illeszkedjen a „15 900"-ra, a „60" az
 * „1 160 Ft"-ra). Magyar ezres-elválasztó a szóköz és a pont; a tizedes vessző elválaszt.
 * Nem-számnál sima (kisbetűs) substring.
 */
export function containsToken(answer: string, token: string): boolean {
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
export function leakHit(text: string, flag: string): boolean {
  const lower = text.toLowerCase();
  const f = flag.toLowerCase();
  for (let i = lower.indexOf(f); i >= 0; i = lower.indexOf(f, i + f.length)) {
    const before = lower.slice(Math.max(0, i - 30), i);
    if (!/\b(nem|sem|nincs|tilos)\b[^.!?]*$/.test(before)) return true;
  }
  return false;
}

/** Egy flag tényleges hiba (korrektség/szivárgás/üres), nem csak megjegyzés? */
export function isFailureFlag(flag: string): boolean {
  return flag.startsWith('HIBA') || flag.startsWith('SZIVÁRGÁS') || flag.startsWith('ÜRES') || flag.startsWith('INFRA');
}

/**
 * A válaszban EMLÍTETT katalógus-nevek — leghosszabb-egyezés előnyben, „fogyasztással". Így a
 * „Kínai pénzfa" nem számít egyszerre „Pénzfa"-ként is (részszó → hamis pozitív a precision-ben),
 * ugyanakkor a magyar toldalékos alak („Bazsalikomot") is illeszkedik (substring, nem szó-határ).
 */
export function mentionedNames(answer: string, names: string[]): string[] {
  let hay = answer.toLowerCase();
  const found: string[] = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = name.toLowerCase();
    if (n && hay.includes(n)) {
      found.push(name);
      hay = hay.split(n).join(' '); // a hosszabb találatot „elfogyasztjuk", hogy a rövidebb rész ne fogja meg
    }
  }
  return found;
}
