import { askAgent } from '../query-agent/query-agent.js';
import { askPackageAgent } from '../package-agent/package-agent.js';
import type { AskResult, Message } from '../agent-loop.js';
import type { OrchestratorEvent } from './orchestrator-agent.js';

// router-handover.ts — 1. megközelítés: AZ ORCHESTRATOR KÖZVETÍT. A csomag-agent requestInfo
// tool-hívása csak RÖGZÍTI a kérdést; ez a réteg látja, meghívja az info-agentet, és a
// válaszát visszaadva folytatja a csomag-agent körét. A labdamenet egy LÁTHATÓ, sima for
// ciklus (max 3 ugrás egy felhasználói körön belül) — nem rejtett rekurzió; minden ugrás
// külön data-agent + data-tool eseményként látszik a trace-ben. Az agentek nem tudnak
// egymásról — csak ez a fájl ismeri mindkettőt.

const MAX_HOPS = 3;

export interface RouterHandoverDeps {
  history?: Message[];
  print?: boolean;
  onTextDelta?: (delta: string) => void;
  onEvent?: (event: OrchestratorEvent) => void;
}

export async function runRouterHandover(
  question: string,
  deps: RouterHandoverDeps,
): Promise<AskResult> {
  let currentInput = question;
  let history = deps.history ?? [];
  let lastResult: AskResult | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let pendingQuestion: string | null = null;
    deps.onEvent?.({ type: 'agent', agent: 'package' });
    const result = await askPackageAgent(currentInput, {
      mode: 'router',
      history,
      print: deps.print,
      onTextDelta: deps.onTextDelta,
      onRequestInfo: (q) => {
        pendingQuestion = q;
      },
      onPlan: (plan) => deps.onEvent?.({ type: 'package', plan }),
      onToolEvent: (_id, name, _input, outcome) =>
        deps.onEvent?.({
          type: 'tool',
          data: {
            agent: 'package', toolName: name, summary: outcome.summary,
            isError: outcome.isError, rowCount: outcome.rowCount, nested: false,
          },
        }),
    });
    lastResult = result;
    if (pendingQuestion === null) {
      return result; // nincs függő adat-kérés — a kör kész
    }

    // Az info-agent válaszol a rögzített kérdésre (nem streamel — belső labdamenet).
    deps.onEvent?.({ type: 'agent', agent: 'info' });
    const info = await askAgent(pendingQuestion, {
      role: 'customer',
      print: deps.print,
      onToolEvent: (_id, name, _input, outcome) =>
        deps.onEvent?.({
          type: 'tool',
          data: {
            agent: 'info', toolName: name, summary: outcome.summary,
            isError: outcome.isError, rowCount: outcome.rowCount, nested: false,
          },
        }),
    });

    // A csomag-agent körének FOLYTATÁSA: a teljes eddigi beszélgetés + az info-agent válasza
    // következő bemenetként. A JELZÉS tool-hívás volt (requestInfo); a válasz kézbesítése a
    // loop természetes csatornáján, címkézett üzenetként megy — nem szöveg-parse-olás.
    history = result.messages;
    currentInput = `[Az adat-szolgáltató válasza a(z) „${pendingQuestion}” kérdésre]\n${info.answer}`;
  }
  // MAX_HOPS elérve: az utolsó csomag-agent válasz megy ki — a prompt szerint az agent ilyenkor
  // is mondott valamit a felhasználónak.
  return lastResult as AskResult;
}
