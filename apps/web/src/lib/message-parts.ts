import type { UIMessage } from 'ai';

// message-parts.ts — az üzenet részeinek szétválogatása EGY helyen, hogy az App.tsx
// render-blokkja olvasható maradjon: mit mond (text), mit csinált (tool-részek), és —
// orchestrált módban — KI csinálta (data-agent), milyen döntésekkel (data-tool) és
// milyen csomagtervvel (data-package). Off módban data-* part nem érkezik: minden új
// mező üres marad, a UI a mai képet adja.

/** A szerver `tool-<név>` típusú részei — a kártyához ennyi kell belőlük. */
export interface ToolUIPart {
  type: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

/** A data-tool part tartalma — a szerver ToolEventData-jának tükre (a stream a szerződés). */
export interface ToolEventData {
  agent: string;
  toolName: string;
  summary: string | null;
  isError: boolean;
  rowCount: number | null;
  nested: boolean;
  targetAgent?: string;
  reason?: string;
}

export interface PackagePlanItem {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PackagePlan {
  customerId: number;
  customerCode: string;
  customerName: string;
  budget: number;
  items: PackagePlanItem[];
  totalPrice: number;
  remaining: number;
}

export function splitAssistantParts(m: UIMessage): {
  text: string;
  toolParts: ToolUIPart[];
  agent: string | null;
  toolEvents: ToolEventData[];
  packagePlan: PackagePlan | null;
} {
  const text = m.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const toolParts = m.parts.filter(
    (part): part is typeof part & ToolUIPart => part.type.startsWith('tool-'),
  );
  const dataOf = (type: string): unknown[] =>
    m.parts
      .filter((part): part is typeof part & { data: unknown } => part.type === type)
      .map((part) => part.data);
  const agents = dataOf('data-agent') as { agent: string }[];
  const agent = agents.length > 0 ? agents[agents.length - 1].agent : null;
  const toolEvents = dataOf('data-tool') as ToolEventData[];
  const plans = dataOf('data-package') as PackagePlan[];
  const packagePlan = plans.length > 0 ? plans[plans.length - 1] : null;
  return { text, toolParts, agent, toolEvents, packagePlan };
}
