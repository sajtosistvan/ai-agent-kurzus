import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  darabolDokumentumot,
  feltoltDarabokat,
  uritTudasbazist,
  zarVektortar,
  type TudasDarab,
  type TudasDokumentum,
} from '@plantbase/core';

// ingest-knowledge.ts — A TUDÁSBÁZIS FELÉPÍTÉSE. Futtatás: `pnpm knowledge:ingest`
//
// A teljes pipeline, négy lépésben — pontosan az, amit egy RAG-rendszer üzemeltetése jelent:
//   1. BEOLVAS   — seed/knowledge/*.md (letöltött gondozási cikkek, forrás-URL a fejlécben)
//   2. DARABOL   — Mastra MDocument.chunk({ strategy: 'markdown' })
//   3. VEKTORIZÁL— OpenAI text-embedding-3-small, kötegelten
//   4. BEÍR      — Mastra PgVector `tudasbazis` index (ugyanaz a Postgres)
//
// FRISSÍTÉS: a tudásbázis nem statikus. A bolt holnap ír egy új cikket, átírja a régit —
// ettől a te vektoraid még a tegnapi igazságot mondják. A legegyszerűbb stratégia (és amit itt
// használunk): teljes újraépítés (ürítés + újratöltés). Kis korpusznál ez a helyes válasz.

const KNOWLEDGE_DIR = join(process.cwd(), 'seed', 'knowledge');

// A cikkek végén bolti zaj van (termék-ajánló blokk, szerzői aláírás). Ez NEM tudás —
// ha bekerülne a tudásbázisba, a keresés termékreklámot találna a gondozási kérdésre.
// A valós korpusz tisztítása a RAG munka javát teszi ki; ez a leggyakoribb fajtája.
const SHOP_NOISE_HEADINGS =
  /\n#+\s*(Perfect Pairings|Words By The Sill|Shop |Related Posts)[\s\S]*$/i;

function stripShopNoise(body: string): string {
  return body.replace(SHOP_NOISE_HEADINGS, '').trim();
}

/** A markdown fejléc (front matter) kiolvasása: innen jön a forrás-URL és a cím. */
function parseDocument(
  markdown: string,
  fallbackTitle: string,
): TudasDokumentum {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return {
      forras: '',
      cim: fallbackTitle,
      kategoria: 'egyéb',
      szoveg: markdown,
    };
  }

  const [, frontMatter, body] = match;
  const field = (name: string): string =>
    frontMatter?.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';

  return {
    forras: field('source'),
    cim: field('title') || fallbackTitle,
    kategoria: field('category') || 'egyéb',
    szoveg: stripShopNoise(body ?? ''),
  };
}

async function main(): Promise<void> {
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  console.log(
    `1) BEOLVASÁS — ${files.length} dokumentum a seed/knowledge mappából`,
  );

  // 1-2. Beolvasás + darabolás (Mastra MDocument).
  const darabok: TudasDarab[] = [];
  for (const file of files) {
    const raw = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8');
    const doc = parseDocument(raw, file.replace('.md', ''));
    darabok.push(...(await darabolDokumentumot(doc)));
  }

  const avgChars = Math.round(
    darabok.reduce((sum, d) => sum + d.szoveg.length, 0) / darabok.length,
  );
  console.log(
    `2) DARABOLÁS — ${darabok.length} chunk (átlag ${avgChars} karakter, ~${Math.round(avgChars / 4)} token)`,
  );

  // 3-4. Vektorizálás kötegelten + beírás. Előtte ürítünk (teljes újraépítés).
  await uritTudasbazist();
  console.log(
    '3) VEKTORIZÁLÁS — kötegelten (OpenAI text-embedding-3-small) → PgVector',
  );

  const written = await feltoltDarabokat(darabok, (kesz, osszes) => {
    process.stdout.write(`   ${kesz}/${osszes} chunk vektorizálva\r`);
  });

  console.log(`\n4) KÉSZ — ${written} chunk a "tudasbazis" indexben.`);
  console.log('   Nézd meg: GET http://localhost:3001/debug/knowledge/sources');
  await zarVektortar();
}

main().catch(async (error: unknown) => {
  console.error(
    'Ingest hiba:',
    error instanceof Error ? error.message : error,
  );
  await zarVektortar();
  process.exit(1);
});
