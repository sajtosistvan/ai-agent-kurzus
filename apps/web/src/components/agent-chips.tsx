import type { ToolEventData } from '@/lib/message-parts';

// agent-chips.tsx — az orchestrált mód TRACE-elemei a chatben: melyik agent beszél (badge),
// mit döntött az orchestrator (routing-chip) és milyen tool-hívások futottak (tool-chipek,
// időrendben; delegate módban a beágyazott info-agent hívásai BEHÚZVA). Off módban ezek a
// komponensek meg sem jelennek — nem érkezik data-part.

const AGENT_LABEL: Record<string, string> = {
  info: '🌱 Info-agent',
  package: '📦 Csomag-agent',
};

export function AgentBadge({ agent }: { agent: string }) {
  return (
    <span
      data-testid="agent-badge"
      className="bg-secondary text-secondary-foreground mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
    >
      {AGENT_LABEL[agent] ?? agent}
    </span>
  );
}

export function ToolChip({ event }: { event: ToolEventData }) {
  // Az orchestrator nem beszélő szereplő — a döntése egy diszkrét routing-chip.
  if (event.toolName === 'routeTo') {
    return (
      <div data-testid="routing-chip" className="text-muted-foreground my-0.5 text-xs italic">
        🎯 {event.summary}
      </div>
    );
  }
  return (
    <div
      data-testid="tool-chip"
      className={`my-0.5 text-xs ${event.nested ? 'text-muted-foreground/80 ml-6' : 'text-muted-foreground'}`}
    >
      {event.isError ? '⚠️' : '🔧'} {event.summary ?? event.toolName}
      {event.nested && <span className="ml-1 opacity-60">(beágyazott)</span>}
    </div>
  );
}
