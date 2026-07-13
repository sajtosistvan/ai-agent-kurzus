import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from './chunk.js';

// A chunkolás az egyetlen RAG-lépés, ami tisztán determinisztikus — ezért tesztelhető.
// (Az embedding és a rerank hálózatot és modellt hív; azokat nem itt ellenőrizzük.)

const paragraph = (text: string, length: number): string =>
  text.repeat(Math.ceil(length / text.length)).slice(0, length);

describe('chunkMarkdown', () => {
  it('a rövid dokumentumot egyben hagyja', () => {
    const chunks = chunkMarkdown('Egy bekezdés.\n\nEgy másik bekezdés.');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Egy másik bekezdés.');
  });

  it('bekezdés-határon vág, nem a karakterlimitnél', () => {
    const first = paragraph('alma ', 600);
    const second = paragraph('körte ', 600);

    const chunks = chunkMarkdown(`${first}\n\n${second}`, { maxChars: 1000 });

    expect(chunks.length).toBeGreaterThan(1);
    // A vágás nem szakíthat félbe bekezdést: az első darab a teljes első bekezdés.
    expect(chunks[0]?.content.trim()).toBe(first.trim());
  });

  it('átfedéssel viszi tovább az előző bekezdést', () => {
    const a = paragraph('a ', 400);
    const b = paragraph('b ', 400);
    const c = paragraph('c ', 400);

    const chunks = chunkMarkdown(`${a}\n\n${b}\n\n${c}`, {
      maxChars: 900,
      overlap: true,
    });

    // A második darab a HATÁRON álló bekezdéssel kezdődik (b), hogy ne vesszen el a kontextusa.
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.content).toContain(b.trim().slice(0, 20));
    expect(chunks[1]?.content).toContain(c.trim().slice(0, 20));
  });

  it('átfedés nélkül nem ismétel', () => {
    const a = paragraph('a ', 400);
    const b = paragraph('b ', 400);
    const c = paragraph('c ', 400);

    const chunks = chunkMarkdown(`${a}\n\n${b}\n\n${c}`, {
      maxChars: 900,
      overlap: false,
    });

    const combined = chunks.map((chunk) => chunk.content).join('');
    // Minden bekezdés PONTOSAN egyszer szerepel.
    expect(combined.length).toBeLessThanOrEqual(a.length + b.length + c.length + 10);
  });

  it('a túl hosszú bekezdést mondathatáron vágja (vészfék)', () => {
    const long = 'Ez egy mondat. '.repeat(200); // ~3000 karakter, egyetlen bekezdés

    const chunks = chunkMarkdown(long, { maxChars: 500 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(700); // limit + átfedés tűrés
    }
  });

  it('sorszámozza a darabokat a dokumentumon belül', () => {
    const chunks = chunkMarkdown(
      [paragraph('x ', 500), paragraph('y ', 500), paragraph('z ', 500)].join('\n\n'),
      { maxChars: 600 },
    );

    expect(chunks.map((chunk) => chunk.index)).toEqual(
      chunks.map((_, index) => index),
    );
  });
});
