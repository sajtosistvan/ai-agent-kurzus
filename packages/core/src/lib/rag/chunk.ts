// chunk.ts — a DARABOLÁS. A RAG első döntése, és a leggyakrabban elrontott.
//
// MIÉRT NEM az egész dokumentumot embeddeljük?
//   - Egy vektor EGY jelentést hordoz. Egy 5000 karakteres cikk húsz dologról szól →
//     az "átlagvektora" egyikről sem szól rendesen ("jelentés-elmosódás").
//   - A találatot a modellnek is oda kell adni. Ha az egész cikk megy be, tele a kontextus
//     zajjal, és fizetsz érte minden kérdésnél.
//
// A SZABÁLY, amit követünk: a darabhatár SOHA ne vágjon ketté egy gondolatot.
// Ezért nem karakterre vágunk, hanem a SZERZŐ TAGOLÁSÁT követjük:
//   1. ALCÍMNÉL (## / ###) mindig új darab kezdődik — a szakasz egy gondolati egység,
//   2. a szakaszon belül BEKEZDÉSEKET pakolunk egymás mellé, amíg elférnek a méretkeretben.
// Ez a "szemantikus chunkolás" kézzelfogható formája: a tagolást a cikk írója már elvégezte,
// mi csak tiszteletben tartjuk.
//
// OVERLAP (átfedés): az utolsó bekezdést átvisszük a következő darabba. Miért? Mert a határon
// álló mondat kontextusa különben elveszne ("Ezt hetente ismételd." — mit is?).

export interface Chunk {
  /** A darab szövege — EZT embeddeljük, és ezt kapja majd a modell. */
  content: string;
  /** Hányadik darab a dokumentumban (0-tól) — a sorrend a hivatkozáshoz kell. */
  index: number;
}

export interface ChunkOptions {
  /** Cél-méret karakterben. ~1000 karakter ≈ 250 token ≈ egy jól fókuszált gondolat. */
  maxChars?: number;
  /** Átfedés: az előző darab utolsó bekezdése átjön ide is. */
  overlap?: boolean;
}

const DEFAULT_MAX_CHARS = 1000;

/** Egy túl hosszú bekezdést mondathatáron vágunk — ez a vészfék, nem az alapeset. */
function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence + ' ';
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Markdown dokumentum → darabok. Bekezdés-határon vág, cél-méretig pakol, egy bekezdésnyit átfed.
 * A markdown front matter (--- ... ---) és a címsorok a hívó dolga (a hívó: apps/cli/src/ingest-knowledge.ts).
 */
export function chunkMarkdown(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = options.overlap ?? true;

  // A markdown bekezdései: üres sor választja el őket. Ez a "szerző által adott" tagolás.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .flatMap((p) =>
      p.length > maxChars ? splitLongParagraph(p, maxChars) : [p],
    );

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    chunks.push({ content: current.join('\n\n'), index: chunks.length });
    // Átfedés: az utolsó bekezdés átjön a következő darabba is.
    const last = current[current.length - 1];
    current = overlap && last && current.length > 1 ? [last] : [];
    currentLength = current.reduce((sum, p) => sum + p.length, 0);
  };

  for (const paragraph of paragraphs) {
    const isHeading = paragraph.startsWith('#');
    // Alcímnél új darabot kezdünk (a szakasz elejét ne ragasszuk az előző szakasz végéhez),
    // és ilyenkor átfedést sem viszünk át — új gondolat kezdődik.
    if (isHeading && current.length > 0) {
      chunks.push({ content: current.join('\n\n'), index: chunks.length });
      current = [];
      currentLength = 0;
    }
    if (currentLength + paragraph.length > maxChars) {
      flush();
    }
    current.push(paragraph);
    currentLength += paragraph.length;
  }
  flush();

  return chunks;
}
