import { executeAskInfoAgent } from './ask-info-agent-tool.js';
import type { AskResult } from '../../agents/agent-loop.js';

// Az info-agentet (query-agent) nem futtatjuk élesben (LLM + DB); injektált fake runnerrel
// teszteljük, hogy a tool helyesen delegál, a role/print/onToolEvent opciókat továbbadja,
// és soha nem dob — a hiba is magyar ToolOutcome.

const fakeResult = (answer: string): AskResult => ({
  answer, messages: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'stop', tracePath: '/tmp/t.json',
});

describe('executeAskInfoAgent', () => {
  it('lefuttatja az info-agentet és a válaszát adja vissza', async () => {
    const out = await executeAskInfoAgent(
      { question: 'Hány pet-safe növény van 10 000 Ft alatt?' },
      { run: async (q) => fakeResult(`4 találat a kérdésre: ${q}`) },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toContain('4 találat');
    expect(out.summary).toContain('info-agent');
  });

  it('üres kérdés → hiba, a runner NEM fut', async () => {
    let ran = false;
    const out = await executeAskInfoAgent(
      { question: ' ' },
      { run: async () => { ran = true; return fakeResult('x'); } },
    );
    expect(out.isError).toBe(true);
    expect(ran).toBe(false);
  });

  it('a beágyazott agent hibája → magyar ToolOutcome, nem exception', async () => {
    const out = await executeAskInfoAgent(
      { question: 'mi?' },
      { run: async () => { throw new Error('modell nem elérhető'); } },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('modell nem elérhető');
  });

  it('a print és az onToolEvent opciót továbbadja a runnernek', async () => {
    let received: unknown = null;
    const reporter = () => undefined;
    await executeAskInfoAgent(
      { question: 'mi?' },
      { run: async (_q, options) => { received = options; return fakeResult('x'); }, print: false, onToolEvent: reporter },
    );
    expect(received).toMatchObject({ role: 'customer', print: false });
    expect((received as { onToolEvent?: unknown }).onToolEvent).toBe(reporter);
  });
});
