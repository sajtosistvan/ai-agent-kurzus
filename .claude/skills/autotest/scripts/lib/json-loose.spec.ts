import { describe, expect, it } from 'vitest';
import { coerceArray, parseJsonLoose } from './json-loose.js';

describe('parseJsonLoose', () => {
  it('tiszta JSON-t parse-ol', () => {
    expect(parseJsonLoose('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('```json fence-t leszed', () => {
    expect(parseJsonLoose('```json\n{"x":true}\n```')).toEqual({ x: true });
  });
  it('prózát a JSON előtt/után tűr', () => {
    expect(parseJsonLoose('Íme: [{"ok":true}] — ennyi.')).toEqual([{ ok: true }]);
  });
  it('N1 regresszió: {"questions":[...]} alaknál az OBJEKTUMOT adja, nem a belső tömböt', () => {
    const out = parseJsonLoose('Válasz: {"questions": ["a", "b"]} vége') as { questions?: string[] };
    expect(out.questions).toEqual(['a', 'b']);
  });
  it('értelmezhetetlen szövegre null', () => {
    expect(parseJsonLoose('nincs itt json')).toBeNull();
  });
});

describe('coerceArray', () => {
  it('a tömböt változatlanul adja vissza', () => {
    expect(coerceArray([1, 2])).toEqual([1, 2]);
  });
  it('objektumba csomagolt tömböt kibont (hamis noise=1.0 gyökéroka)', () => {
    expect(coerceArray({ claims: [{ supported: true }] })).toEqual([{ supported: true }]);
  });
  it('tömb-érték nélküli inputra üres tömb', () => {
    expect(coerceArray({ a: 1 })).toEqual([]);
    expect(coerceArray(null)).toEqual([]);
  });
});
