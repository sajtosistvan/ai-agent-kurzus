import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import { Trace } from './trace.js';

const modelResponse = (text: string, stop: string): Anthropic.Message =>
  ({
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: stop,
    usage: { input_tokens: 10, output_tokens: 5 },
  }) as unknown as Anthropic.Message;

const toolUse = (query: string): Anthropic.ToolUseBlock =>
  ({
    id: 't1',
    name: 'runSql',
    input: { query },
    type: 'tool_use',
  }) as unknown as Anthropic.ToolUseBlock;

describe('Trace', () => {
  it('records context growth across turns', () => {
    const t = new Trace({
      question: 'q',
      model: 'm',
      systemPrompt: 's',
      print: false,
    });

    t.request(1, {
      model: 'm',
      max_tokens: 1024,
      system: 's',
      tools: [],
      messages: [{ role: 'user', content: 'q' }],
    });
    const turn1 = t.modelTurn(1, modelResponse('', 'tool_use'));
    t.toolStep(turn1, toolUse('SELECT 1'), {
      content: '{"rowCount":1,"rows":[{"x":1}]}',
      isError: false,
      executedSql: 'SELECT 1 LIMIT 50',
      rowCount: 1,
    });

    t.request(2, {
      model: 'm',
      max_tokens: 1024,
      system: 's',
      tools: [],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [] },
        { role: 'user', content: [] },
      ],
    });
    t.modelTurn(2, modelResponse('kész', 'end_turn'));

    const data = t.toJSON('kész', { inputTokens: 20, outputTokens: 10 });
    expect(data.turns).toHaveLength(2);
    expect(data.turns[0]?.context.messages).toBe(1);
    expect(data.turns[1]?.context.messages).toBe(3);
    expect(data.turns[0]?.toolCalls[0]?.guardedSql).toBe('SELECT 1 LIMIT 50');
    expect(data.answer).toBe('kész');
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
      const t = new Trace({
        question: 'q',
        model: 'm',
        systemPrompt: 's',
        print: false,
        watchLog: file,
      });
      t.request(1, {
        model: 'm',
        max_tokens: 1024,
        system: 's',
        tools: [],
        messages: [{ role: 'user', content: 'q' }],
      });
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('HÍVÁS #1');
      expect(content).toContain('[user]');
    } finally {
      rmSync(file, { force: true });
    }
  });
});
