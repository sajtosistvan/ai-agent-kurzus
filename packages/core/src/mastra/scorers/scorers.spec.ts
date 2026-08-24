import type { ScorerRunOutputForAgent } from '@mastra/core/evals';

import { csakOlvasoUtScorer } from './csak-olvaso-ut-scorer.js';
import { katalogusFedettsegScorer } from './katalogus-fedettseg-scorer.js';
import { magyarValaszScorer } from './magyar-valasz-scorer.js';
import { ragHivatkozasScorer } from './rag-hivatkozas-scorer.js';

// A determinisztikus scorerek tesztjei — modellhívás nélkül futnak, ezért CI-ben is mehetnek.
// Az LLM-judge scorer (hasznossag-judge) szándékosan nincs itt: az modellt hívna.

/** Minimális asszisztens-üzenet a scorereknek: szöveg + opcionális tool-hívások. */
const valasz = (
  szoveg: string,
  toolok: { nev: string; eredmeny?: unknown }[] = [],
): ScorerRunOutputForAgent =>
  [
    {
      id: 'uzenet-1',
      role: 'assistant',
      createdAt: new Date(0),
      content: {
        format: 2,
        parts: [
          ...toolok.map((tool) => ({
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: `hivas-${tool.nev}`,
              toolName: tool.nev,
              args: {},
              result: tool.eredmeny,
            },
          })),
          { type: 'text', text: szoveg },
        ],
      },
    },
  ] as unknown as ScorerRunOutputForAgent;

describe('magyarValaszScorer', () => {
  it('should give 1 for a Hungarian answer', async () => {
    const eredmeny = await magyarValaszScorer.run({
      output: valasz('A Monstera félárnyékot szeret, és nem szereti a túlöntözést.'),
    });

    expect(eredmeny.score).toBe(1);
  });

  it('should give 0 for an English answer', async () => {
    const eredmeny = await magyarValaszScorer.run({
      output: valasz('Monstera prefers indirect light. Do not overwater.'),
    });

    expect(eredmeny.score).toBe(0);
  });
});

describe('katalogusFedettsegScorer', () => {
  it('should give 1 when the price comes from the tool result', async () => {
    const eredmeny = await katalogusFedettsegScorer.run({
      output: valasz('A Monstera ára 4 990 Ft.', [
        { nev: 'katalogus_sql', eredmeny: { sorok: [{ name: 'Monstera', price: 4990 }] } },
      ]),
    });

    expect(eredmeny.score).toBe(1);
  });

  it('should give 0 for a price that is nowhere in the tool result', async () => {
    const eredmeny = await katalogusFedettsegScorer.run({
      output: valasz('A Monstera ára 12 000 Ft.', [
        { nev: 'katalogus_sql', eredmeny: { sorok: [{ name: 'Monstera', price: 4990 }] } },
      ]),
    });

    expect(eredmeny.score).toBe(0);
  });

  it('should give 1 when the answer states no price at all', async () => {
    const eredmeny = await katalogusFedettsegScorer.run({
      output: valasz('A Monstera félárnyékot szeret.'),
    });

    expect(eredmeny.score).toBe(1);
  });
});

describe('ragHivatkozasScorer', () => {
  it('should give 1 when the answer names the source', async () => {
    const eredmeny = await ragHivatkozasScorer.run({
      output: valasz('Az öntözési útmutató szerint hetente egyszer elég. Forrás: ontozes-alapok.md', [
        { nev: 'tudasbazis_kereses', eredmeny: { talalatok: [{ forras: 'ontozes-alapok.md' }] } },
      ]),
    });

    expect(eredmeny.score).toBe(1);
  });

  it('should give 0 when there was a hit but no reference', async () => {
    const eredmeny = await ragHivatkozasScorer.run({
      output: valasz('Hetente egyszer elég megöntözni.', [
        { nev: 'tudasbazis_kereses', eredmeny: { talalatok: [{ forras: 'ontozes-alapok.md' }] } },
      ]),
    });

    expect(eredmeny.score).toBe(0);
  });

  it('should give 1 when no knowledge-base tool ran', async () => {
    const eredmeny = await ragHivatkozasScorer.run({
      output: valasz('Hetente egyszer elég megöntözni.'),
    });

    expect(eredmeny.score).toBe(1);
  });
});

describe('csakOlvasoUtScorer', () => {
  it('should give 1 when only read-only tools ran', async () => {
    const eredmeny = await csakOlvasoUtScorer.run({
      output: valasz('Íme három növény.', [{ nev: 'katalogus_sql', eredmeny: { sorok: [] } }]),
    });

    expect(eredmeny.score).toBe(1);
  });

  it('should give 0 when a writing tool ran (NFR1 violation)', async () => {
    const eredmeny = await csakOlvasoUtScorer.run({
      output: valasz('Mentettem.', [{ nev: 'termek_mentes', eredmeny: { sikeres: true } }]),
    });

    expect(eredmeny.score).toBe(0);
  });
});
