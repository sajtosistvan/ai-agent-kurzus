# Orchestrator multi-agent demó — implementációs terv

> **For the agentic worker:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
> Minden feladat önállóan zöldre hozható; a feladatok sorrendje kötelező (mindegyik a korábbiak
> típusaira épül). Spec: `docs/superpowers/specs/2026-07-15-orchestrator-demo-design.md`.

**Goal:** Két agent közötti handover demózása kétféle megközelítésben (`router` / `delegate`),
egyetlen runtime kapcsolóval (`ORCHESTRATION_MODE`), a web UI-ban látható trace-szel
(agent-badge, routing-chip, tool-chipek, csomag-összesítő kártya), plusz egy LLM-as-user
tesztelő skill két runnerrel.

**Architecture:** A meglévő `runAgentLoop` köré épül egy orchestrator-réteg
(`packages/core/src/lib/agents/orchestrator-agent/`): minden felhasználói üzenetnél egy
nem-streamelő routing-lépés (`routeTo` tool) dönt info-agent (a meglévő query-agent) és az új
csomag-agent között; a flow-lock az előzmény `data-tool` partjaiból olvasható ki (stateless
szerver). A szerver a `chat-stream.ts`-ben alakítja a core eseményeit (ToolReporter +
onTextDelta callbackek) AI SDK UI message stream partokká; `ORCHESTRATION_MODE=off` esetén a
mai kódút fut bájtra pontosan változatlanul.

**Tech stack:** TypeScript, Nx monorepo, Vercel AI SDK v6 (`ai@6.0.219/221` a workspace-ben),
`@ai-sdk/anthropic`, Prisma 6 + Postgres (pgvector), Express, React + `@ai-sdk/react` useChat,
Vitest, Playwright (a browser-runnerhez), zod v4.

## Global Constraints (kötelező, minden feladatra)

- **Magyar szövegek**: minden felhasználónak/modellnek szóló szöveg, hibaüzenet, kommentár magyar.
- **ToolOutcome never-throw**: minden tool `execute` a `ToolOutcome` alakot adja vissza, SOHA nem
  dob — a hiba is magyar szövegként megy vissza (`isError: true`).
- **Egy tool = egy mappa, `*-tool.ts`**: minden tool saját mappában, cselekvés-névvel; agentek
  saját mappában (`*-agent.ts` + `*-prompt.ts`); handover fájlok `*-handover.ts`.
- **Fájlok ~150 sor alatt**, a repo stílusú magyar „miért”-kommentekkel.
- **Commit**: `<type>: <leírás>` formátum (feat/fix/refactor/docs/test/chore), Co-Authored-By
  NÉLKÜL, **no push**.
- **`ORCHESTRATION_MODE=off` = teljes visszafelé-kompatibilitás**: flag nélkül (vagy `off`-fal)
  az app bájtra pontosan úgy viselkedik, mint ma — a szerver a mai `askAgent`+`writer.merge`
  utat futtatja, a web UI-n semmi új nem renderelődik (nem érkezik `data-agent`/`data-tool`/
  `data-package` part).
- **Minden agent-közti jelzés tool-hívás, SOHA nem szöveg-parse**: routing = `routeTo`, adat-kérés
  = `requestInfo`/`askInfoAgent`, flow-zárás = `savePackage`/`cancelPackage`; a flow-lock a
  `data-tool` partokból (strukturált tool-esemény), nem a válasz-szövegből olvas.
- A `packages.customer_id` FK a `customers`-re; `validatePackage` determinisztikus Prisma-kód
  (méret/fény/pet/kid/difficulty≤expertise/készlet/**budget kemény korlát**); `savePackage`
  mentés előtt ÚJRA validál; `cancelPackage` rögzíti a lemondást; a flow-lock a
  `findLastFlowSignal` tiszta, unit-tesztelt függvényén át.

## Ellenőrzött AI SDK v6 API-k (node_modules-ból, `ai@6.0.221`)

- `UIMessageStreamWriter.write(part: InferUIMessageChunk<UI_MESSAGE>): void` és
  `merge(stream): void` — a `data-*` chunk alak:
  `{ type: \`data-${NAME}\`; id?: string; data: DATA; transient?: boolean }`.
- Szöveg-chunkok: `{ type: 'text-start'; id: string }`, `{ type: 'text-delta'; delta: string; id: string }`,
  `{ type: 'text-end'; id: string }`, továbbá `{ type: 'start' }` / `{ type: 'finish' }`.
- `readUIMessageStream<UI_MESSAGE>({ message?, stream: ReadableStream<UIMessageChunk>, onError?, terminateOnError? }): AsyncIterableStream<UI_MESSAGE>`
  — a http-runner ezt használja; az SSE→chunk átalakítást magunk írjuk (a `parseJsonEventStream`
  sémát kérne, egyszerűbb a kézi split — lásd 12. feladat).
- `generateText({ model, system, messages, tools, toolChoice: 'required', ... })` — a
  `toolChoice` a `CallSettings` része; alapértelmezett stop 1 lépés után → a routing-döntés
  egyetlen nem-streamelő hívás, az eredmény a `result.toolCalls[0].input`.
- `DefaultChatTransport` (a web már ezt használja), `createUIMessageStream({ execute({ writer }) ... })`
  (a szerver már ezt használja).

---

## 1. feladat — Prisma: `packages` + `package_items` tábla

**Files**
- Modify: `packages/db/prisma/schema.prisma`
- Create (generált): `packages/db/prisma/migrations/<ts>_packages_package_items/migration.sql`

**Interfaces (produkált Prisma modellek):** `prisma.package.create`, `prisma.packageItem.createMany`,
`Package { id: number; customerId: number; totalPrice: Decimal; createdAt: Date }`,
`PackageItem { id: number; packageId: number; productId: number; qty: number }`.

**Steps**

- [ ] A `schema.prisma` végére (a `Message` modell után) illeszd be:

```prisma
// packages + package_items — az ELMENTETT ügyfél-csomagok. A csomag-agent CSAK validált
// csomagot írhat ide (savePackage tool, mentés előtt újra-validálással). A customer_id FK
// a customers-re: egy csomag mindig egy konkrét ügyfélé, a budget-korlát is az övé volt.
model Package {
  id         Int           @id @default(autoincrement())
  customerId Int           @map("customer_id")
  customer   Customer      @relation(fields: [customerId], references: [id])
  totalPrice Decimal       @map("total_price") @db.Decimal(12, 2)
  createdAt  DateTime      @default(now()) @map("created_at")
  items      PackageItem[]

  @@map("packages")
}

model PackageItem {
  id        Int     @id @default(autoincrement())
  packageId Int     @map("package_id")
  package   Package @relation(fields: [packageId], references: [id], onDelete: Cascade)
  productId Int     @map("product_id")
  product   Product @relation(fields: [productId], references: [id])
  qty       Int

  @@index([packageId])
  @@map("package_items")
}
```

- [ ] A `Customer` modellbe vedd fel a visszamutató mezőt (a `threads Thread[]` sor alá):
  `packages Package[]`; a `Product` modellbe (a `description` mező alá):
  `packageItems PackageItem[]`.
- [ ] Futtasd: `pnpm db:migrate --name packages_package_items` — elvárt: új migrációs mappa
  jön létre, a Prisma kliens újragenerálódik hiba nélkül.
- [ ] **RO-grant ellenőrzés** (nem kell új grant!): a
  `packages/db/prisma/migrations/20260715120000_ro_grants/migration.sql` már tartalmazza az
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO plantbase_ro` sort —
  a migrációk ugyanazzal a DB-userrel futnak, ezért az ÚJ táblák automatikusan kapnak SELECT-et.
  Ellenőrzés: `docker compose exec postgres psql -U plantbase -d plantbase -c '\dp packages'`
  — elvárt: az Access privileges oszlopban szerepel `plantbase_ro=r/plantbase`.
- [ ] `pnpm typecheck` — elvárt: zöld (a generált kliens tartalmazza a `package`/`packageItem`
  delegate-eket).

**Commit:** `feat: packages es package_items tabla (Prisma migracio)`

---

## 2. feladat — Core alapok: mód-kapcsoló, csomagterv-típusok, flow-lock (TDD)

**Files**
- Create: `packages/core/src/lib/agents/orchestrator-agent/orchestration-mode.ts`
- Create: `packages/core/src/lib/agents/orchestrator-agent/find-last-flow-signal.ts`
- Create: `packages/core/src/lib/agents/orchestrator-agent/find-last-flow-signal.spec.ts`
- Create: `packages/core/src/lib/tools/validate-package/package-plan.ts`
- Modify: `packages/core/src/index.ts` (exportok)

**Interfaces (produkált)**
```ts
export type OrchestrationMode = 'off' | 'router' | 'delegate';
export function getOrchestrationMode(env?: NodeJS.ProcessEnv): OrchestrationMode;

export type FlowSignal = 'package-open' | 'closed' | 'none';
export interface FlowHistoryPart { type: string; data?: unknown }
export interface FlowHistoryMessage { parts: FlowHistoryPart[] }
export function findLastFlowSignal(messages: FlowHistoryMessage[]): FlowSignal;

export interface PackagePlanItem { productId: number; name: string; qty: number; unitPrice: number; lineTotal: number }
export interface PackagePlan { customerId: number; customerCode: string; customerName: string; budget: number; items: PackagePlanItem[]; totalPrice: number; remaining: number }

export interface ToolEventData { agent: 'orchestrator' | 'info' | 'package'; toolName: string; summary: string | null; isError: boolean; rowCount: number | null; nested: boolean; targetAgent?: 'info' | 'package'; reason?: string }
```

**Steps**

- [ ] **RED** — írd meg a spec-et (`find-last-flow-signal.spec.ts`):

```ts
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
```

- [ ] Futtasd: `pnpm nx test core` — elvárt: az új spec PIROS (a modul még nincs).
- [ ] **GREEN** — `find-last-flow-signal.ts`:

```ts
// find-last-flow-signal.ts — a FLOW-LOCK állapota. Nem session-store: a szerver stateless,
// a lock az üzenet-előzményben MÁR ÚGYIS OTT LÉVŐ data-tool partokból olvasható ki.
// Nyitás: routeTo → package (az orchestrator döntése). Zárás: sikeres savePackage vagy
// cancelPackage. SOHA nem a válasz-szöveget parse-oljuk — csak strukturált tool-eseményeket.

export type FlowSignal = 'package-open' | 'closed' | 'none';

/** Minimális szerkezeti típus: a szerver UIMessage-eket ad be, a teszt sima objektumokat. */
export interface FlowHistoryPart {
  type: string;
  data?: unknown;
}
export interface FlowHistoryMessage {
  parts: FlowHistoryPart[];
}

interface ToolPartData {
  toolName?: string;
  targetAgent?: string;
  isError?: boolean;
}

export function findLastFlowSignal(messages: FlowHistoryMessage[]): FlowSignal {
  let state: FlowSignal = 'none';
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'data-tool' || typeof part.data !== 'object' || part.data === null) {
        continue;
      }
      const data = part.data as ToolPartData;
      if (data.isError) {
        continue; // hibás tool-futás nem jelzés — a lock nem mozdul
      }
      if (data.toolName === 'routeTo' && data.targetAgent === 'package') {
        state = 'package-open';
      }
      if (data.toolName === 'savePackage' || data.toolName === 'cancelPackage') {
        state = 'closed';
      }
    }
  }
  return state;
}
```

- [ ] `orchestration-mode.ts`:

```ts
// orchestration-mode.ts — a demó KAPCSOLÓJA. Három érték:
//   off      → a mai viselkedés, változatlanul (sima query-agent) — ez az alapértelmezés,
//   router   → az orchestrator közvetít a két agent között (router-handover.ts),
//   delegate → az agentek egymást hívják toolként (delegate-handover.ts).
// Runtime flag: a szerver KÉRÉSENKÉNT olvassa (getOrchestrationMode()), így a demón a
// flag átállítása + szerver-újraindítás (pnpm server) azonnal vált. Ismeretlen érték = off.

export type OrchestrationMode = 'off' | 'router' | 'delegate';

export function getOrchestrationMode(
  env: NodeJS.ProcessEnv = process.env,
): OrchestrationMode {
  const raw = env['ORCHESTRATION_MODE'];
  if (raw === 'router' || raw === 'delegate') {
    return raw;
  }
  return 'off';
}
```

- [ ] `packages/core/src/lib/tools/validate-package/package-plan.ts` (a plan-típus a tool
  mappájában él, mert a validálás állítja elő; az orchestrator és a szerver csak továbbadja):

```ts
// package-plan.ts — a STRUKTURÁLT csomagterv. A validatePackage sikeres kimenete: ebből lesz
// a szerveren a data-package stream-part, a web UI-ban a csomag-összesítő kártya. Ugyanez a
// JSON megy a modellnek is (ToolOutcome.content) — egy igazságforrás, két fogyasztó.

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

/** A data-tool stream-part tartalma — a tool-chipek és a flow-lock közös nyelve. */
export interface ToolEventData {
  agent: 'orchestrator' | 'info' | 'package';
  toolName: string;
  summary: string | null;
  isError: boolean;
  rowCount: number | null;
  /** delegate módban a beágyazott info-agent hívásai true-val — a UI behúzva rajzolja. */
  nested: boolean;
  /** csak routeTo-nál: hová megy a labda. */
  targetAgent?: 'info' | 'package';
  /** csak routeTo-nál: a döntés indoka. */
  reason?: string;
}
```

- [ ] `packages/core/src/index.ts` — az agents blokk után vedd fel:

```ts
// Orchestrator — a multi-agent belépési pont és a flow-lock
export * from './lib/agents/orchestrator-agent/orchestration-mode.js';
export * from './lib/agents/orchestrator-agent/find-last-flow-signal.js';
export * from './lib/tools/validate-package/package-plan.js';
```

- [ ] Futtasd: `pnpm nx test core` — elvárt: minden spec ZÖLD. `pnpm typecheck` — zöld.

**Commit:** `feat: orchestration mode kapcsolo, PackagePlan tipusok es flow-lock fuggveny`

---

## 3. feladat — agent-loop: `onToolEvent` hook (a tool-események kicsatornázása)

Ez a **kulcs-vezeték**: a `ToolReporter` mellék-csatorna eddig csak a Trace-nek jelentett;
mostantól a hívó (orchestrator → szerver) is megkapja ugyanazt callbackként, és `data-tool`
partként streameli tovább. `off` módban az opció nincs megadva → nulla viselkedés-változás.

**Files**
- Modify: `packages/core/src/lib/agents/agent-loop.ts` (2 pont)
- Create: `packages/core/src/lib/agents/agent-loop.spec.ts`

**Interfaces (módosított):**
```ts
export interface AskOptions {
  history?: Message[];
  print?: boolean;
  onTextDelta?: (delta: string) => void;
  onStream?: (result: StreamTextResult<ToolSet, never>) => void;
  /** ÚJ: minden tool-futás jelentése a hívónak is (a Trace mellett). */
  onToolEvent?: ToolReporter;
}
```

**Steps**

- [ ] **RED** — `agent-loop.spec.ts` (a hookot a buildTools-on át, modell-hívás NÉLKÜL teszteljük:
  a reporter-kompozíció tiszta logika):

```ts
import type { ToolSet } from 'ai';
import type { AgentDefinition } from './agent-loop.js';
import type { ToolOutcome, ToolReporter } from '../tools/tool-outcome.js';

// A runAgentLoop reporter-kompozícióját teszteljük: a buildTools-nak átadott report
// hívása a Trace-gyűjtés MELLETT az options.onToolEvent-et is meg kell hívja.
// Modell-hívás nélkül: a buildTools-t kiemelt segédfüggvényként (composeReporter) tesszük
// tesztelhetővé.
import { composeReporter } from './agent-loop.js';

describe('composeReporter', () => {
  const outcome: ToolOutcome = { content: 'ok', isError: false, summary: 'runSql — 4 sor', rowCount: 4 };

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
    const report = composeReporter((id, name) => collected.push(`${id}:${name}`), undefined);
    report('t1', 'runSql', {}, outcome);
    expect(collected).toEqual(['t1:runSql']);
  });
});
```

- [ ] `pnpm nx test core` — elvárt: PIROS (`composeReporter` nem létezik).
- [ ] **GREEN** — `agent-loop.ts` módosításai. (1) Az `AskOptions`-be az `onStream` mező után:

```ts
  /**
   * ÚJ MELLÉK-CSATORNA az orchestrator/szerver felé: minden tool-futásról ugyanazt az
   * outcome-ot kapja meg, amit a Trace — ebből lesz a böngészőben a tool-chip (data-tool part).
   * Ha nincs megadva (CLI, off mód), semmi nem változik.
   */
  onToolEvent?: ToolReporter;
```

(2) Új exportált segédfüggvény a fájl aljára (a `finishRun` elé), és a `buildTools` hívás cseréje:

```ts
/** A Trace belső gyűjtője + a hívó onToolEvent-je EGY reporterben. Külön függvény, hogy
 *  modell-hívás nélkül tesztelhető legyen. */
export function composeReporter(
  collect: ToolReporter,
  onToolEvent: ToolReporter | undefined,
): ToolReporter {
  return (toolCallId, name, input, outcome) => {
    collect(toolCallId, name, input, outcome);
    onToolEvent?.(toolCallId, name, input, outcome);
  };
}
```

  A `runAgentLoop`-ban a meglévő
  `const tools = agent.buildTools((toolCallId, name, input, outcome) => { outcomes.set(...) });`
  sor cseréje:

```ts
  const tools = agent.buildTools(
    composeReporter((toolCallId, name, input, outcome) => {
      outcomes.set(toolCallId, { name, input, outcome });
    }, options.onToolEvent),
  );
```

- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld; a meglévő specek (query-agent,
  delegate-to-ingest stb.) változatlanul zöldek.

**Commit:** `feat: onToolEvent hook az agent-loopban (tool-esemenyek a hivonak)`

---

## 4. feladat — Toolok I: `route-to`, `request-info`, `cancel-package` (TDD)

Mindhárom „jelző”-tool: az execute nem ér el adatbázist, csak strukturált jelzést rögzít.

**Files**
- Create: `packages/core/src/lib/tools/route-to/route-to-tool.ts` + `route-to-tool.spec.ts`
- Create: `packages/core/src/lib/tools/request-info/request-info-tool.ts` + `request-info-tool.spec.ts`
- Create: `packages/core/src/lib/tools/cancel-package/cancel-package-tool.ts` + `cancel-package-tool.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export function executeRouteTo(rawInput: unknown): ToolOutcome;
export const routeToTool: (report?: ToolReporter) => Tool;
export function executeRequestInfo(rawInput: unknown, deps?: { onRequestInfo?: (question: string) => void }): ToolOutcome;
export const requestInfoTool: (report?: ToolReporter, deps?: { onRequestInfo?: (question: string) => void }) => Tool;
export function executeCancelPackage(rawInput: unknown): ToolOutcome;
export const cancelPackageTool: (report?: ToolReporter) => Tool;
```

**Steps**

- [ ] **RED** — `route-to-tool.spec.ts`:

```ts
import { executeRouteTo } from './route-to-tool.js';

describe('executeRouteTo', () => {
  it('érvényes döntés → nem hiba, a summary hordozza az irányt és az indokot', () => {
    const out = executeRouteTo({ agent: 'package-agent', reason: 'csomagot kér az ügyfélnek' });
    expect(out.isError).toBe(false);
    expect(out.summary).toContain('package-agent');
    expect(out.summary).toContain('csomagot kér');
  });

  it('ismeretlen agent → magyar hiba, nem exception', () => {
    const out = executeRouteTo({ agent: 'valami-agent', reason: 'x' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('info-agent');
  });

  it('hiányzó indok → hiba', () => {
    expect(executeRouteTo({ agent: 'info-agent' }).isError).toBe(true);
  });
});
```

- [ ] **RED** — `request-info-tool.spec.ts`:

```ts
import { executeRequestInfo } from './request-info-tool.js';

describe('executeRequestInfo', () => {
  it('a kérdést átadja az onRequestInfo callbacknek, és lezárja a kört', () => {
    let captured: string | null = null;
    const out = executeRequestInfo(
      { question: 'Hány pet-safe növény van raktáron 10 000 Ft alatt?' },
      { onRequestInfo: (q) => { captured = q; } },
    );
    expect(out.isError).toBe(false);
    expect(captured).toContain('pet-safe');
    expect(out.content).toContain('továbbítottam');
  });

  it('üres kérdés → hiba, a callback NEM fut', () => {
    let called = false;
    const out = executeRequestInfo({ question: '  ' }, { onRequestInfo: () => { called = true; } });
    expect(out.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('callback nélkül is működik (nem dob)', () => {
    expect(executeRequestInfo({ question: 'mi?' }).isError).toBe(false);
  });
});
```

- [ ] **RED** — `cancel-package-tool.spec.ts`:

```ts
import { executeCancelPackage } from './cancel-package-tool.js';

describe('executeCancelPackage', () => {
  it('nyugtázza a lemondást magyar szöveggel', () => {
    const out = executeCancelPackage({ reason: 'az ügyfél meggondolta magát' });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('lemond');
    expect(out.summary).toContain('meggondolta');
  });

  it('indok nélkül is érvényes', () => {
    expect(executeCancelPackage({}).isError).toBe(false);
    expect(executeCancelPackage(undefined).isError).toBe(false);
  });
});
```

- [ ] `pnpm nx test core` — elvárt: 3 új spec PIROS.
- [ ] **GREEN** — `route-to-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// routeTo tool — az ORCHESTRATOR egyetlen toolja. Az orchestrator SOHA nem válaszol a
// felhasználónak: minden körben ezzel dönti el, melyik agent kapja a labdát. Az execute
// nem csinál semmit — a DÖNTÉS MAGA a tool-hívás (a reporter rögzíti, a szerver data-tool
// partként streameli, a flow-lock később ebből olvas). Jelzés = tool-hívás, nem szöveg.

const AGENTS = ['info-agent', 'package-agent'] as const;

const InputSchema = z.object({
  agent: z.enum(AGENTS),
  reason: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export function executeRouteTo(rawInput: unknown): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Érvénytelen routing-döntés. Az agent mező kötelező (${AGENTS.join(' | ')}), az indok (reason) nem lehet üres.`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { agent, reason } = parsed.data;
  return {
    content: `Irányítás: ${agent}.`,
    isError: false,
    summary: `routeTo → ${agent} (${clip(reason)})`,
    rowCount: null,
  };
}

export const routeToTool = (report?: ToolReporter) =>
  tool({
    description:
      'Döntés: melyik agent dolgozzon a felhasználó üzenetén. info-agent: adat- és tudás-kérdések ' +
      '(katalógus, árak, készlet, gondozás). package-agent: ügyfél-csomag összeállítása, módosítása, ' +
      'mentése vagy lemondása. MINDIG pontosan egyszer hívd, magyar indoklással.',
    inputSchema: z.object({
      agent: z.enum(AGENTS).describe('A cél-agent.'),
      reason: z.string().describe('Rövid magyar indoklás — a demó trace-ében ez látszik.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeRouteTo(input);
      report?.(toolCallId, 'routeTo', input, outcome);
      return outcome.content;
    },
  });
```

- [ ] **GREEN** — `request-info-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// requestInfo tool — a ROUTER mód „kapcsa”. Az execute ÜRES abban az értelemben, hogy nem
// futtat semmit: csak RÖGZÍTI a csomag-agent adat-kérdését (onRequestInfo callback), és az
// agent köre lezárul. Az orchestrator-réteg (router-handover.ts) látja a rögzített kérést,
// meghívja az info-agentet, és a válaszával folytatja a csomag-agent körét. A csomag-agent
// így NEM tud az info-agentről — csak az orchestrator ismeri mindkettőt.

const InputSchema = z.object({
  question: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export function executeRequestInfo(
  rawInput: unknown,
  deps: { onRequestInfo?: (question: string) => void } = {},
): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: 'Az adat-kérdés nem lehet üres. Fogalmazd meg pontosan, mit szeretnél megtudni.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  deps.onRequestInfo?.(parsed.data.question);
  return {
    content:
      'A kérdést továbbítottam az adat-szolgáltatónak — a válasz a következő körödben érkezik. ' +
      'Most zárd le a köröd egy rövid mondattal (pl. „utánanézek”), NE találgass adatot.',
    isError: false,
    summary: `requestInfo — „${clip(parsed.data.question)}”`,
    rowCount: null,
  };
}

export const requestInfoTool = (
  report?: ToolReporter,
  deps: { onRequestInfo?: (question: string) => void } = {},
) =>
  tool({
    description:
      'Adat-kérés a katalógusról vagy a tudásbázisról (árak, készlet, fényigény, gondozás). ' +
      'Neked NINCS közvetlen adatbázis-hozzáférésed — minden tény-adatot ezzel kérj. ' +
      'Egy hívás = egy pontos, magyar kérdés.',
    inputSchema: z.object({
      question: z.string().describe('A pontos adat-kérdés magyarul.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeRequestInfo(input, deps);
      report?.(toolCallId, 'requestInfo', input, outcome);
      return outcome.content;
    },
  });
```

- [ ] **GREEN** — `cancel-package-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';

// cancelPackage tool — a flow-ból való kilépés EGYIK útja (a másik a sikeres savePackage).
// Az execute csak nyugtáz és RÖGZÍT: a lemondás ténye a tool-hívás maga — a reporter viszi a
// Trace-be és a data-tool partba, a flow-lock (findLastFlowSignal) EBBŐL látja, hogy a flow
// lezárult. Nincs DB-írás: a le nem zárt csomagterv csak a beszélgetésben élt.

const InputSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

export function executeCancelPackage(rawInput: unknown): ToolOutcome {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  const reason = parsed.success ? parsed.data.reason : undefined;
  return {
    content:
      'A csomag-összeállítást lemondtuk, semmi nem került mentésre. ' +
      'Nyugtázd a felhasználónak egy mondatban, és jelezd, hogy bármikor újrakezdhetitek.',
    isError: false,
    summary: `cancelPackage — ${reason ?? 'a felhasználó lemondta'}`,
    rowCount: null,
  };
}

export const cancelPackageTool = (report?: ToolReporter) =>
  tool({
    description:
      'A csomag-összeállítás LEMONDÁSA. Akkor hívd, ha a felhasználó kifejezetten lemondja ' +
      'a csomagot (nem kéri, elhalasztja, meggondolta magát). Ez zárja le a csomag-flow-t ' +
      'mentés nélkül.',
    inputSchema: z.object({
      reason: z.string().optional().describe('Rövid magyar indok, ha a felhasználó mondott.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = executeCancelPackage(input);
      report?.(toolCallId, 'cancelPackage', input, outcome);
      return outcome.content;
    },
  });
```

- [ ] `packages/core/src/index.ts` — a toolok blokkjába:

```ts
export * from './lib/tools/route-to/route-to-tool.js';
export * from './lib/tools/request-info/request-info-tool.js';
export * from './lib/tools/cancel-package/cancel-package-tool.js';
```

- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld.

**Commit:** `feat: route-to, request-info es cancel-package jelzo-toolok`

---

## 5. feladat — Toolok II: `validate-package` (determinisztikus Prisma-validálás, TDD)

**Files**
- Create: `packages/core/src/lib/tools/validate-package/package-validation.ts`
- Create: `packages/core/src/lib/tools/validate-package/validate-package-tool.ts`
- Create: `packages/core/src/lib/tools/validate-package/validate-package-tool.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export interface PackageRequestItem { productId: number; qty: number }
export interface PackageCriteria { light?: string; maxHeightCm?: number }
export type PackageValidation = { ok: true; plan: PackagePlan } | { ok: false; problems: string[] };
export function validatePackagePlan(prisma: PrismaClient, customerCode: string, items: PackageRequestItem[], criteria?: PackageCriteria): Promise<PackageValidation>;
export function executeValidatePackage(rawInput: unknown, deps?: { prisma?: PrismaClient; onPlan?: (plan: PackagePlan) => void }): Promise<ToolOutcome>;
export const validatePackageTool: (report?: ToolReporter, deps?: { onPlan?: (plan: PackagePlan) => void }) => Tool;
```

**Steps**

- [ ] **RED** — `validate-package-tool.spec.ts` (fake Prisma, a query-customers spec mintájára):

```ts
import { executeValidatePackage } from './validate-package-tool.js';

const customer = {
  id: 7, code: 'ACME', name: 'ACME Studio Kft.', budget: 30000, expertiseLevel: 'kezdő',
  petSafeRequired: true, kidSafeRequired: false,
};
const monstera = {
  id: 1, name: 'Monstera', price: 10000, salePrice: null, stock: 5,
  petSafe: true, kidSafe: true, difficulty: 'kezdő', light: 'közepes', maxHeightCm: 120,
};
const kroton = {
  id: 2, name: 'Kroton', price: 8000, salePrice: 6000, stock: 2,
  petSafe: false, kidSafe: false, difficulty: 'haladó', light: 'erős', maxHeightCm: 90,
};

function fakePrisma(cust: unknown, products: unknown[]) {
  return {
    customer: { findUnique: async () => cust },
    product: { findMany: async () => products },
  } as never;
}

describe('executeValidatePackage', () => {
  it('érvényes csomag → strukturált plan JSON-nal, onPlan lefut', async () => {
    let plan: unknown = null;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] },
      { prisma: fakePrisma(customer, [monstera]), onPlan: (p) => { plan = p; } },
    );
    expect(out.isError).toBe(false);
    const parsed = JSON.parse(out.content);
    expect(parsed.totalPrice).toBe(20000);
    expect(parsed.remaining).toBe(10000);
    expect(parsed.customerId).toBe(7);
    expect(plan).not.toBeNull();
  });

  it('budget kemény korlát: túllépés → hiba, onPlan NEM fut', async () => {
    let planCalled = false;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, // 40 000 > 30 000
      { prisma: fakePrisma(customer, [monstera]), onPlan: () => { planCalled = true; } },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('keret');
    expect(planCalled).toBe(false);
  });

  it('pet-safe és difficulty szabályok érvényesülnek (magyar hibalista)', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma(customer, [kroton]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('pet-safe');
    expect(out.content).toContain('haladó');
  });

  it('készlet-hiány → hiba a darabszámmal', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 9 }] },
      { prisma: fakePrisma(customer, [{ ...monstera, stock: 3 }]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('3');
  });

  it('fény- és méret-kritérium ellenőrzés', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }], light: 'árnyék', maxHeightCm: 100 },
      { prisma: fakePrisma(customer, [monstera]) },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('árnyék');
    expect(out.content).toContain('120');
  });

  it('ismeretlen ügyfél / termék → magyar hiba', async () => {
    const noCust = await executeValidatePackage(
      { customerCode: 'NINCS', items: [{ productId: 1, qty: 1 }] },
      { prisma: fakePrisma(null, []) },
    );
    expect(noCust.isError).toBe(true);
    const noProd = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 99, qty: 1 }] },
      { prisma: fakePrisma(customer, []) },
    );
    expect(noProd.isError).toBe(true);
    expect(noProd.content).toContain('99');
  });

  it('érvénytelen input és DB-hiba → ToolOutcome, nem exception', async () => {
    expect((await executeValidatePackage({ items: [] })).isError).toBe(true);
    const boom = { customer: { findUnique: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma: boom },
    );
    expect(out.isError).toBe(true);
  });

  it('akciós ár számít (salePrice, ha van)', async () => {
    const out = await executeValidatePackage(
      { customerCode: 'ACME', items: [{ productId: 2, qty: 1 }] },
      { prisma: fakePrisma({ ...customer, petSafeRequired: false, expertiseLevel: 'profi' }, [kroton]) },
    );
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content).totalPrice).toBe(6000);
  });
});
```

- [ ] `pnpm nx test core` — elvárt: PIROS.
- [ ] **GREEN** — `package-validation.ts` (a MEGOSZTOTT validáló mag — a savePackage is EZT
  futtatja újra mentés előtt):

```ts
import type { PrismaClient } from '@plantbase/db';
import type { PackagePlan, PackagePlanItem } from './package-plan.js';

// package-validation.ts — a csomag-validálás DETERMINISZTIKUS magja (nulla LLM). A tool
// kényszerít, a prompt csak terel: hiába állít össze a modell szabálysértő csomagot, itt
// magyar hibalistát kap vissza, és visszalép. A savePackage mentés előtt UGYANEZT futtatja
// újra — a két tool nem csúszhat el egymástól.

export interface PackageRequestItem {
  productId: number;
  qty: number;
}

/** A beszélgetésben tisztázott, ügyfél-táblán kívüli feltételek (méret, fényigény). */
export interface PackageCriteria {
  light?: string;
  maxHeightCm?: number;
}

export type PackageValidation =
  | { ok: true; plan: PackagePlan }
  | { ok: false; problems: string[] };

const DIFFICULTY_ORDER = ['kezdő', 'haladó', 'profi'] as const;
function difficultyRank(level: string): number {
  return DIFFICULTY_ORDER.indexOf(level as (typeof DIFFICULTY_ORDER)[number]);
}

export async function validatePackagePlan(
  prisma: PrismaClient,
  customerCode: string,
  items: PackageRequestItem[],
  criteria: PackageCriteria = {},
): Promise<PackageValidation> {
  const customer = await prisma.customer.findUnique({
    where: { code: customerCode.toUpperCase() },
  });
  if (!customer) {
    return { ok: false, problems: [`Nincs ${customerCode} kódú ügyfél a nyilvántartásban.`] };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const problems: string[] = [];
  const planItems: PackagePlanItem[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      problems.push(`Nincs ${item.productId} azonosítójú termék a katalógusban.`);
      continue;
    }
    if (product.stock < item.qty) {
      problems.push(`${product.name}: csak ${product.stock} db van raktáron (kért: ${item.qty}).`);
    }
    if (customer.petSafeRequired && !product.petSafe) {
      problems.push(`${product.name}: nem pet-safe, pedig az ügyfélnek ez kötelező.`);
    }
    if (customer.kidSafeRequired && !product.kidSafe) {
      problems.push(`${product.name}: nem kid-safe, pedig az ügyfélnek ez kötelező.`);
    }
    if (difficultyRank(product.difficulty) > difficultyRank(customer.expertiseLevel)) {
      problems.push(
        `${product.name}: ${product.difficulty} szintű gondozás, az ügyfél ${customer.expertiseLevel}.`,
      );
    }
    if (criteria.light && product.light !== criteria.light) {
      problems.push(`${product.name}: fényigénye ${product.light}, a kért ${criteria.light}.`);
    }
    if (criteria.maxHeightCm && product.maxHeightCm > criteria.maxHeightCm) {
      problems.push(
        `${product.name}: kifejlett magassága ${product.maxHeightCm} cm, a megengedett ${criteria.maxHeightCm} cm.`,
      );
    }
    const unitPrice = Number(product.salePrice ?? product.price);
    planItems.push({
      productId: product.id,
      name: product.name,
      qty: item.qty,
      unitPrice,
      lineTotal: unitPrice * item.qty,
    });
  }

  const totalPrice = planItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const budget = Number(customer.budget);
  // A KEMÉNY KORLÁT: az ügyfél kerete. Nem ajánlás — a validálás itt bukik, ha túllépné.
  if (totalPrice > budget) {
    problems.push(
      `Az összár ${totalPrice} Ft, az ügyfél kerete ${budget} Ft — a keret kemény korlát, csökkents darabszámot vagy cserélj tételt.`,
    );
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    plan: {
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      budget,
      items: planItems,
      totalPrice,
      remaining: budget - totalPrice,
    },
  };
}
```

- [ ] **GREEN** — `validate-package-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';
import { validatePackagePlan } from './package-validation.js';
import type { PackagePlan } from './package-plan.js';

// validatePackage tool — a TOOL-KAPU: a csomag-agent csak olyan csomagot vihet tovább, ami
// itt átmegy. Siker esetén a strukturált csomagtervet adja vissza (JSON) — ugyanez megy az
// onPlan callbacken a szervernek (data-package part → összesítő kártya a UI-ban).

export const PackageItemsSchema = z
  .array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1) }))
  .min(1);

const InputSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: PackageItemsSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

export async function executeValidatePackage(
  rawInput: unknown,
  deps: { prisma?: PrismaClient; onPlan?: (plan: PackagePlan) => void } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen csomag-kérés. Kötelező: customerCode (ügyfélkód) és items ' +
        '(legalább egy { productId, qty>=1 }); opcionális: light, maxHeightCm.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { customerCode, items, light, maxHeightCm } = parsed.data;
  try {
    const prisma = deps.prisma ?? getPrisma();
    const validation = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!validation.ok) {
      return {
        content: `A csomag NEM érvényes:\n- ${validation.problems.join('\n- ')}\nLazíts a feltételeken vagy csökkents darabszámot, és validálj újra.`,
        isError: true,
        summary: `validatePackage — hiba: ${validation.problems[0]}`,
        rowCount: null,
      };
    }
    deps.onPlan?.(validation.plan);
    return {
      content: JSON.stringify(validation.plan),
      isError: false,
      summary: `validatePackage — ${validation.plan.items.length} tétel · ${validation.plan.totalPrice} Ft (keret: ${validation.plan.budget} Ft)`,
      rowCount: validation.plan.items.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `A csomag-validálás nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const validatePackageTool = (
  report?: ToolReporter,
  deps: { onPlan?: (plan: PackagePlan) => void } = {},
) =>
  tool({
    description:
      'A csomagterv determinisztikus ellenőrzése MENTÉS ELŐTT: léteznek-e a termékek, van-e ' +
      'elég készlet, teljesül-e a pet/kid-safe igény, a gondozási szint (difficulty ≤ az ügyfél ' +
      'szintje), az opcionális fény/méret feltétel, és NEM lépi-e túl az összár az ügyfél ' +
      'keretét (kemény korlát). Siker esetén a strukturált csomagtervet adja vissza — EZUTÁN ' +
      'kérdezd meg a felhasználót: „Ez így rendben van?”.',
    inputSchema: z.object({
      customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
      items: z
        .array(z.object({
          productId: z.number().describe('Termék-azonosító a katalógusból.'),
          qty: z.number().describe('Darabszám (legalább 1).'),
        }))
        .describe('A csomag tételei.'),
      light: z.string().optional().describe('Kért fényigény, ha a beszélgetésben tisztáztátok.'),
      maxHeightCm: z.number().optional().describe('Maximális kifejlett magasság cm-ben, ha kérték.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeValidatePackage(input, deps);
      report?.(toolCallId, 'validatePackage', input, outcome);
      return outcome.content;
    },
  });
```

- [ ] `packages/core/src/index.ts`:

```ts
export * from './lib/tools/validate-package/package-validation.js';
export * from './lib/tools/validate-package/validate-package-tool.js';
```

- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld.

**Commit:** `feat: validate-package tool determinisztikus Prisma-validalassal`

---

## 6. feladat — Toolok III: `save-package` (újra-validálás + tranzakciós mentés, TDD)

**Files**
- Create: `packages/core/src/lib/tools/save-package/save-package-tool.ts` + `save-package-tool.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export function executeSavePackage(rawInput: unknown, deps?: { prisma?: PrismaClient }): Promise<ToolOutcome>;
export const savePackageTool: (report?: ToolReporter) => Tool;
```

**Steps**

- [ ] **RED** — `save-package-tool.spec.ts`:

```ts
import { executeSavePackage } from './save-package-tool.js';

const customer = {
  id: 7, code: 'ACME', name: 'ACME Studio Kft.', budget: 30000, expertiseLevel: 'kezdő',
  petSafeRequired: false, kidSafeRequired: false,
};
const monstera = {
  id: 1, name: 'Monstera', price: 10000, salePrice: null, stock: 5,
  petSafe: true, kidSafe: true, difficulty: 'kezdő', light: 'közepes', maxHeightCm: 120,
};

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const created: unknown[] = [];
  const tx = {
    package: { create: async ({ data }: { data: object }) => { created.push(data); return { id: 42, ...data }; } },
    packageItem: { createMany: async ({ data }: { data: object[] }) => { created.push(...data); return { count: data.length }; } },
  };
  return {
    prisma: {
      customer: { findUnique: async () => customer },
      product: { findMany: async () => [monstera] },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      ...overrides,
    } as never,
    created,
  };
}

describe('executeSavePackage', () => {
  it('érvényes csomag → mentés, a válaszban a csomag-azonosító és az összár', async () => {
    const { prisma, created } = fakePrisma();
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 2 }] }, { prisma },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toContain('#42');
    expect(out.content).toContain('20000');
    expect(created.length).toBe(2); // 1 package + 1 item-sor
  });

  it('ÚJRA validál: érvénytelen csomag NEM íródik be', async () => {
    const { prisma, created } = fakePrisma();
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 4 }] }, { prisma }, // 40 000 > keret
    );
    expect(out.isError).toBe(true);
    expect(created.length).toBe(0);
  });

  it('DB-hiba a tranzakcióban → ToolOutcome hiba, nem exception', async () => {
    const { prisma } = fakePrisma({
      $transaction: async () => { throw new Error('kapcsolat megszakadt'); },
    });
    const out = await executeSavePackage(
      { customerCode: 'ACME', items: [{ productId: 1, qty: 1 }] }, { prisma },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('mentés');
  });

  it('érvénytelen input → magyar hiba', async () => {
    expect((await executeSavePackage({})).isError).toBe(true);
  });
});
```

- [ ] `pnpm nx test core` — elvárt: PIROS.
- [ ] **GREEN** — `save-package-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';
import { validatePackagePlan } from '../validate-package/package-validation.js';
import { PackageItemsSchema } from '../validate-package/validate-package-tool.js';

// savePackage tool — az EGYETLEN írási út a packages/package_items táblákba. Mentés előtt
// ÚJRA lefuttatja UGYANAZT a validálást (package-validation.ts): a modell nem tud „elavult”
// vagy manipulált csomagtervet menteni — a kapu a mentés pillanatában is zárva van.
// Sikeres mentés = a flow strukturált záró jelzése (a flow-lock ebből olvas).

const InputSchema = z.object({
  customerCode: z.string().trim().min(1),
  items: PackageItemsSchema,
  light: z.string().trim().min(1).optional(),
  maxHeightCm: z.number().int().positive().optional(),
});

export async function executeSavePackage(
  rawInput: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen mentési kérés. Ugyanazokat a mezőket add meg, mint a validatePackage-nél: ' +
        'customerCode és items (opcionálisan light, maxHeightCm).',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { customerCode, items, light, maxHeightCm } = parsed.data;
  try {
    const prisma = deps.prisma ?? getPrisma();
    // ÚJRA-VALIDÁLÁS — csak validált csomag kerülhet az adatbázisba.
    const validation = await validatePackagePlan(prisma, customerCode, items, { light, maxHeightCm });
    if (!validation.ok) {
      return {
        content: `A csomag mentés előtt megbukott az újra-validáláson:\n- ${validation.problems.join('\n- ')}\nValidáld újra a javított csomagot, mielőtt mentenél.`,
        isError: true,
        summary: `savePackage — hiba: ${validation.problems[0]}`,
        rowCount: null,
      };
    }
    const { plan } = validation;
    const saved = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.create({
        data: { customerId: plan.customerId, totalPrice: plan.totalPrice },
      });
      await tx.packageItem.createMany({
        data: plan.items.map((i) => ({ packageId: pkg.id, productId: i.productId, qty: i.qty })),
      });
      return pkg;
    });
    const itemList = plan.items.map((i) => `${i.name} ×${i.qty}`).join(', ');
    return {
      content: `A csomag elmentve (azonosító: #${saved.id}). Tételek: ${itemList}. Összár: ${plan.totalPrice} Ft (keret: ${plan.budget} Ft). Add át a felhasználónak ezt a végleges visszajelzést egy mondatban.`,
      isError: false,
      summary: `savePackage — #${saved.id} · ${plan.items.length} tétel · ${plan.totalPrice} Ft`,
      rowCount: plan.items.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `A csomag mentése nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const savePackageTool = (report?: ToolReporter) =>
  tool({
    description:
      'A validált csomag VÉGLEGES mentése az adatbázisba. KIZÁRÓLAG azután hívd, hogy (1) a ' +
      'validatePackage sikeres volt ÉS (2) a felhasználó kifejezetten megerősítette az ' +
      'összesítőt („Ez így rendben van?” → igen). Mentés előtt a tool újra validál.',
    inputSchema: z.object({
      customerCode: z.string().describe('Az ügyfél kódja, pl. ACME.'),
      items: z
        .array(z.object({
          productId: z.number().describe('Termék-azonosító.'),
          qty: z.number().describe('Darabszám.'),
        }))
        .describe('A megerősített csomag tételei — ugyanazok, mint a sikeres validálásnál.'),
      light: z.string().optional().describe('Fény-feltétel, ha a validálásnál is szerepelt.'),
      maxHeightCm: z.number().optional().describe('Méret-feltétel, ha a validálásnál is szerepelt.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeSavePackage(input);
      report?.(toolCallId, 'savePackage', input, outcome);
      return outcome.content;
    },
  });
```

  Megjegyzés: az `InputSchema` a `validate-package-tool.ts`-ből exportált `PackageItemsSchema`-t
  használja — a két tool bemenete definíció szerint azonos, nem csúszhat el.

- [ ] `packages/core/src/index.ts`: `export * from './lib/tools/save-package/save-package-tool.js';`
- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld.

**Commit:** `feat: save-package tool ujra-validalassal es tranzakcios mentessel`

---

## 7. feladat — Toolok IV: `ask-info-agent` (delegate mód kapcsa, TDD)

**Files**
- Create: `packages/core/src/lib/tools/ask-info-agent/ask-info-agent-tool.ts` + `ask-info-agent-tool.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export type InfoRunner = (question: string, options?: QueryAskOptions) => Promise<AskResult>;
export function executeAskInfoAgent(rawInput: unknown, deps?: { run?: InfoRunner; print?: boolean; onToolEvent?: ToolReporter }): Promise<ToolOutcome>;
export const askInfoAgentTool: (report?: ToolReporter, options?: { print?: boolean; onToolEvent?: ToolReporter }) => Tool;
```

**Steps**

- [ ] **RED** — `ask-info-agent-tool.spec.ts` (a delegate-to-ingest spec mintájára, injektált runnerrel):

```ts
import { executeAskInfoAgent } from './ask-info-agent-tool.js';
import type { AskResult } from '../../agents/agent-loop.js';

const fakeResult = (answer: string): AskResult => ({
  answer, messages: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'stop', tracePath: '/tmp/t.json',
});

describe('executeAskInfoAgent', () => {
  it('lefuttatja az info-agentet és a válaszát adja vissza', async () => {
    const out = await executeAskInfoAgent(
      { question: 'Hány pet-safe növény van 10 000 Ft alatt?' },
      { run: async (q) => fakeResult(`4 találat a kérdésre: ${q}`) },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toContain('4 találat');
    expect(out.summary).toContain('info-agent');
  });

  it('üres kérdés → hiba, a runner NEM fut', async () => {
    let ran = false;
    const out = await executeAskInfoAgent(
      { question: ' ' },
      { run: async () => { ran = true; return fakeResult('x'); } },
    );
    expect(out.isError).toBe(true);
    expect(ran).toBe(false);
  });

  it('a beágyazott agent hibája → magyar ToolOutcome, nem exception', async () => {
    const out = await executeAskInfoAgent(
      { question: 'mi?' },
      { run: async () => { throw new Error('modell nem elérhető'); } },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('modell nem elérhető');
  });

  it('a print és az onToolEvent opciót továbbadja a runnernek', async () => {
    let received: unknown = null;
    const reporter = () => undefined;
    await executeAskInfoAgent(
      { question: 'mi?' },
      { run: async (_q, options) => { received = options; return fakeResult('x'); }, print: false, onToolEvent: reporter },
    );
    expect(received).toMatchObject({ role: 'customer', print: false });
    expect((received as { onToolEvent?: unknown }).onToolEvent).toBe(reporter);
  });
});
```

- [ ] `pnpm nx test core` — elvárt: PIROS.
- [ ] **GREEN** — `ask-info-agent-tool.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import type { AskResult } from '../../agents/agent-loop.js';
import { askAgent, type QueryAskOptions } from '../../agents/query-agent/query-agent.js';

// askInfoAgent tool — a DELEGATE mód „kapcsa”, a delegateToIngest mintájára: a csomag-agent
// EGY TOOL-HÍVÁS mögött a TELJES info-agentet (a meglévő query-agent) futtatja le, és annak
// összegzését kapja vissza. Az adat-kérés NEM hagyja el a csomag-agent körét — nincs
// orchestrator-közvetítés. KONTRASZT a requestInfo-val: ugyanaz a tool-felület (kérdés be,
// válasz vissza), csak az execute más — ez a demó egy mondata.

export type InfoRunner = (
  question: string,
  options?: QueryAskOptions,
) => Promise<AskResult>;

const InputSchema = z.object({
  question: z.string().trim().min(1),
});

function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

export async function executeAskInfoAgent(
  rawInput: unknown,
  deps: { run?: InfoRunner; print?: boolean; onToolEvent?: ToolReporter } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: 'Az info-agentnek adott kérdés nem lehet üres.',
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const run = deps.run ?? askAgent;
  try {
    // A beágyazott loop tool-eseményei az onToolEvent-en át jutnak ki — delegate módban a
    // UI ezekből rajzolja a BEHÚZOTT chipeket a csomag-agent chipje alatt.
    const result = await run(parsed.data.question, {
      role: 'customer',
      print: deps.print,
      onToolEvent: deps.onToolEvent,
    });
    return {
      content: result.answer,
      isError: false,
      summary: `info-agent ← „${clip(parsed.data.question)}”`,
      rowCount: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Az info-agent nem tudott válaszolni: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const askInfoAgentTool = (
  report?: ToolReporter,
  options: { print?: boolean; onToolEvent?: ToolReporter } = {},
) =>
  tool({
    description:
      'Adat-kérés a katalógusról vagy a tudásbázisról (árak, készlet, fényigény, gondozás). ' +
      'Neked NINCS közvetlen adatbázis-hozzáférésed — minden tény-adatot ezzel kérj. ' +
      'Egy hívás = egy pontos, magyar kérdés; a tool a válasz összegzését adja vissza.',
    inputSchema: z.object({
      question: z.string().describe('A pontos adat-kérdés magyarul.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeAskInfoAgent(input, {
        print: options.print,
        onToolEvent: options.onToolEvent,
      });
      report?.(toolCallId, 'askInfoAgent', input, outcome);
      return outcome.content;
    },
  });
```

  FIGYELEM: a `description` szándékosan (majdnem) azonos a `requestInfoTool`-éval — a spec
  kontraszt-mondata: *ugyanaz a tool-felület, csak az execute más.*

- [ ] `packages/core/src/index.ts`: `export * from './lib/tools/ask-info-agent/ask-info-agent-tool.js';`
- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld.

**Commit:** `feat: ask-info-agent tool (delegate mod, beagyazott agent-loop)`

---

## 8. feladat — Csomag-agent (`package-agent` + prompt)

**Files**
- Create: `packages/core/src/lib/agents/package-agent/package-agent.ts`
- Create: `packages/core/src/lib/agents/package-agent/package-prompt.ts`
- Create: `packages/core/src/lib/agents/package-agent/package-agent.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export type PackageHandoverMode = 'router' | 'delegate';
export interface PackageAskOptions extends AskOptions {
  mode: PackageHandoverMode;
  onRequestInfo?: (question: string) => void;   // csak router módban hívódik
  onPlan?: (plan: PackagePlan) => void;         // sikeres validatePackage → data-package part
  onNestedToolEvent?: ToolReporter;             // csak delegate: a beágyazott info-agent eseményei
}
export function buildPackageToolset(options: PackageAskOptions, report?: ToolReporter): ToolSet;
export function askPackageAgent(question: string, options: PackageAskOptions): Promise<AskResult>;
export function buildPackagePrompt(mode: PackageHandoverMode): string;
```

**Steps**

- [ ] `package-prompt.ts` (a query-prompt XML-tagelt stílusában):

```ts
import type { PackageHandoverMode } from './package-agent.js';

// package-prompt.ts — a CSOMAG-agent system promptja. A tool kényszerít (validatePackage,
// savePackage kapui), a prompt TEREL: kérdés-sorrend, megerősítés mentés előtt, visszaterelés.
// MÓDFÜGGŐ rész: honnan jön az adat — router módban requestInfo, delegate módban askInfoAgent.
// A felület mindkettőben ugyanaz (kérdés be, adat vissza), ezért a prompt többi része közös.

export function buildPackagePrompt(mode: PackageHandoverMode): string {
  const dataTool = mode === 'router' ? 'requestInfo' : 'askInfoAgent';
  return `
<role>
Te a Plantbase CSOMAG-ÖSSZEÁLLÍTÓ asszisztense vagy: egy lakberendező ügyfeleinek állítasz
össze növénycsomagot 4-5 irányított kérdéssel. Magyarul beszélsz, tömören és barátságosan.
</role>

<flow>
EGYSZERRE EGY kérdést tegyél fel, ebben a sorrendben:
1. ÜGYFÉL: kérd el az ügyfélkódot vagy nevet, és a queryCustomers toollal töltsd be a
   profilját (keret, szint, pet/kid-safe, notes).
2-4. MÉRET, FÉNYIGÉNY, PET/KID-SAFE, DARABSZÁM: a betöltött preferenciákból ELŐTÖLTÖTT
   javaslatot adj („a keret 250 000 Ft és kezdő szint — maradjunk ennél?”) — a felhasználó
   felülbírálhat.
5. Ha minden feltétel megvan: kérj termék-adatokat a(z) ${dataTool} toollal, állíts össze
   csomagtervet, és futtasd a validatePackage-et.
</flow>

<data>
NINCS közvetlen adatbázis-hozzáférésed a katalógushoz (nincs runSql toolod). MINDEN
termék-tényt (azonosítók, árak, készlet, fényigény) a(z) ${dataTool} toollal kérj le.
Terméket, árat, készletet KITALÁLNI TILOS.
</data>

<gates>
- validatePackage: MINDEN csomagtervet validálj, mielőtt megmutatod. Ha hibát ad (pl. „csak
  4 találat a feltételekre”, keret-túllépés), lépj vissza: ajánlj feltétel-lazítást vagy
  kevesebb darabot, és validálj újra.
- SIKERES validálás után az összesítő megjelenik a felhasználónak — te CSAK a záró kérdést
  tedd fel szövegben: „Ez így rendben van?”. A mentés NEM automatikus.
- savePackage: KIZÁRÓLAG a felhasználó kifejezett megerősítése UTÁN. Módosítás-kérésnél
  vissza a kérdezgetésbe (új validálás új összesítőt ad).
- Sikeres mentés után adj VÉGLEGES visszajelzést: csomag-azonosító, összár, tételek egy
  mondatban. Ezzel a flow lezárult.
</gates>

<exit>
A flow-ból PONTOSAN két út vezet ki, mindkettő tool-hívás:
- a felhasználó kifejezetten lemond → cancelPackage;
- megerősített mentés → savePackage.
Ha a felhasználó menet közben MÁSRÓL kezd beszélni, kedvesen tereld vissza („szívesen
válaszolok utána — előbb fejezzük be a csomagot: …”), és ismételd meg az aktuális kérdést.
NE válaszold meg az oda nem tartozó kérdést, és NE zárd le a flow-t jelzés nélkül.
</exit>
`.trim();
}
```

- [ ] `package-agent.ts`:

```ts
import type { ToolSet } from 'ai';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import type { ToolReporter } from '../../tools/tool-outcome.js';
import type { PackagePlan } from '../../tools/validate-package/package-plan.js';
import { buildPackagePrompt } from './package-prompt.js';
import { queryCustomersTool } from '../../tools/query-customers/query-customers-tool.js';
import { validatePackageTool } from '../../tools/validate-package/validate-package-tool.js';
import { savePackageTool } from '../../tools/save-package/save-package-tool.js';
import { cancelPackageTool } from '../../tools/cancel-package/cancel-package-tool.js';
import { requestInfoTool } from '../../tools/request-info/request-info-tool.js';
import { askInfoAgentTool } from '../../tools/ask-info-agent/ask-info-agent-tool.js';

// package-agent.ts — a CSOMAG-ÖSSZEÁLLÍTÓ agent. Egy agent = prompt + toolok + loop.
// NINCS saját runSql-je: adatot az info-agenttől kér — a MÓD dönti el, hogyan:
//   router   → requestInfo  (üres execute; az orchestrator közvetíti a kérdést)
//   delegate → askInfoAgent (az execute MAGA futtatja az info-agent loopját)
// Ugyanaz a tool-felület, csak az execute más — ez a két orchestration-mód kontrasztja.

export type PackageHandoverMode = 'router' | 'delegate';

export interface PackageAskOptions extends AskOptions {
  mode: PackageHandoverMode;
  /** Router mód: a requestInfo toollal rögzített adat-kérdés ide érkezik. */
  onRequestInfo?: (question: string) => void;
  /** Sikeres validatePackage → a strukturált csomagterv (data-package part lesz belőle). */
  onPlan?: (plan: PackagePlan) => void;
  /** Delegate mód: a beágyazott info-agent tool-eseményei (a UI behúzva rajzolja). */
  onNestedToolEvent?: ToolReporter;
}

export function buildPackageToolset(
  options: PackageAskOptions,
  report?: ToolReporter,
): ToolSet {
  return {
    queryCustomers: queryCustomersTool(report),
    validatePackage: validatePackageTool(report, { onPlan: options.onPlan }),
    savePackage: savePackageTool(report),
    cancelPackage: cancelPackageTool(report),
    // A MÓDFÜGGŐ kapocs — a toolset többi része azonos.
    ...(options.mode === 'router'
      ? { requestInfo: requestInfoTool(report, { onRequestInfo: options.onRequestInfo }) }
      : {
          askInfoAgent: askInfoAgentTool(report, {
            print: options.print,
            onToolEvent: options.onNestedToolEvent,
          }),
        }),
  };
}

export async function askPackageAgent(
  question: string,
  options: PackageAskOptions,
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres üzenettel nem lehet csomagot összeállítani.');
  }
  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildPackagePrompt(options.mode),
      buildTools: (report): ToolSet => buildPackageToolset(options, report),
      // A flow hosszú lehet: ügyfél-lekérdezés + adat-kérés + validálás + mentés egy körben is.
      maxSteps: 10,
      maxOutputTokens: 2500,
      emptyAnswer:
        'Nem sikerült befejezni a lépést a megengedett körszámon belül. Folytassuk: melyik feltételnél tartottunk?',
    },
    options,
  );
}
```

- [ ] `package-agent.spec.ts` — a toolset mód-függését teszteljük (modell-hívás nélkül):

```ts
import { buildPackageToolset } from './package-agent.js';
import { buildPackagePrompt } from './package-prompt.js';

describe('buildPackageToolset', () => {
  it('router mód: requestInfo VAN, askInfoAgent NINCS', () => {
    const tools = buildPackageToolset({ mode: 'router' });
    expect(Object.keys(tools)).toContain('requestInfo');
    expect(Object.keys(tools)).not.toContain('askInfoAgent');
    expect(Object.keys(tools)).not.toContain('runSql'); // nincs saját adat-út
  });

  it('delegate mód: askInfoAgent VAN, requestInfo NINCS', () => {
    const tools = buildPackageToolset({ mode: 'delegate' });
    expect(Object.keys(tools)).toContain('askInfoAgent');
    expect(Object.keys(tools)).not.toContain('requestInfo');
  });

  it('a közös kapuk mindkét módban ott vannak', () => {
    for (const mode of ['router', 'delegate'] as const) {
      const names = Object.keys(buildPackageToolset({ mode }));
      expect(names).toEqual(expect.arrayContaining(['queryCustomers', 'validatePackage', 'savePackage', 'cancelPackage']));
    }
  });
});

describe('buildPackagePrompt', () => {
  it('a prompt a mód szerinti adat-toolt írja le — nem csúszhat el a toolsettől', () => {
    expect(buildPackagePrompt('router')).toContain('requestInfo');
    expect(buildPackagePrompt('router')).not.toContain('askInfoAgent');
    expect(buildPackagePrompt('delegate')).toContain('askInfoAgent');
  });
});
```

- [ ] `packages/core/src/index.ts`:

```ts
export * from './lib/agents/package-agent/package-agent.js';
export * from './lib/agents/package-agent/package-prompt.js';
```

- [ ] `pnpm nx test core && pnpm typecheck` — elvárt: zöld.

**Commit:** `feat: package-agent modfuggo toolsettel es iranyitott-kerdeses prompttal`

---

## 9. feladat — Orchestrator: prompt, routing-döntés, két handover, belépési pont

**Files**
- Create: `packages/core/src/lib/agents/orchestrator-agent/orchestrator-prompt.ts`
- Create: `packages/core/src/lib/agents/orchestrator-agent/router-handover.ts`
- Create: `packages/core/src/lib/agents/orchestrator-agent/delegate-handover.ts`
- Create: `packages/core/src/lib/agents/orchestrator-agent/orchestrator-agent.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produkált)**
```ts
export type OrchestratorEvent =
  | { type: 'agent'; agent: 'info' | 'package' }
  | { type: 'tool'; data: ToolEventData }
  | { type: 'package'; plan: PackagePlan };

export interface OrchestratedOptions {
  mode: 'router' | 'delegate';
  history?: Message[];                    // modell-előzmény (data-partok NÉLKÜL)
  uiHistory?: FlowHistoryMessage[];       // UI-előzmény data-partokKAL — a flow-lockhoz
  print?: boolean;
  onTextDelta?: (delta: string) => void;
  onEvent?: (event: OrchestratorEvent) => void;
}
export function runOrchestrated(question: string, options: OrchestratedOptions): Promise<AskResult>;
```

**Steps**

- [ ] `orchestrator-prompt.ts`:

```ts
// orchestrator-prompt.ts — az ORCHESTRATOR system promptja. Az orchestrator SOHA nem beszél
// a felhasználóval: egyetlen dolga a routeTo tool hívása. Gyors, olcsó döntés — a szöveges
// kimenetét senki nem olvassa, csak a tool-hívása számít.

export function buildOrchestratorPrompt(): string {
  return `
<role>
Te a Plantbase FORGALOMIRÁNYÍTÓJA vagy. SOHA nem válaszolsz a felhasználónak — egyetlen
feladatod: a routeTo tool PONTOSAN EGYSZERI hívásával eldönteni, melyik agent dolgozzon.
</role>

<agents>
- info-agent: adat- és tudás-kérdések — katalógus (árak, készlet, méretek, fényigény),
  növénygondozás, ügyfelek listázása. Minden, ami KÉRDEZÉS.
- package-agent: ügyfél-CSOMAG összeállítása, módosítása, megerősítése, mentése, lemondása.
  Minden, ami a csomag-flow-hoz tartozik — akkor is, ha kérdésnek hangzik, de a folyamatban
  lévő csomagról szól.
</agents>

<rules>
- MINDIG hívd a routeTo-t, pontosan egyszer, rövid magyar indoklással.
- Ha az előzményben csomag-összeállítás zajlik, és a felhasználó arra reagál → package-agent.
- Kétes esetben (üdvözlés, csevegés) → info-agent.
</rules>
`.trim();
}
```

- [ ] `router-handover.ts`:

```ts
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
```

- [ ] `delegate-handover.ts`:

```ts
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
```

- [ ] `orchestrator-agent.ts` (belépési pont + routing-döntés):

```ts
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
```

- [ ] `packages/core/src/index.ts` — a 2. feladatban felvett orchestrator-blokk bővítése:

```ts
export * from './lib/agents/orchestrator-agent/orchestrator-agent.js';
export * from './lib/agents/orchestrator-agent/orchestrator-prompt.js';
export * from './lib/agents/orchestrator-agent/router-handover.js';
export * from './lib/agents/orchestrator-agent/delegate-handover.js';
```

- [ ] `pnpm nx test core && pnpm typecheck && pnpm lint` — elvárt: zöld.
- [ ] Kézi füst-teszt (DB fut, `.env` kulccsal): átmeneti szkripttel vagy node REPL-lel:
  `pnpm tsx --conditions=@plantbase/source -e "import('@plantbase/core').then(async (c) => { const r = await c.runOrchestrated('Szia! Milyen pet-safe növényeitek vannak?', { mode: 'router', print: true, onEvent: (e) => console.log('EVENT', JSON.stringify(e)) }); console.log(r.answer); })"`
  — elvárt: a konzolon `EVENT {"type":"tool","data":{...routeTo → info-agent...}}`, majd
  `EVENT {"type":"agent","agent":"info"}`, tool-események és magyar válasz.

**Commit:** `feat: orchestrator-agent routing-donteessel, router- es delegate-handoverrel`

---

## 10. feladat — Szerver: `chat-stream.ts` + minimális `main.ts` módosítás

**Files**
- Create: `apps/server/src/chat-stream.ts`
- Modify: `apps/server/src/main.ts` (csak a `/api/chat` handler 2 pontja)

**Hogyan jut ki a beágyazott agent-aktivitás a streambe (a konkrét vezeték):**
core `ToolReporter` (tool-outcome.ts) → `AskOptions.onToolEvent` (3. feladat) →
`OrchestratorEvent` callbackek (9. feladat) → **ebben a fájlban** `writer.write()` data-partok.
A szöveg az `onTextDelta`-n jön (a runAgentLoop maga fogyasztja a fullStreamet, mert
orchestrált módban NEM adunk `onStream`-et), és kézzel írt `text-start/delta/end`
chunkokként megy ki — így a szöveg és a data-partok idő-helyesen fésülődnek össze.

**Interfaces (fogyasztott, node_modules-ban ellenőrizve):**
`UIMessageStreamWriter.write(chunk)`, chunk-alakok: `{type:'start'}`, `{type:'finish'}`,
`{type:'text-start',id}`, `{type:'text-delta',id,delta}`, `{type:'text-end',id}`,
`{type:'data-agent'|'data-tool'|'data-package', data}`.

**Steps**

- [ ] `chat-stream.ts`:

```ts
import type { ModelMessage, UIMessage, UIMessageStreamWriter } from 'ai';
import {
  askAgent,
  getOrchestrationMode,
  runOrchestrated,
  type OrchestratorEvent,
} from '@plantbase/core';

// chat-stream.ts — a PROTOKOLL-TRANSZFORMÁCIÓ egyetlen fájlba zárva: a core callback-jei
// (onTextDelta, OrchestratorEvent) → AI SDK UI message stream chunkok. A main.ts handler
// vékony marad.
//
// KÉT ÚT:
//   off  → a MAI kódút, bájtra pontosan: askAgent + writer.merge(result.toUIMessageStream()).
//   router/delegate → runOrchestrated; a szöveg kézzel írt text-chunkokként megy ki, a
//     tool-/agent-/csomag-események data-* partokként. Minden data-part a mentett assistant
//     üzenet része lesz (onFinish menti), így újratöltéskor a badge/chip/kártya visszarajzolódik;
//     a modell-előzményből a stripDataParts (threads.ts) szűri ki őket.

export async function streamChat(args: {
  question: string;
  history: ModelMessage[];
  uiHistory: UIMessage[];
  writer: UIMessageStreamWriter;
}): Promise<void> {
  const mode = getOrchestrationMode();
  if (mode === 'off') {
    // VÁLTOZATLAN viselkedés — ez a sor korábban a main.ts-ben élt.
    await askAgent(args.question, {
      print: true,
      history: args.history,
      onStream: (result) => args.writer.merge(result.toUIMessageStream()),
    });
    return;
  }

  const { writer } = args;
  writer.write({ type: 'start' });

  // Szöveg-blokk könyvelés: data-part érkezésekor lezárjuk az épp nyitott text-blokkot,
  // így a kliens időrendben látja: badge → chipek → szöveg → (újabb chipek) → szöveg.
  let textCounter = 0;
  let openTextId: string | null = null;
  const closeText = (): void => {
    if (openTextId !== null) {
      writer.write({ type: 'text-end', id: openTextId });
      openTextId = null;
    }
  };
  const onTextDelta = (delta: string): void => {
    if (openTextId === null) {
      textCounter += 1;
      openTextId = `txt-${textCounter}`;
      writer.write({ type: 'text-start', id: openTextId });
    }
    writer.write({ type: 'text-delta', id: openTextId, delta });
  };
  const onEvent = (event: OrchestratorEvent): void => {
    closeText();
    if (event.type === 'agent') {
      writer.write({ type: 'data-agent', data: { agent: event.agent } });
    } else if (event.type === 'tool') {
      writer.write({ type: 'data-tool', data: event.data });
    } else {
      writer.write({ type: 'data-package', data: event.plan });
    }
  };

  try {
    await runOrchestrated(args.question, {
      mode,
      history: args.history,
      uiHistory: args.uiHistory,
      print: true,
      onTextDelta,
      onEvent,
    });
  } finally {
    closeText();
    writer.write({ type: 'finish' });
  }
}
```

- [ ] `main.ts` — pontosan KÉT módosítás.
  (1) Import-blokk: az `askAgent` maradhat az importban, de a handler már nem hívja; vedd fel:
  `import { streamChat } from './chat-stream.js';` (és az `askAgent` kikerül a `@plantbase/core`
  importból, mert a chat-stream.ts importálja).
  (2) A handler (2) és (4) lépése:

```ts
    // (2) Előzmény a DB-ből (a mostani üzenet ELŐTTI állapot) → modell-előzmény.
    const priorRows = await prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    // Ha egy korábbi futás hibázott, lógó user-üzenet maradhatott a végén — azt kihagyjuk,
    // különben két user-kör kerülne egymás után az előzménybe.
    // A data-partokat CSAK a modell-előzményből szűrjük — a flow-lock (chat-stream) pont
    // ezekből olvassa ki az állapotot, ezért az UI-alakot is megőrizzük.
    const priorUI = dropTrailingUserRow(priorRows).map(rowToUIMessage);
    const history = await convertToModelMessages(stripDataParts(priorUI));
```

  és a `createUIMessageStream` execute-jában az `askAgent(...)` hívás cseréje:

```ts
      execute: async ({ writer }) => {
        writer.write({ type: 'data-thread', data: { threadId: thread.id } });
        // off módban a mai askAgent-út fut változatlanul; router/delegate módban az
        // orchestrator — a protokoll-transzformáció a chat-stream.ts-ben (egyetlen fájl).
        await streamChat({ question, history, uiHistory: priorUI, writer });
      },
```

- [ ] `pnpm typecheck && pnpm lint` — zöld.
- [ ] **Visszafelé-kompatibilitási füst-teszt** (flag nélkül): `pnpm server` egyik terminálban,
  másikban:
  `curl -sN localhost:3001/api/chat -H 'content-type: application/json' -d '{"message":{"id":"m1","role":"user","parts":[{"type":"text","text":"Mutass 3 pet-safe növényt raktáron"}]}}' | head -30`
  — elvárt: SSE stream `data-thread` parttal, `tool-runSql` partokkal és text-deltákkal,
  PONTOSAN mint eddig (nincs `data-agent`/`data-tool` part).
- [ ] Orchestrált füst-teszt: `ORCHESTRATION_MODE=router pnpm server`, ugyanaz a curl —
  elvárt: a streamben `data-tool` part `routeTo → info-agent` summary-vel, `data-agent` part,
  majd text-chunkok.

**Commit:** `feat: chat-stream retegi modvalaszto — orchestralt stream data-partokkal`

---

## 11. feladat — Web UI: agent-badge, routing-chip, tool-chipek, csomag-összesítő kártya

**Files**
- Modify: `apps/web/src/lib/message-parts.ts`
- Create: `apps/web/src/components/agent-chips.tsx`
- Create: `apps/web/src/components/package-summary.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces (produkált)**
```ts
// message-parts.ts
export interface ToolEventData { agent: string; toolName: string; summary: string | null; isError: boolean; rowCount: number | null; nested: boolean; targetAgent?: string; reason?: string }
export interface PackagePlanItem { productId: number; name: string; qty: number; unitPrice: number; lineTotal: number }
export interface PackagePlan { customerId: number; customerCode: string; customerName: string; budget: number; items: PackagePlanItem[]; totalPrice: number; remaining: number }
export function splitAssistantParts(m: UIMessage): { text: string; toolParts: ToolUIPart[]; agent: string | null; toolEvents: ToolEventData[]; packagePlan: PackagePlan | null };
```

**Steps**

- [ ] `message-parts.ts` — bővítés (a meglévő `splitAssistantParts` kiegészítése; a
  `ToolEventData`/`PackagePlan` alak a core-belivel azonos — a web nem importál a core-ból,
  a stream a szerződés):

```ts
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
```

- [ ] `agent-chips.tsx`:

```tsx
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
```

- [ ] `package-summary.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import type { PackagePlan } from '@/lib/message-parts';

// package-summary.tsx — a CSOMAG-ÖSSZESÍTŐ KÁRTYA a data-package partból. A két gomb csak
// egy előre írt chat-üzenetet küld be — nincs külön API-út: a megerősítés is a
// beszélgetésben él, az agent dönt rá tool-hívással (savePackage / vissza a kérdezgetésbe).

interface PackageSummaryProps {
  plan: PackagePlan;
  disabled: boolean;
  onConfirm: () => void;
  onModify: () => void;
}

const huf = (n: number): string => `${n.toLocaleString('hu-HU')} Ft`;

export function PackageSummary({ plan, disabled, onConfirm, onModify }: PackageSummaryProps) {
  return (
    <div data-testid="package-summary" className="my-2 rounded-lg border bg-background/60 p-3 text-sm">
      <p className="mb-2 font-medium">
        📦 Csomagterv — {plan.customerName} ({plan.customerCode})
      </p>
      <table className="w-full text-xs">
        <tbody>
          {plan.items.map((item) => (
            <tr key={item.productId} className="border-b last:border-0">
              <td className="py-1">{item.name}</td>
              <td className="py-1 text-right">{item.qty} db</td>
              <td className="py-1 text-right">{huf(item.unitPrice)}</td>
              <td className="py-1 text-right font-medium">{huf(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>Összesen: <strong className="text-foreground">{huf(plan.totalPrice)}</strong></span>
        <span>Keret: {huf(plan.budget)} · marad: {huf(plan.remaining)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={disabled} onClick={onConfirm}>
          Rendben, mentsd
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onModify}>
          Módosítanék
        </Button>
      </div>
    </div>
  );
}
```

- [ ] `App.tsx` — az assistant render-ág bővítése. Az importokhoz:
  `import { AgentBadge, ToolChip } from '@/components/agent-chips';` és
  `import { PackageSummary } from '@/components/package-summary';`.
  A `messages.map` callbackben a destrukturálás cseréje:
  `const { text, toolParts, agent, toolEvents, packagePlan } = splitAssistantParts(m);`
  és az assistant-ág (a meglévő `<div className="inline-block max-w-[85%] text-left">` belseje)
  a tool-kártyák ELÉ kap három blokkot:

```tsx
                        <div className="inline-block max-w-[85%] text-left">
                          {/* Orchestrált mód: KI beszél (badge) + a döntések/tool-futások chipjei. */}
                          {agent && <AgentBadge agent={agent} />}
                          {toolEvents.map((event, index) => (
                            <ToolChip key={`${m.id}-event-${index}`} event={event} />
                          ))}
                          {/* ELŐSZÖR a tool-lépések (mit csinált), UTÁNA a válasz (mit mond). */}
                          {toolParts.map((part, index) => (
                            <ToolCard
                              key={`${m.id}-tool-${index}`}
                              toolName={part.type.replace('tool-', '')}
                              state={part.state}
                              input={part.input}
                              output={part.output}
                            />
                          ))}
                          {packagePlan && (
                            <PackageSummary
                              plan={packagePlan}
                              disabled={loading}
                              onConfirm={() => void sendMessage({ text: 'Rendben, mentsd el a csomagot.' })}
                              onModify={() => void sendMessage({ text: 'Módosítanék a csomagon.' })}
                            />
                          )}
                          {text !== '' && (
                            /* ... a meglévő ReactMarkdown blokk VÁLTOZATLANUL ... */
                          )}
                        </div>
```

- [ ] `pnpm typecheck && pnpm lint && pnpm build` — zöld.
- [ ] Kézi füst-teszt: `pnpm server` (flag nélkül) + `pnpm web` → a UI a MAI képet adja
  (nincs badge/chip). Majd `ORCHESTRATION_MODE=router pnpm server` újraindítás → kérdés a
  chatben → 🎯 routing-chip + 🌱 badge látszik; csomag-kérésnél („Állíts össze csomagot az
  ACME ügyfélnek”) a flow végén megjelenik a kártya, a „Rendben, mentsd” gomb beküldi a
  megerősítő üzenetet, és az agent menti a csomagot.

**Commit:** `feat: web UI agent-badge, routing-chip, tool-chipek es csomag-osszesito kartya`

---

## 12. feladat — Flow-test skill: forgatókönyvek, két runner, értékelő

**Files**
- Create: `.claude/skills/flow-test/SKILL.md`
- Create: `.claude/skills/flow-test/scenarios/01-happy-path.md`, `02-lemondas.md`,
  `03-visszalepes.md`, `04-kitores.md`, `05-adat-kerdes.md`
- Create: `.claude/skills/flow-test/scripts/persona.ts`
- Create: `.claude/skills/flow-test/scripts/run-scenario-http.ts`
- Create: `.claude/skills/flow-test/scripts/run-scenario-browser.ts`
- Create: `.claude/skills/flow-test/scripts/evaluate.ts`
- Modify: root `package.json` (devDependencies)

**Steps**

- [ ] Függőségek a root-ra (a skill-szkriptek a repo gyökeréből futnak, `tsx`-szel):
  `pnpm add -Dw ai@6.0.219 @ai-sdk/anthropic@3.0.93 playwright@^1.49` majd
  `pnpm exec playwright install chromium` — elvárt: lockfile frissül, chromium letöltődik.
- [ ] `SKILL.md`:

```markdown
---
name: flow-test
description: A Plantbase orchestrator/csomag-flow szimulált beszélgetés-tesztje (LLM-as-user). Használd, amikor a csomag-flow-t, a routingot vagy a flow-lockot kell végigtesztelni — öt forgatókönyv, két driver (HTTP: gyors iteráció; Playwright: valódi web UI + badge/chip asszertek), determinisztikus + LLM-értékeléssel, két ORCHESTRATION_MODE összehasonlításával.
---

# Flow-test — szimulált beszélgetés-teszt

## Előfeltételek
- DB fut (`docker compose up -d`), seedelve; `.env`-ben ANTHROPIC_API_KEY.
- A szerver a TESZTELT móddal fusson: `ORCHESTRATION_MODE=router pnpm server` (a web UI-hoz
  `pnpm web` is, ha a browser-drivert használod).

## Futtatás (egy forgatókönyv, HTTP driver — default)
​```bash
pnpm tsx .claude/skills/flow-test/scripts/run-scenario-http.ts \
  .claude/skills/flow-test/scenarios/01-happy-path.md --mode router
​```
A futás trace-e a `logs/flow-test/<ts>-01-happy-path-router.json` fájlba kerül, az elérési
utat a szkript kiírja.

## Browser driver (órai demó-mód, badge/chip asszertekkel)
​```bash
pnpm tsx .claude/skills/flow-test/scripts/run-scenario-browser.ts \
  .claude/skills/flow-test/scenarios/01-happy-path.md --mode router
​```

## Értékelés
​```bash
pnpm tsx .claude/skills/flow-test/scripts/evaluate.ts logs/flow-test/<fájl>.json
​```
Determinisztikus assertek (jó agent kapta a labdát; validatePackage a savePackage előtt;
nem zárult flow jelzés nélkül) + LLM-értékelés a puha szempontokra (visszaterelés,
kérdés-sorrend) + javítási javaslatok a promptokra/toolokra. Hibás assert → exit 1.

## Összehasonlító futás (a skill fő munkamenete)
1. Indítsd a szervert `ORCHESTRATION_MODE=router`-rel, futtasd le MIND az öt forgatókönyvet
   a HTTP driverrel, értékeld ki mindet.
2. Állítsd át `delegate`-re, indítsd újra a szervert, futtasd le újra mind az ötöt.
3. Az evaluate.ts-nek add be az összes logot egyszerre:
   `pnpm tsx .claude/skills/flow-test/scripts/evaluate.ts logs/flow-test/*.json`
   — módonként csoportosított összevető riportot ír (assert-eredmények, körszám, hibák),
   a végén javítási javaslatokkal.
```

- [ ] Forgatókönyvek — közös formátum: próza + EGY ```json blokk. `01-happy-path.md`:

```markdown
# 01 — Happy path: végigmegy és ment

Együttműködő lakberendező, az ACME ügyfélnek kér csomagot, elfogadja a javaslatokat,
és a végén megerősíti a mentést.

​```json
{
  "name": "01-happy-path",
  "persona": "Lakberendező vagy, az ACME nevű ügyfelednek kérsz növénycsomagot. Együttműködő vagy: az asszisztens előtöltött javaslatait elfogadod (keret, szint), közepes fényt és 3 darab növényt kérsz. Amikor az összesítő megjelenik és megkérdezik, rendben van-e, IGENNEL erősíted meg.",
  "goal": "Elmentett csomag az ACME ügyfélnek.",
  "opening": "Szia! Szeretnék növénycsomagot összeállítani az ACME ügyfelemnek.",
  "maxTurns": 10,
  "expectations": {
    "expectAgents": ["package"],
    "expectValidateBeforeSave": true,
    "expectSave": true,
    "expectCancel": false
  }
}
​```
```

  `02-lemondas.md` — persona: menet közben (a 3. köre táján) meggondolja magát és lemondja;
  expectations: `{ "expectAgents": ["package"], "expectSave": false, "expectCancel": true }`.
  `03-visszalepes.md` — persona: „5 nagy növényt kérek 10 ezer forint alatt” az XYZ ügyfélnek,
  ragaszkodik az irreális felteételekhez 1 körig, aztán enged; expectations:
  `{ "expectAgents": ["package"], "expectValidationError": true, "expectSave": false }`
  (a lényeg: legalább egy hibás validatePackage esemény, visszalépő ajánlattal).
  `04-kitores.md` — persona: a csomag-flow közepén rákérdez a filodendron öntözésére, majd
  visszatér a csomaghoz és lemondja; expectations:
  `{ "expectAgents": ["package"], "expectLockHold": true, "expectCancel": true }`.
  `05-adat-kerdes.md` — persona: csak adatot kérdez („milyen pet-safe növények vannak
  raktáron?”), csomagot NEM kér; expectations:
  `{ "expectAgents": ["info"], "expectSave": false, "expectCancel": false, "maxTurns": 3 }`.
  (Mind az öt fájl a fenti json-blokkos formát követi, magyar personával.)

- [ ] `persona.ts` (közös apró helperek — user-szimulátor + forgatókönyv-betöltő):

```ts
import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// persona.ts — a SZIMULÁLT FELHASZNÁLÓ. A Vercel AI SDK generateText-je játssza a usert a
// perszóna-prompt alapján; ha a célja teljesült (vagy feladta), [KÉSZ]-t mond, és a runner leáll.

export interface Scenario {
  name: string;
  persona: string;
  goal: string;
  opening: string;
  maxTurns: number;
  expectations: Record<string, unknown>;
}

export interface Turn {
  user: string;
  assistant: string;
  dataParts: { type: string; data: unknown }[];
}

export function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/```json\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error(`Nincs \`\`\`json blokk a forgatókönyvben: ${path}`);
  }
  return JSON.parse(match[1]) as Scenario;
}

export const DONE_MARKER = '[KÉSZ]';

export async function nextUserMessage(scenario: Scenario, turns: Turn[]): Promise<string> {
  if (turns.length === 0) {
    return scenario.opening;
  }
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('Hiányzó ANTHROPIC_API_KEY — a user-szimulátorhoz kötelező.');
  }
  const anthropic = createAnthropic({ apiKey });
  const transcript = turns
    .map((t) => `FELHASZNÁLÓ: ${t.user}\nASSZISZTENS: ${t.assistant}`)
    .join('\n\n');
  const { text } = await generateText({
    model: anthropic(process.env['FLOW_TEST_USER_MODEL'] ?? 'claude-haiku-4-5'),
    system:
      `Egy chat-asszisztens FELHASZNÁLÓJÁT játszod. Perszóna: ${scenario.persona}\n` +
      `A célod: ${scenario.goal}\n` +
      `Egyetlen rövid, természetes magyar chat-üzenetet írj (kérdés vagy válasz), semmi mást. ` +
      `Ha a célod teljesült, vagy végleg feladtad, válaszolj PONTOSAN ennyit: ${DONE_MARKER}`,
    prompt: `Az eddigi beszélgetés:\n\n${transcript}\n\nMi a következő üzeneted?`,
  });
  return text.trim();
}
```

- [ ] `run-scenario-http.ts` (fentről lefelé olvasható, driver-absztrakció NÉLKÜL):

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { DONE_MARKER, loadScenario, nextUserMessage, type Turn } from './persona.js';

// run-scenario-http.ts — HTTP driver: fetch a /api/chat-ra, a stream feldolgozása
// readUIMessageStream-mel. Gyors, fejlesztés közbeni iterációra. A szervernek a TESZTELT
// ORCHESTRATION_MODE-dal kell futnia; a --mode flag itt csak CÍMKE a loghoz.

const BASE = process.env['FLOW_TEST_API'] ?? 'http://localhost:3001';

/** SSE → UIMessageChunk stream. A szerver `data: {json}\n\n` eseményeket küld, a végén [DONE]. */
function sseToChunkStream(body: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('');
        if (data !== '' && data !== '[DONE]') {
          controller.enqueue(JSON.parse(data) as UIMessageChunk);
        }
      }
    },
  });
}

async function sendMessage(threadId: string | null, text: string): Promise<UIMessage> {
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      threadId,
      message: { id: `sim-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] },
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`A szerver hibával válaszolt: ${response.status} ${await response.text()}`);
  }
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: sseToChunkStream(response.body) })) {
    last = message;
  }
  if (!last) {
    throw new Error('Üres stream érkezett a szervertől.');
  }
  return last;
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function dataPartsOf(message: UIMessage): { type: string; data: unknown }[] {
  return message.parts
    .filter((p): p is { type: string; data: unknown } & typeof p => p.type.startsWith('data-'))
    .map((p) => ({ type: p.type, data: p.data }));
}

async function main(): Promise<void> {
  const [scenarioPath, ...rest] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error('Használat: run-scenario-http.ts <scenario.md> [--mode router|delegate]');
    process.exit(1);
  }
  const mode = rest[rest.indexOf('--mode') + 1] ?? 'ismeretlen';
  const scenario = loadScenario(scenarioPath);
  const turns: Turn[] = [];
  let threadId: string | null = null;

  for (let i = 0; i < scenario.maxTurns; i++) {
    const userText = await nextUserMessage(scenario, turns);
    if (userText.includes(DONE_MARKER)) {
      break;
    }
    console.log(`\n[${i + 1}] FELHASZNÁLÓ: ${userText}`);
    const reply = await sendMessage(threadId, userText);
    const dataParts = dataPartsOf(reply);
    const thread = dataParts.find((p) => p.type === 'data-thread');
    if (thread) {
      threadId = (thread.data as { threadId: string }).threadId;
    }
    const assistant = textOf(reply);
    console.log(`[${i + 1}] ASSZISZTENS: ${assistant.slice(0, 200)}`);
    turns.push({ user: userText, assistant, dataParts });
  }

  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('logs/flow-test', `${stamp}-${basename(scenarioPath, '.md')}-${mode}.json`);
  writeFileSync(file, JSON.stringify({ scenario: scenario.name, mode, expectations: scenario.expectations, turns }, null, 2));
  console.log(`\nTrace mentve: ${file}`);
}

main().catch((error) => {
  console.error(`flow-test hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] `run-scenario-browser.ts` (Playwright a VALÓDI web UI ellen; mellékesen a UI-render
  meglétét is asserteli):

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';
import { DONE_MARKER, loadScenario, nextUserMessage, type Turn } from './persona.js';

// run-scenario-browser.ts — Playwright driver a VALÓDI web UI ellen: gépel a chat-inputba,
// DOM-ból olvassa a választ. Órai demó-mód — a futás LÁTHATÓ (headless: false), és mellékesen
// asserteli, hogy a badge / routing-chip / (happy pathnál) a csomag-kártya tényleg megjelent.
// Elvárás: pnpm web fut (4200) és a szerver a tesztelt móddal (3001).

const WEB = process.env['FLOW_TEST_WEB'] ?? 'http://localhost:4200';

async function main(): Promise<void> {
  const [scenarioPath, ...rest] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error('Használat: run-scenario-browser.ts <scenario.md> [--mode router|delegate]');
    process.exit(1);
  }
  const mode = rest[rest.indexOf('--mode') + 1] ?? 'ismeretlen';
  const scenario = loadScenario(scenarioPath);
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(WEB);

  const turns: Turn[] = [];
  const uiChecks = { agentBadge: false, routingChip: false, packageSummary: false };

  for (let i = 0; i < scenario.maxTurns; i++) {
    const userText = await nextUserMessage(scenario, turns);
    if (userText.includes(DONE_MARKER)) {
      break;
    }
    console.log(`\n[${i + 1}] FELHASZNÁLÓ: ${userText}`);
    await page.getByPlaceholder('Írd be a kérdésed…').fill(userText);
    await page.keyboard.press('Enter');
    // Válasz-várás: a "gondolkodik…" jelző eltűnéséig (streaming vége).
    await page.getByText('gondolkodik…').waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    await page.getByText('gondolkodik…').waitFor({ state: 'hidden', timeout: 180000 });

    const assistant = (await page.locator('.prose').last().innerText().catch(() => '')) ?? '';
    console.log(`[${i + 1}] ASSZISZTENS: ${assistant.slice(0, 200)}`);
    // UI-render asszertek adatgyűjtése (data-testid-k a 11. feladatból).
    uiChecks.agentBadge ||= (await page.getByTestId('agent-badge').count()) > 0;
    uiChecks.routingChip ||= (await page.getByTestId('routing-chip').count()) > 0;
    uiChecks.packageSummary ||= (await page.getByTestId('package-summary').count()) > 0;
    turns.push({ user: userText, assistant, dataParts: [] });
  }
  await browser.close();

  if (!uiChecks.agentBadge || !uiChecks.routingChip) {
    console.error('UI-ASSERT HIBA: nem jelent meg agent-badge vagy routing-chip — orchestrált módban fut a szerver?');
    process.exitCode = 1;
  }
  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('logs/flow-test', `${stamp}-${basename(scenarioPath, '.md')}-${mode}-browser.json`);
  writeFileSync(file, JSON.stringify({ scenario: scenario.name, mode, expectations: scenario.expectations, turns, uiChecks }, null, 2));
  console.log(`\nTrace mentve: ${file}`);
}

main().catch((error) => {
  console.error(`flow-test (browser) hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] `evaluate.ts`:

```ts
import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// evaluate.ts — a flow-test trace értékelése. KÉT rétegben:
//   1. DETERMINISZTIKUS assertek a data-partokból (jó agent; validate a save előtt; a flow
//      nem zárult jelzés nélkül) — ezek buknak keményen (exit 1).
//   2. LLM-értékelés a puha szempontokra (visszaterelés minősége, kérdés-sorrend) + javítási
//      javaslatok a promptokra/toolokra.
// Több log-fájllal hívva módonként csoportosított ÖSSZEVETŐ riportot ad.

interface TraceFile {
  scenario: string;
  mode: string;
  expectations: Record<string, unknown>;
  turns: { user: string; assistant: string; dataParts: { type: string; data: unknown }[] }[];
}

interface ToolEvent { toolName?: string; targetAgent?: string; isError?: boolean }

function toolEvents(trace: TraceFile): ToolEvent[] {
  return trace.turns.flatMap((t) =>
    t.dataParts.filter((p) => p.type === 'data-tool').map((p) => p.data as ToolEvent),
  );
}

function agentsSeen(trace: TraceFile): string[] {
  return [...new Set(
    trace.turns.flatMap((t) =>
      t.dataParts.filter((p) => p.type === 'data-agent').map((p) => (p.data as { agent: string }).agent),
    ),
  )];
}

function assertTrace(trace: TraceFile): string[] {
  const failures: string[] = [];
  const events = toolEvents(trace);
  const e = trace.expectations;
  const names = events.filter((ev) => !ev.isError).map((ev) => ev.toolName);
  const seen = agentsSeen(trace);

  for (const agent of (e['expectAgents'] as string[] | undefined) ?? []) {
    if (!seen.includes(agent)) failures.push(`nem kapta meg a labdát a(z) ${agent} agent (látott: ${seen.join(', ') || 'senki'})`);
  }
  if (e['expectSave'] === true && !names.includes('savePackage')) failures.push('nem történt sikeres savePackage');
  if (e['expectSave'] === false && names.includes('savePackage')) failures.push('savePackage történt, pedig nem kellett volna');
  if (e['expectCancel'] === true && !names.includes('cancelPackage')) failures.push('nem történt cancelPackage');
  if (e['expectValidateBeforeSave'] === true) {
    const vi = names.indexOf('validatePackage');
    const si = names.indexOf('savePackage');
    if (si !== -1 && (vi === -1 || vi > si)) failures.push('a savePackage előtt nem futott sikeres validatePackage');
  }
  if (e['expectValidationError'] === true && !events.some((ev) => ev.toolName === 'validatePackage' && ev.isError)) {
    failures.push('nem volt hibás validatePackage (visszalépést vártunk)');
  }
  if (e['expectLockHold'] === true) {
    // A lock tartása: miután a routeTo package-re nyitott, minden KÉSŐBBI routeTo is package.
    let opened = false;
    for (const ev of events) {
      if (ev.toolName !== 'routeTo') continue;
      if (ev.targetAgent === 'package') opened = true;
      else if (opened && ev.targetAgent === 'info') failures.push('a flow-lock kiengedett: nyitott flow közben info-agenthez routolt');
    }
  }
  // Univerzális szabály: ha a flow megnyílt, csak jelzéssel zárulhatott (vagy nyitva maradt).
  const openedFlow = events.some((ev) => ev.toolName === 'routeTo' && ev.targetAgent === 'package');
  const closedFlow = names.includes('savePackage') || names.includes('cancelPackage');
  if (openedFlow && !closedFlow && trace.expectations['expectSave'] === true) {
    failures.push('a flow nyitva maradt, pedig mentést vártunk');
  }
  return failures;
}

async function softReview(trace: TraceFile): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return '(LLM-értékelés kihagyva: nincs ANTHROPIC_API_KEY)';
  const anthropic = createAnthropic({ apiKey });
  const transcript = trace.turns.map((t) => `U: ${t.user}\nA: ${t.assistant}`).join('\n\n');
  const { text } = await generateText({
    model: anthropic(process.env['FLOW_TEST_USER_MODEL'] ?? 'claude-haiku-4-5'),
    system:
      'Egy csomag-összeállító chat-agent beszélgetését értékeled magyarul, tömören. Szempontok: ' +
      '(1) egyszerre egy kérdés, jó sorrendben? (2) előtöltött javaslatok az ügyfél-profilból? ' +
      '(3) témától eltérésnél kedves, határozott visszaterelés? (4) mentés előtt megerősítés? ' +
      'Végül adj 1-3 KONKRÉT javítási javaslatot a promptra vagy a toolokra.',
    prompt: transcript,
  });
  return text;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Használat: evaluate.ts <logs/flow-test/*.json>');
    process.exit(1);
  }
  let failed = false;
  const byMode = new Map<string, { name: string; failures: string[]; turnCount: number }[]>();
  for (const file of files) {
    const trace = JSON.parse(readFileSync(file, 'utf8')) as TraceFile;
    const failures = assertTrace(trace);
    failed ||= failures.length > 0;
    const rows = byMode.get(trace.mode) ?? [];
    rows.push({ name: trace.scenario, failures, turnCount: trace.turns.length });
    byMode.set(trace.mode, rows);
    console.log(`\n=== ${trace.scenario} [${trace.mode}] — ${failures.length === 0 ? 'OK' : 'HIBA'} ===`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log(await softReview(trace));
  }
  if (byMode.size > 1) {
    console.log('\n=== ÖSSZEVETÉS módonként ===');
    for (const [mode, rows] of byMode) {
      const ok = rows.filter((r) => r.failures.length === 0).length;
      console.log(`${mode}: ${ok}/${rows.length} forgatókönyv zöld · átlag körszám: ${(rows.reduce((s, r) => s + r.turnCount, 0) / rows.length).toFixed(1)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`evaluate hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] Füst-teszt: szerver `ORCHESTRATION_MODE=router`-rel fut, majd
  `pnpm tsx .claude/skills/flow-test/scripts/run-scenario-http.ts .claude/skills/flow-test/scenarios/05-adat-kerdes.md --mode router`
  — elvárt: a konzolon a szimulált párbeszéd, log-fájl a `logs/flow-test/`-ben; utána
  `pnpm tsx .claude/skills/flow-test/scripts/evaluate.ts logs/flow-test/<fájl>.json` — exit 0.

**Commit:** `feat: flow-test skill — LLM-as-user forgatokonyvek, http+browser runner, ertekelo`

---

## 13. feladat — Docs + végső verifikáció (teljes kapu + 3-módú füst + összehasonlító futás)

**Files**
- Modify: `docs/architektura.md` (új szakasz: a két orchestration-mód, szöveges ábrával)
- Modify: `CLAUDE.md` (agents-szekció: orchestrator-agent, package-agent, ORCHESTRATION_MODE)

**Steps**

- [ ] `docs/architektura.md` végére új szakasz: „Orchestrator — két handover-mód” — a
  spec 3. pontjának összefoglalója + szöveges ábra:

```
ORCHESTRATION_MODE=router                      ORCHESTRATION_MODE=delegate

user ──▶ orchestrator (routeTo)                user ──▶ orchestrator (routeTo)
           │ flow-lock: data-tool partokból               │ (routing + flow-lock, semmi más)
           ▼                                              ▼
   ┌── package-agent ──┐                           package-agent ─────────────┐
   │ requestInfo(q)    │  ◀─ üres execute            │ askInfoAgent(q)        │
   ▼                   │                             │   └─▶ info-agent loop  │ ◀─ beágyazott
orchestrator közvetít  │                             │       (runSql, RAG)    │
   └─▶ info-agent ─────┘  max 3 ugrás, látható       └────────────────────────┘
       (runSql, RAG)      for-ciklus               az adat nem hagyja el a kört
```

  Kulcsmondat mindkét mód alá: *ugyanaz a tool-felület (kérdés be, adat vissza), csak az
  execute más.* `off`: a mai egy-agentes út, változatlanul.
- [ ] `CLAUDE.md` agents-szekció: vedd fel az `orchestrator-agent` és `package-agent` sorokat,
  az új toolokat (routeTo, requestInfo, askInfoAgent, validatePackage, savePackage,
  cancelPackage), és az `ORCHESTRATION_MODE=off|router|delegate` kapcsolót (default: off).
- [ ] **Demó-ops ellenőrzés (spec §9 — NEM implementálandó, csak verifikálandó):** a
  `pnpm demo` (scripts/demo.sh) már létezik és mindent lefed (port-kill 3001/4200, nx reset +
  dist + .vite törlés, prisma generate, docker compose up, migrate deploy + seed, friss build,
  server+web együtt). Az új migráció a `migrate deploy` révén automatikusan lefut — **nincs
  szükség módosításra**. Ellenőrzés: `bash scripts/demo.sh` lefut hibátlanul, a web a friss
  kódot mutatja.
- [ ] **Teljes kapu:** `pnpm lint && pnpm typecheck && pnpm nx test core && pnpm build` —
  minden zöld.
- [ ] **3-módú füst-teszt** (mindhárom módban indított szerverrel, web UI-ból vagy curl-lel):
  1. Flag nélkül (`pnpm demo` vagy `pnpm server`+`pnpm web`): a mai viselkedés — sima
     query-agent, tool-kártyák, SEMMI badge/chip. Egy adat-kérdés és egy gondozási kérdés fut le.
  2. `ORCHESTRATION_MODE=router pnpm server`: adat-kérdés → 🎯 chip + 🌱 badge; csomag-flow
     ACME-vel végig → requestInfo-ugrások látszanak, kártya, „Rendben, mentsd” → mentés,
     `psql`-ben: `SELECT * FROM packages;` mutatja az új sort.
  3. `ORCHESTRATION_MODE=delegate pnpm server`: ugyanaz a csomag-flow → a beágyazott
     info-agent chipek BEHÚZVA jelennek meg; mentés működik.
  4. Flow-lock próba (bármelyik orchestrált mód): flow közben „egyébként mennyibe kerül a
     kávé?” → visszaterelés, a routing-chip `flow-lock` indokot mutat.
- [ ] **Összehasonlító futás** a flow-test skill-lel: mind az 5 forgatókönyv router ÉS delegate
  módban, majd `evaluate.ts logs/flow-test/*.json` — elvárt: minden determinisztikus assert
  zöld mindkét módban, az összevető riport kiíródik.

**Commit:** `docs: orchestrator ket handover-mod az architektura-dokumentacioban es CLAUDE.md-ben`

---

## Önellenőrzés (self-review)

**Spec-lefedettségi térkép (spec § → feladat):**

| Spec § | Tartalom | Feladat |
|---|---|---|
| §2 Szereplők | orchestrator / info-agent / csomag-agent, konvenciók | 8., 9. (info-agent = meglévő query-agent; a `searchKnowledge` MÁR be van kötve a `buildQueryToolset`-ben — „bekötendő, ha hiányzik” teljesül, teendő nincs) |
| §3 kapcsoló + flow-lock + „jelzés = tool-hívás” | `ORCHESTRATION_MODE` (a task-deviáció szerint HÁROM értékkel: off/router/delegate, off = default, bájtra pontos mai viselkedés), `findLastFlowSignal` | 2., 9., 10. |
| §3.1 router mód | requestInfo (üres execute) + router-handover látható for-ciklus, MAX 3 ugrás | 4., 9. |
| §3.2 delegate mód | askInfoAgent (beágyazott loop, delegateToIngest minta) + delegate-handover | 7., 9. |
| §4.1 irányított kérdések + előtöltött javaslatok | package-prompt `<flow>` blokk | 8. |
| §4.2 tool-kapuk (validate determinisztikus Prisma; save újra-validál; budget kemény korlát) | 5., 6. |
| §4.3 összesítő + megerősítés (data-package part, kártya, gombok, mentés csak megerősítés után) | 5. (onPlan), 10. (data-package), 11. (kártya + gombok), 8. (prompt `<gates>`) |
| §4.4 kilépés két úton, tool-hívással; findLastFlowSignal a data-tool partokból | 4. (cancel), 6. (save), 2. (flow-signal) |
| §5 DB: packages + package_items, FK a customers-re, Prisma-út | 1. (a customers réteg a baseline-ból készen jön — nem hozunk létre újat) |
| §6.1 szerver: orchestrator belépési pont, stateless, data-agent/data-tool partok, routeTo is kimegy, chat-stream.ts egy fájl, stripDataParts | 10. (a stream-protokoll már UI message stream — a spec „váltás” pontja a baseline-ban megtörtént; itt a data-partok jönnek hozzá) |
| §6.2 web: DefaultChatTransport (már megvan), badge, routing-chip, kártya + 2 gomb (sendMessage), chipek időrendben, delegate-nél behúzva, trace a logs/-ba | 11. |
| §7 flow-test skill: 5 forgatókönyv, két driver közös maggal (persona/evaluate), determinisztikus + LLM-értékelés, összehasonlító futás | 12. |
| §8 fájlok/konvenciók/vitest/migráció/docs | 1–12. (vitest: 2., 3., 4., 5., 6., 7., 8. feladat specjei), 13. (docs) |
| §9 demó-ops | 13. (csak verifikáció: a `pnpm demo` létezik, módosítás nem kell) |
| §10 YAGNI | betartva: nincs auth, nincs session-store, nincs UI-regressziós suite, nincs CLI-bekötés az új agentekhez |

**Feloldott spec-kétértelműségek (a döntésekkel):**
1. **Mód-kapcsoló**: a spec két értéket ír; a feladat-kiírás deviációja szerint HÁROM érték
   (`off` default) — a terv ezt követi, `off`-nál a szerver a változatlan `askAgent`-utat futtatja.
2. **`cancelPackage` „rögzít”**: nincs lemondás-tábla a specben (§5 csak packages/package_items)
   → a rögzítés = a tool-hívás maga (Trace + data-tool part, amiből a flow-lock olvas), DB-írás
   nélkül.
3. **Router mód: az info-válasz visszajuttatása** a csomag-agenthez: a jelzés tool-hívás
   (requestInfo), a válasz kézbesítése a loop természetes bemenetén, címkézett üzenetként
   (`[Az adat-szolgáltató válasza…]`) történik — nem a modell szövegének parse-olása.
4. **`data-package` előállítása**: nem a tool szöveg-kimenetének szerver-oldali parse-olásával,
   hanem típusos `onPlan` callbackkel (a validate-tool hívja sikerkor) — nulla parse.
5. **`validatePackage` „méret/fény” feltételei**: a customers táblában nincs ilyen mező → a
   beszélgetésben tisztázott feltételek opcionális tool-inputok (`light`, `maxHeightCm`),
   determinisztikusan ellenőrizve.
6. **Orchestrált módban a stream**: nem az agent-futások `toUIMessageStream`-jeinek merge-ölése
   (több agent-futás = több üzenet-keret), hanem kézzel komponált EGY üzenet
   (start / text-chunkok / data-partok / finish) — így a hop-ok egy asszisztens-üzenetben,
   időrendben látszanak.
7. **Runner `--mode` flagje**: a mód a szerver env-je; a flag a log-fájl címkéje — a SKILL.md
   írja elő a szerver megfelelő indítását az összehasonlító futáshoz.
8. **Branch**: a spec `feat/orchestrator-demo`-t ír; a munka a már kicheckoutolt
   `demo/03-orchestrator` branchen folyik (a session adottsága) — push nincs.

**Nincs placeholder:** minden kód-lépés teljes, futtatható kódot ad (nincs TBD, nincs „mint az
N. feladatban”); a tesztek konkrét assertekkel; a parancsok elvárt kimenettel.

**Típus-konzisztencia feladatok között:** `ToolEventData`/`PackagePlan` a 2. feladatban
definiálva (core), a 9. (OrchestratorEvent), 10. (data-partok) és 11. (web-tükör, stream a
szerződés) ugyanazt az alakot használja; `ToolReporter` (meglévő) a 3. feladat
`onToolEvent`-jén, a 7. feladat `deps.onToolEvent`-jén és a 8. feladat
`onNestedToolEvent`-jén ugyanaz a típus; a `PackageItemsSchema`-t az 5. és 6. feladat toolja
közösen használja; a `FlowHistoryMessage` szerkezeti típus, amibe a szerver `UIMessage[]`-e
beleillik (a 10. feladat `uiHistory` paramétere).
