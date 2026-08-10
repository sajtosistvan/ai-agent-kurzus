import { MDocument } from '@mastra/rag';
import { beagyazKoteget } from './beagyazas.js';
import {
  getVektortar,
  letrehozTudasbazisIndex,
  TUDASBAZIS_INDEX,
} from './vektortar.js';

// tudasbazis-feltoltes.ts — a RAG "beviteli" oldala: dokumentum → darabok → vektorok → tár.
//
// A DARABOLÁS (chunking) a RAG első döntése, és a leggyakrabban elrontott. Miért nem az egész
// cikket ágyazzuk be? Mert egy vektor EGY jelentést hordoz: egy 5000 karakteres cikk húsz
// dologról szól, az "átlagvektora" egyikről sem szól rendesen. És a találatot a modellnek is
// oda kell adni — ha az egész cikk megy be, tele a kontextus zajjal, és fizetsz érte.
//
// A darabolást már NEM MI írjuk: a Mastra `MDocument` + `.chunk({ strategy: 'markdown' })`
// pontosan azt csinálja, amit a régi kézi chunkolónk: a SZERZŐ TAGOLÁSÁT követi (címsorok,
// bekezdések), méretkeretig pakol, és átfedést hagy a darabok között.

/** Egy betöltendő dokumentum (a hívó olvassa be fájlból — lásd apps/cli/src/ingest-knowledge.ts). */
export interface TudasDokumentum {
  /** A cikk URL-je — EZT idézi vissza az agent (grounding). */
  forras: string;
  cim: string;
  kategoria: string;
  /** A markdown törzse, fejléc (front matter) nélkül. */
  szoveg: string;
}

export interface TudasDarab {
  id: string;
  szoveg: string;
  metaadat: Record<string, unknown>;
}

/** Cél-méret karakterben. ~1000 karakter ≈ 250 token ≈ egy jól fókuszált gondolat. */
const MAX_MERET = 1000;
/** Átfedés: enélkül a határon álló mondat kontextusa elveszne ("Ezt hetente ismételd." — mit is?). */
const ATFEDES = 200;
/** Ennyi darabot ágyazunk be egy API-hívásban. */
const KOTEG_MERET = 100;

/** Egy dokumentum → darabok, stabil azonosítóval és metaadattal (a szöveg a `text` mezőben). */
export async function darabolDokumentumot(
  dokumentum: TudasDokumentum,
): Promise<TudasDarab[]> {
  const doc = MDocument.fromMarkdown(dokumentum.szoveg);
  const darabok = await doc.chunk({
    strategy: 'markdown',
    maxSize: MAX_MERET,
    overlap: ATFEDES,
  });

  return darabok.map((darab, index) => ({
    // Stabil azonosító: újra-feltöltéskor felülírja önmagát (ON CONFLICT vector_id).
    id: `${dokumentum.forras || dokumentum.cim}#${index}`,
    szoveg: darab.text,
    metaadat: {
      // A PgVector-nak nincs külön tartalom-oszlopa: a chunk szövege a metaadatban lakik.
      text: darab.text,
      source: dokumentum.forras,
      title: dokumentum.cim,
      category: dokumentum.kategoria,
      chunkIndex: index,
    },
  }));
}

/** Teljes újraépítés első lépése: az index ürítése (kis korpusznál ez a helyes stratégia). */
export async function uritTudasbazist(): Promise<void> {
  await letrehozTudasbazisIndex();
  await getVektortar().truncateIndex({ indexName: TUDASBAZIS_INDEX });
}

/**
 * Darabok beágyazása kötegelten + beírása a vektortárba.
 * A `haladas` visszahívással a hívó ki tudja írni, hol tart — a logolás az ő dolga.
 */
export async function feltoltDarabokat(
  darabok: TudasDarab[],
  haladas?: (kesz: number, osszes: number) => void,
): Promise<number> {
  await letrehozTudasbazisIndex();
  const vektortar = getVektortar();

  let beirt = 0;
  for (let i = 0; i < darabok.length; i += KOTEG_MERET) {
    const koteg = darabok.slice(i, i + KOTEG_MERET);
    const vektorok = await beagyazKoteget(koteg.map((d) => d.szoveg));
    await vektortar.upsert({
      indexName: TUDASBAZIS_INDEX,
      vectors: vektorok,
      metadata: koteg.map((d) => d.metaadat),
      ids: koteg.map((d) => d.id),
    });
    beirt += koteg.length;
    haladas?.(beirt, darabok.length);
  }
  return beirt;
}
