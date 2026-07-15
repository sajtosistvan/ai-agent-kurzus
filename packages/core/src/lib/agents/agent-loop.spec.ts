import type { ToolOutcome } from '../tools/tool-outcome.js';

// A runAgentLoop reporter-kompozícióját teszteljük: a buildTools-nak átadott report
// hívása a Trace-gyűjtés MELLETT az options.onToolEvent-et is meg kell hívja.
// Modell-hívás nélkül: a buildTools-t kiemelt segédfüggvényként (composeReporter) tesszük
// tesztelhetővé.
import { composeReporter } from './agent-loop.js';

describe('composeReporter', () => {
  const outcome: ToolOutcome = {
    content: 'ok',
    isError: false,
    summary: 'runSql — 4 sor',
    rowCount: 4,
  };

  it('a belső gyűjtőt ÉS az onToolEvent-et is meghívja', () => {
    const collected: string[] = [];
    const events: string[] = [];
    const report = composeReporter(
      (id, name) => collected.push(`${id}:${name}`),
      (id, name) => events.push(`${id}:${name}`),
    );
    report('t1', 'runSql', { query: 'SELECT 1' }, outcome);
    expect(collected).toEqual(['t1:runSql']);
    expect(events).toEqual(['t1:runSql']);
  });

  it('onToolEvent nélkül csak a belső gyűjtő fut (off mód — változatlan viselkedés)', () => {
    const collected: string[] = [];
    const report = composeReporter(
      (id, name) => collected.push(`${id}:${name}`),
      undefined,
    );
    report('t1', 'runSql', {}, outcome);
    expect(collected).toEqual(['t1:runSql']);
  });
});
