import { askPackageAgent } from '../package-agent/package-agent.js';
import type { AskResult, Message } from '../agent-loop.js';
import type { OrchestratorEvent } from './orchestrator-agent.js';

// delegate-handover.ts — 2. megközelítés: AZ AGENTEK EGYMÁST HÍVJÁK. A csomag-agent az
// askInfoAgent toolt kapja: az execute MAGA futtatja az info-agent saját loopját, az
// adat-kérés nem hagyja el a csomag-agent körét. Az orchestrator szerepe itt a per-üzenet
// routingra és a flow-lockra szűkül — ez a fájl ezért ilyen rövid, és pont ez a tanulság.
// A beágyazott info-agent tool-hívásai nested:true jelöléssel mennek ki (a UI behúzza őket).

export interface DelegateHandoverDeps {
  history?: Message[];
  print?: boolean;
  onTextDelta?: (delta: string) => void;
  onEvent?: (event: OrchestratorEvent) => void;
}

export async function runDelegateHandover(
  question: string,
  deps: DelegateHandoverDeps,
): Promise<AskResult> {
  deps.onEvent?.({ type: 'agent', agent: 'package' });
  return askPackageAgent(question, {
    mode: 'delegate',
    history: deps.history,
    print: deps.print,
    onTextDelta: deps.onTextDelta,
    onPlan: (plan) => deps.onEvent?.({ type: 'package', plan }),
    onToolEvent: (_id, name, _input, outcome) =>
      deps.onEvent?.({
        type: 'tool',
        data: {
          agent: 'package', toolName: name, summary: outcome.summary,
          isError: outcome.isError, rowCount: outcome.rowCount, nested: false,
        },
      }),
    onNestedToolEvent: (_id, name, _input, outcome) =>
      deps.onEvent?.({
        type: 'tool',
        data: {
          agent: 'info', toolName: name, summary: outcome.summary,
          isError: outcome.isError, rowCount: outcome.rowCount, nested: true,
        },
      }),
  });
}
