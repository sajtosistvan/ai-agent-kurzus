import { executeDelegateToIngest, type IngestRunner } from './delegate-to-ingest-tool.js';
import type { AskResult } from '../../agents/agent-loop.js';

// Az ingest-agentet nem futtatjuk élesben (LLM + DB); injektált fake runnerrel teszteljük,
// hogy a tool helyesen továbbítja az utasítást és a választ, és soha nem dob.

function fakeResult(answer: string): AskResult {
  return {
    answer,
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: 'stop',
    tracePath: '',
  };
}

describe('executeDelegateToIngest', () => {
  it('runs the ingest agent and returns its answer as content', async () => {
    const calls: string[] = [];
    const run: IngestRunner = async (instruction) => {
      calls.push(instruction);
      return fakeResult('Kész: Monstera ára 8990 Ft.');
    };

    const out = await executeDelegateToIngest(
      { instruction: 'Frissítsd a Monstera árát 8990 Ft-ra.' },
      { run },
    );

    expect(calls).toEqual(['Frissítsd a Monstera árát 8990 Ft-ra.']);
    expect(out.isError).toBe(false);
    expect(out.content).toBe('Kész: Monstera ára 8990 Ft.');
    expect(out.summary).toContain('ingest-agent');
  });

  it('rejects an empty instruction without running the agent', async () => {
    let ran = false;
    const run: IngestRunner = async () => {
      ran = true;
      return fakeResult('nem szabad ide jutni');
    };

    const out = await executeDelegateToIngest({ instruction: '   ' }, { run });

    expect(ran).toBe(false);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('utasítás');
  });

  it('never throws — a failing ingest agent becomes a Hungarian error outcome', async () => {
    const run: IngestRunner = async () => {
      throw new Error('DB nem elérhető');
    };

    const out = await executeDelegateToIngest(
      { instruction: 'Vegyél fel egy új növényt.' },
      { run },
    );

    expect(out.isError).toBe(true);
    expect(out.content).toContain('DB nem elérhető');
  });
});
