import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadConfig } from '../../config.js';
import { askAgent } from '../query-agent/query-agent.js';
import type { AskResult, Message } from '../agent-loop.js';
import type { PackagePlan, ToolEventData } from '../../tools/validate-package/package-plan.js';
import { routeToTool } from '../../tools/route-to/route-to-tool.js';
import { buildOrchestratorPrompt } from './orchestrator-prompt.js';
import { findLastFlowSignal, type FlowHistoryMessage } from './find-last-flow-signal.js';
import { runRouterHandover } from './router-handover.js';
import { runDelegateHandover } from './delegate-handover.js';

// orchestrator-agent.ts — a MULTI-AGENT BELÉPÉSI PONT. Minden felhasználói üzenetnél lefut:
// (1) flow-lock ellenőrzés az előzmény data-tool partjaiból (kód, nem LLM!);
// (2) ha nincs lock: egyetlen gyors, NEM streamelő routing-hívás (routeTo tool, toolChoice:
//     'required') — az orchestrator soha nem válaszol a felhasználónak;
// (3) a kiválasztott agent streameli a választ — a MÓD (router/delegate) csak azt dönti el,
//     hogyan jut adathoz a csomag-agent.

export type OrchestratorEvent =
  | { type: 'agent'; agent: 'info' | 'package' }
  | { type: 'tool'; data: ToolEventData }
  | { type: 'package'; plan: PackagePlan };

export interface OrchestratedOptions {
  mode: 'router' | 'delegate';
  history?: Message[];
  uiHistory?: FlowHistoryMessage[];
  print?: boolean;
  onTextDelta?: (delta: string) => void;
  onEvent?: (event: OrchestratorEvent) => void;
}

interface RouteDecision {
  agent: 'info-agent' | 'package-agent';
  reason: string;
}

/** Az utolsó max 8 előzmény-üzenet elég a döntéshez — a routing gyors és olcsó marad. */
const ROUTE_HISTORY_TAIL = 8;

async function decideRoute(question: string, history: Message[]): Promise<RouteDecision> {
  const config = loadConfig();
  const anthropic = createAnthropic({ apiKey: config.apiKey });
  const result = await generateText({
    model: anthropic(config.model),
    system: buildOrchestratorPrompt(),
    messages: [...history.slice(-ROUTE_HISTORY_TAIL), { role: 'user', content: question }],
    tools: { routeTo: routeToTool() },
    toolChoice: 'required',
  });
  const call = result.toolCalls.find((c) => c.toolName === 'routeTo');
  if (!call) {
    return { agent: 'info-agent', reason: 'nem érkezett routing-döntés — alapértelmezés' };
  }
  const input = call.input as RouteDecision;
  return { agent: input.agent, reason: input.reason };
}

export async function runOrchestrated(
  question: string,
  options: OrchestratedOptions,
): Promise<AskResult> {
  // FLOW-LOCK: amíg a csomag-flow nyitva van, MINDEN üzenet a csomag-agenthez megy — kódból,
  // LLM-döntés nélkül. A visszaterelés hangneme a csomag-agent promptjának dolga.
  const locked = findLastFlowSignal(options.uiHistory ?? []) === 'package-open';
  const route: RouteDecision = locked
    ? { agent: 'package-agent', reason: 'flow-lock: a csomag-flow még nyitva van' }
    : await decideRoute(question, options.history ?? []);

  // A döntés MINDIG kimegy data-tool partként — ebből olvas a flow-lock a következő körben,
  // és ebből rajzol routing-chipet a UI.
  options.onEvent?.({
    type: 'tool',
    data: {
      agent: 'orchestrator',
      toolName: 'routeTo',
      summary: `routeTo → ${route.agent} (${route.reason})`,
      isError: false,
      rowCount: null,
      nested: false,
      targetAgent: route.agent === 'package-agent' ? 'package' : 'info',
      reason: route.reason,
    },
  });

  const common = {
    history: options.history,
    print: options.print,
    onTextDelta: options.onTextDelta,
    onEvent: options.onEvent,
  };

  if (route.agent === 'info-agent') {
    options.onEvent?.({ type: 'agent', agent: 'info' });
    return askAgent(question, {
      role: 'customer',
      history: options.history,
      print: options.print,
      onTextDelta: options.onTextDelta,
      onToolEvent: (_id, name, _input, outcome) =>
        options.onEvent?.({
          type: 'tool',
          data: {
            agent: 'info', toolName: name, summary: outcome.summary,
            isError: outcome.isError, rowCount: outcome.rowCount, nested: false,
          },
        }),
    });
  }
  return options.mode === 'router'
    ? runRouterHandover(question, common)
    : runDelegateHandover(question, common);
}
