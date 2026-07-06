import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModelMessage } from 'ai';
import { Trace, setWatchLog, traceLog } from './trace.js';

// A Trace a hívótól már lapos, SDK-agnosztikus adatot kap (az agent.ts a prepareStep /
// onStepFinish hookokból táplálja) — a fixtúrák ezt az alakot építik.

const modelStep = (text: string, finish: string) => ({
  finishReason: finish,
  text,
  toolCalls:
    finish === 'tool-calls'
      ? [{ toolName: 'runSql', input: { query: 'SELECT 1' } }]
      : [],
  usage: { inputTokens: 10, outputTokens: 5 },
});

const requestOf = (messages: ModelMessage[]) => ({
  model: 'm',
  maxOutputTokens: 1024,
  system: 's',
  toolNames: [] as string[],
  messages,
});

describe('Trace', () => {
  it('records context growth across turns', () => {
    const t = new Trace({
      question: 'q',
      model: 'm',
      systemPrompt: 's',
      print: false,
    });

    t.request(1, requestOf([{ role: 'user', content: 'q' }]));
    const turn1 = t.modelTurn(1, modelStep('', 'tool-calls'));
    t.toolStep(
      turn1,
      { toolName: 'runSql', input: { query: 'SELECT 1' } },
      {
        content: '{"rowCount":1,"rows":[{"x":1}]}',
        isError: false,
        executedSql: 'SELECT 1 LIMIT 50',
        rowCount: 1,
      },
    );

    t.request(
      2,
      requestOf([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [] },
        { role: 'tool', content: [] },
      ]),
    );
    t.modelTurn(2, modelStep('kész', 'stop'));

    const data = t.toJSON('kész', { inputTokens: 20, outputTokens: 10 });
    expect(data.turns).toHaveLength(2);
    expect(data.turns[0]?.context.messages).toBe(1);
    expect(data.turns[1]?.context.messages).toBe(3);
    expect(data.turns[0]?.toolCalls[0]?.guardedSql).toBe('SELECT 1 LIMIT 50');
    expect(data.answer).toBe('kész');
  });

  it('counts recorded turns for the caller', () => {
    const t = new Trace({
      question: 'q',
      model: 'm',
      systemPrompt: 's',
      print: false,
    });
    expect(t.turnCount).toBe(0);
    t.modelTurn(1, modelStep('', 'tool-calls'));
    expect(t.turnCount).toBe(1);
  });

  it('stays silent when print is false', () => {
    const t = new Trace({
      question: 'q',
      model: 'm',
      systemPrompt: 's',
      print: false,
    });
    expect(t.toJSON('a', { inputTokens: 1, outputTokens: 1 }).question).toBe(
      'q',
    );
  });

  it('appends the trace to the watch log even when print is false', () => {
    const file = join(tmpdir(), `plantbase-watch-${process.pid}.log`);
    try {
      setWatchLog(file);
      const t = new Trace({
        question: 'q',
        model: 'm',
        systemPrompt: 's',
        print: false,
      });
      t.request(1, requestOf([{ role: 'user', content: 'q' }]));
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('HÍVÁS #1');
      expect(content).toContain('[user]');
    } finally {
      setWatchLog(null);
      rmSync(file, { force: true });
    }
  });

  it('traceLog writes a custom line to the watch log', () => {
    const file = join(tmpdir(), `plantbase-tracelog-${process.pid}.log`);
    try {
      setWatchLog(file);
      traceLog('saját log üzenet');
      expect(readFileSync(file, 'utf8')).toContain('saját log üzenet');
    } finally {
      setWatchLog(null);
      rmSync(file, { force: true });
    }
  });
});
