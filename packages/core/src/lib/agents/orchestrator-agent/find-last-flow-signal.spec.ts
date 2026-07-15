import { findLastFlowSignal } from './find-last-flow-signal.js';

const toolPart = (toolName: string, extra: Record<string, unknown> = {}) => ({
  type: 'data-tool',
  data: { agent: 'orchestrator', toolName, summary: null, isError: false, rowCount: null, nested: false, ...extra },
});
const msg = (...parts: { type: string; data?: unknown }[]) => ({ parts });

describe('findLastFlowSignal', () => {
  it('üres előzmény → none', () => {
    expect(findLastFlowSignal([])).toBe('none');
  });

  it('routeTo → package nyitja a flow-t', () => {
    const history = [msg(toolPart('routeTo', { targetAgent: 'package' }))];
    expect(findLastFlowSignal(history)).toBe('package-open');
  });

  it('routeTo → info NEM nyit flow-t', () => {
    const history = [msg(toolPart('routeTo', { targetAgent: 'info' }))];
    expect(findLastFlowSignal(history)).toBe('none');
  });

  it('sikeres savePackage zárja a flow-t', () => {
    const history = [
      msg(toolPart('routeTo', { targetAgent: 'package' })),
      msg(toolPart('savePackage')),
    ];
    expect(findLastFlowSignal(history)).toBe('closed');
  });

  it('cancelPackage zárja a flow-t', () => {
    const history = [
      msg(toolPart('routeTo', { targetAgent: 'package' })),
      msg(toolPart('cancelPackage')),
    ];
    expect(findLastFlowSignal(history)).toBe('closed');
  });

  it('HIBÁS savePackage NEM zár — a lock marad', () => {
    const history = [
      msg(toolPart('routeTo', { targetAgent: 'package' })),
      msg({ type: 'data-tool', data: { toolName: 'savePackage', isError: true } }),
    ];
    expect(findLastFlowSignal(history)).toBe('package-open');
  });

  it('zárás utáni ÚJ routeTo → package újra nyit', () => {
    const history = [
      msg(toolPart('routeTo', { targetAgent: 'package' })),
      msg(toolPart('savePackage')),
      msg(toolPart('routeTo', { targetAgent: 'package' })),
    ];
    expect(findLastFlowSignal(history)).toBe('package-open');
  });

  it('nem data-tool partokat és hiányzó data-t átugorja', () => {
    const history = [msg({ type: 'text' }, { type: 'data-tool' }, { type: 'data-agent', data: { agent: 'info' } })];
    expect(findLastFlowSignal(history)).toBe('none');
  });
});
