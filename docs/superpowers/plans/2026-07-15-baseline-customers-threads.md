# Baseline (javítási kör + customers + threads + web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A main rendbetétele (J0–J10 javítási kör), majd az alapréteg: `customers` tábla 20 életszerű sorral + `queryCustomers` tool, thread/üzenet-perzisztencia DB-ben, thread-lista és URL-ből betölthető beszélgetés a webben.

**Architecture:** Nx monorepo (apps/cli, apps/server, apps/web, packages/core, packages/db). A core framework-agnosztikus; az új nem-SQL toolok Prismát használnak (`@plantbase/db` generált kliens), csak a `runSql` marad a nyers pg read-only úton. A szerver mostantól a DB-ből építi az előzményt (a kliens csak az új üzenetet küldi), a stream az AI SDK UI message stream (már így fut a mainen).

**Tech Stack:** TypeScript, Vercel AI SDK 6 (`ai@6.0.219`), Prisma (kliens: `packages/db/generated/client`), Express 5, React 19 + Vite, Vitest, pnpm + Nx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-baseline-customers-threads-proposal.md` (sorrend KÖTÖTT: javítások → alapfunkciók; agent-funkciók külön terv).
- Minden felhasználó-felé eső szöveg, komment és hibaüzenet MAGYAR; a fájlnevek hordozzák a típust (`*-tool.ts`, `*-agent.ts`, `*-prompt.ts`).
- Tool-konvenció: `execute*` SOHA nem dob — `ToolOutcome`-ot ad (`content`, `isError`, `summary`, `rowCount`); permissive AI SDK séma + szigorú belső Zod.
- Minden új fájl ~150 sor alatt, magyar „miért"-kommentekkel.
- Futtatás dev-ben forrásból (`tsx --conditions=@plantbase/source`), tesztek: `pnpm nx test <projekt>`; commit formátum: `<type>: <leírás>` (feat/fix/refactor/docs/test/chore), NINCS Co-Authored-By láb.
- NE pusholj. Minden task végén lokális commit a `worktree-baseline-proposal` branchen (vagy az abból nyitott `feat/baseline-threads-customers` branchen).
- DB: Postgres a docker-compose-ból (host port **5433**); `pnpm db:migrate -- --name <név>`, `pnpm db:seed` idempotens.

---

### Task 1: J0 — admin-holtág feloldása (a role vezérli a toolsetet ÉS a promptot)

**Files:**
- Modify: `packages/core/src/lib/agents/query-agent/query-agent.ts`
- Test: `packages/core/src/lib/agents/query-agent/query-agent.spec.ts` (új)

**Interfaces:**
- Consumes: `isAdmin`, `CURRENT_ROLE`, `UserRole` (`../../user-role/user-role.js`); a meglévő tool-factory-k.
- Produces: `buildQueryToolset(role: UserRole, report?: ToolReporter, options?: { print?: boolean }): ToolSet` — exportált, tiszta függvény; `askAgent` változatlan szignatúrával.

- [ ] **Step 1: Write the failing test**

`packages/core/src/lib/agents/query-agent/query-agent.spec.ts`:

```typescript
import { buildQueryToolset } from './query-agent.js';

describe('buildQueryToolset', () => {
  it('vásárló nem kapja meg a delegateToIngest toolt', () => {
    const tools = buildQueryToolset('customer');
    expect(Object.keys(tools)).toEqual([
      'runSql',
      'searchKnowledge',
      'getClientPreferences',
    ]);
  });

  it('admin megkapja a delegateToIngest toolt is', () => {
    const tools = buildQueryToolset('admin');
    expect(Object.keys(tools)).toContain('delegateToIngest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test @plantbase/core -- run src/lib/agents/query-agent/query-agent.spec.ts`
Expected: FAIL — `buildQueryToolset` is not exported.

- [ ] **Step 3: Write minimal implementation**

`query-agent.ts`-ben a `const admin = false;` sor és a beágyazott `buildTools` kiváltása.
A 41–42. sor (`const role …; const admin = false;`) helyett:

```typescript
  const role = options.role ?? CURRENT_ROLE;
```

Az `askAgent`-en KÍVÜL, exportált függvényként (a fájl kommentje alá):

```typescript
/** A query-agent toolkészlete SZEREP szerint. A prompt (buildQueryPrompt) és ez a függvény
 *  ugyanabból a role-értékből dolgozik — a kettő nem csúszhat el: amit a prompt leír, az a
 *  toolkészletben tényleg ott van, és fordítva. */
export function buildQueryToolset(
  role: UserRole,
  report?: ToolReporter,
  options: { print?: boolean } = {},
): ToolSet {
  return {
    runSql: runSqlTool(report),
    // A tudás-oldal: szöveges gondozási cikkek (RAG). A párja a runSql — a modell választ.
    searchKnowledge: searchKnowledgeTool(report),
    getClientPreferences: getClientPreferencesTool(report),
    // Admin szerep → a MÁSIK agent tool-ként. Vásárlónál ez a kulcs nincs az objektumban.
    ...(isAdmin(role)
      ? { delegateToIngest: delegateToIngestTool(report, { print: options.print }) }
      : {}),
  };
}
```

Az `askAgent` belsejében:

```typescript
      buildTools: (report): ToolSet =>
        buildQueryToolset(role, report, { print: options.print }),
      // Admin esetén a delegálás + a végső összegzés miatt kicsivel több kör kellhet.
      maxSteps: isAdmin(role) ? 8 : 6,
```

Importok bővítése: `isAdmin` a user-role-ból, `type ToolReporter` a `../../tools/tool-outcome.js`-ből.
A fájl fejkommentjéből törölni a „Web deploy: ideiglenesen kikapcsolva" sort — a komment megint igazat mond.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test @plantbase/core -- run src/lib/agents/query-agent/query-agent.spec.ts`
Expected: PASS (2 teszt). Majd teljes kör: `pnpm nx test @plantbase/core` — minden zöld.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add packages/core/src/lib/agents/query-agent/
git commit -m "fix: admin szerep újra bekapcsolja a delegateToIngest toolt (prompt és toolset egy forrásból)"
```

---

### Task 2: J4 — halott `echo` kód törlése

**Files:**
- Delete: `packages/core/src/lib/echo.ts`, `packages/core/src/lib/echo.spec.ts`
- Modify: `packages/core/src/index.ts` (utolsó sor: `export * from './lib/echo.js';` törlése)

**Interfaces:** nincs — senki nem hívja (ellenőrizve: csak a saját spec + index export hivatkozik rá).

- [ ] **Step 1: Töröld a fájlokat és az exportot**

```bash
git rm packages/core/src/lib/echo.ts packages/core/src/lib/echo.spec.ts
```

Az `index.ts`-ből töröld: `export * from './lib/echo.js';`

- [ ] **Step 2: Ellenőrzés — semmi nem tört el**

Run: `pnpm nx test @plantbase/core && pnpm typecheck && pnpm build`
Expected: minden zöld (az echo-ra semmi nem hivatkozott).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: halott echo modul törlése (a B2 óta nem hívja senki)"
```

---

### Task 3: elavult kommentek és szövegek (J1 + J2 + J5)

**Files:**
- Modify: `apps/server/src/main.ts:24-31`, `packages/core/src/lib/rag/chunk.ts:55`, `apps/cli/src/ingest-knowledge.ts:113`

**Interfaces:** nincs kódváltozás, csak komment/string.

- [ ] **Step 1: `main.ts` fejléckomment a tool-stream valóságra**

A 24–31. sori KLIENS/STREAMING blokk cseréje erre:

```typescript
// KLIENS: a web app a Vercel AI SDK useChat hookját használja (DefaultChatTransport), NEM sima
// fetch-et. A useChat minden hívásnál a TELJES üzenet-előzményt (UIMessage[]) elküldi — ebből
// vágjuk le az utolsó (új) user-üzenetet kérdésnek, a többit convertToModelMessages-szel alakítjuk
// az askAgent `history` opciójává, így a beszélgetés a szerveren is folytatódik körről körre.
//
// STREAMING: a válasz az AI SDK ÜZENET-streamjeként megy ki (pipeUIMessageStreamToResponse):
// nemcsak a szöveg-deltákat, hanem a TOOL-HÍVÁSOKAT és -EREDMÉNYEKET is típusos részekként
// (`tool-runSql`, `tool-searchKnowledge`) — ebből rajzol a kliens kártyát (apps/web/App.tsx).
```

(Megjegyzés: a Task 13 ezt a handlert átírja — a komment akkor tovább frissül; itt csak a hazugságot szüntetjük meg.)

- [ ] **Step 2: `chunk.ts:55` hivatkozás-javítás**

`(lásd knowledge-document.ts)` → `(a hívó: apps/cli/src/ingest-knowledge.ts)`.

- [ ] **Step 3: `ingest-knowledge.ts:113` port-javítás**

`http://localhost:3000/debug/knowledge/sources` → `http://localhost:3001/debug/knowledge/sources`.

- [ ] **Step 4: Ellenőrzés + commit**

Run: `pnpm typecheck` — zöld.

```bash
git add apps/server/src/main.ts packages/core/src/lib/rag/chunk.ts apps/cli/src/ingest-knowledge.ts
git commit -m "docs: elavult kommentek javítása (stream-protokoll, chunk-hivatkozás, debug-port)"
```

---

### Task 4: J3 — közös ANSI szín-helper

**Files:**
- Create: `packages/core/src/lib/ansi.ts`
- Modify: `packages/core/src/lib/trace.ts` (a modul-lokális `c` és `wrap` kiemelése), `packages/core/src/lib/rag/retrieve.ts` (nyers escape-ek cseréje)
- Test: meglévő `trace.spec.ts` marad a zöld-kapu.

**Interfaces:**
- Produces: `export const c = { bold, dim, white, magenta, cyan, green, yellow, … }` — pontosan a `trace.ts`-ben ma élő `wrap(kód)` alapú helper, változatlan API-val áthelyezve.

- [ ] **Step 1: Emeld ki a helpert**

Hozd létre az `ansi.ts`-t: másold át a `trace.ts` tetejéről a `wrap` függvényt és a `c` objektumot (trace.ts ~16. sor), elé ez a komment:

```typescript
// ansi.ts — terminál-színek EGY helyen. A trace (agent-nyom) és a RAG-log ugyanazt a
// helpert használja, hogy a "control room" kimenet egységes legyen, és a nyers \x1b
// escape-ek ne szennyezzék az üzleti kódot.
```

A `trace.ts`-ben a lokális definíció helyett: `import { c } from './ansi.js';`
Az `index.ts`-be NEM kell export (belső helper).

- [ ] **Step 2: `retrieve.ts` átállítása**

Import: `import { c } from '../ansi.js';` — a `logHits`-ben és a `retrieveKnowledge` elején minden nyers escape cseréje, pl.:

```typescript
function logHits(label: string, hits: KnowledgeHit[]): void {
  traceLog(c.cyan(label));
  for (const hit of hits) {
    const distance = hit.distance.toFixed(3);
    const score =
      'score' in hit && (hit as RerankedHit).score >= 0
        ? ' ' + c.yellow(`rerank:${(hit as RerankedHit).score}/10`)
        : '';
    traceLog(
      `   ${c.dim(bar(hit.distance))} dist=${c.green(distance)}${score} ` +
        c.bold(hit.title) + ' ' + c.dim(`#${hit.chunkIndex} · ${hit.content.length} kar`),
    );
  }
}
```

és a belépő sor: `traceLog(c.magenta('━━ RAG ━━') + ' kérdés: ' + c.bold(question));`
(Ha a `c`-ből hiányzik szín, amit a retrieve használt — pl. `green`, `yellow` — vedd fel az `ansi.ts`-be `wrap(32)`, `wrap(33)` kóddal.)

- [ ] **Step 3: Ellenőrzés + commit**

Run: `pnpm nx test @plantbase/core && pnpm typecheck`
Expected: zöld; kézi szemre-teszt: `pnpm cli ask --quiet "mutass 2 pet-safe növényt"` közben a trace változatlanul színes.

```bash
git add packages/core/src/lib/ansi.ts packages/core/src/lib/trace.ts packages/core/src/lib/rag/retrieve.ts
git commit -m "refactor: közös ANSI szín-helper (trace + RAG-log egy stílus)"
```

---

### Task 5: J6 — App.tsx render-blokk kiemelése

**Files:**
- Create: `apps/web/src/lib/message-parts.ts`
- Modify: `apps/web/src/App.tsx:72-114`

**Interfaces:**
- Produces: `splitAssistantParts(m: UIMessage): { text: string; toolParts: ToolUIPart[] }` és `type ToolUIPart = { type: string; state: string; input?: unknown; output?: unknown }`.

- [ ] **Step 1: Írd meg a segédet**

`apps/web/src/lib/message-parts.ts`:

```typescript
import type { UIMessage } from 'ai';

// message-parts.ts — az üzenet részeinek szétválogatása EGY helyen, hogy az App.tsx
// render-blokkja olvasható maradjon: mit mond (text) és mit csinált (tool-részek).

/** A szerver `tool-<név>` típusú részei — a kártyához ennyi kell belőlük. */
export interface ToolUIPart {
  type: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

export function splitAssistantParts(m: UIMessage): {
  text: string;
  toolParts: ToolUIPart[];
} {
  const text = m.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const toolParts = m.parts.filter(
    (part): part is typeof part & ToolUIPart => part.type.startsWith('tool-'),
  ) as unknown as ToolUIPart[];
  return { text, toolParts };
}
```

- [ ] **Step 2: App.tsx átállítása**

A `messages.map` callback eleje (72–84. sor) helyett:

```tsx
{messages.map((m) => {
  const { text, toolParts } = splitAssistantParts(m);
```

a `console.log` sor törlésével, és a ToolCard-hívásban a castok helyett:

```tsx
{toolParts.map((part, index) => (
  <ToolCard
    key={`${m.id}-tool-${index}`}
    toolName={part.type.replace('tool-', '')}
    state={part.state}
    input={part.input}
    output={part.output}
  />
))}
```

Import fent: `import { splitAssistantParts } from '@/lib/message-parts';`

- [ ] **Step 3: Ellenőrzés + commit**

Run: `pnpm typecheck && pnpm nx build web`
Expected: zöld. Kézi: `pnpm server` + `pnpm web`, egy kérdésre a tool-kártyák változatlanul kirajzolódnak.

```bash
git add apps/web/src/lib/message-parts.ts apps/web/src/App.tsx
git commit -m "refactor: App.tsx render-blokk kiemelése (splitAssistantParts, castok nélkül)"
```

---

### Task 6: J7 — gyökér-takarítás + .gitignore-javítás

**Files:**
- Modify: `.gitignore` (utolsó sor)
- Delete (trackingből): `.playwright-mcp/`, `embed-demo.json`, `postman/`, `railpack.api.json`, `railpack.web.json`

- [ ] **Step 1: .gitignore utolsó sorának kettébontása**

A `vitest.config.*.timestamp*.playwright-mcp/` sor helyett KÉT sor:

```
vitest.config.*.timestamp*
.playwright-mcp/
```

- [ ] **Step 2: Trackelt szemét eltávolítása (a lemezen maradhat)**

```bash
git rm -r --cached .playwright-mcp embed-demo.json postman railpack.api.json railpack.web.json
```

- [ ] **Step 3: Ellenőrzés + commit**

Run: `git status --short` — a törölt fájlok `D`-vel, a `.playwright-mcp/` NEM jelenik meg untrackedként.

```bash
git add .gitignore
git commit -m "chore: gyökér-takarítás (playwright-dumpok, postman, railpack, embed-demo) + gitignore-javítás"
```

---

### Task 7: J8 + J9 — doksi-szinkron

**Files:**
- Modify: `README.md`, `docs/architektura.md`, `docs/stack.md`, `seed/README.md`

- [ ] **Step 1: Agent-technológia javítása (J8)**

Mindhárom fő doksiban keresd a „Anthropic SDK fölé épülő, kézzel írt tool-use loop" jellegű állításokat (README.md ~20-21., 29., 51. sor; docs/architektura.md ~24. sor; docs/stack.md Agent-sor), és cseréld erre a tartalomra (a helyi mondatszerkezethez igazítva):

> Az agent a **Vercel AI SDK 6**-ra épül (`generateText` + `stopWhen: stepCountIs(n)`): a
> prompt → tool-hívás → tool-eredmény → ismétlés ciklust az SDK futtatja, de a lépésenkénti
> átláthatóságot a saját trace-rétegünk adja (`prepareStep`/`onStepFinish` → trace.ts). A loop
> eredetileg kézzel íródott a nyers Anthropic SDK fölé — a tananyag ezt a fejlődést követi.

- [ ] **Step 2: RAG + server/web átvezetése (J8)**

`docs/architektura.md` ~15. sor: a „Később (NEM most): apps/api (4. óra), apps/web (5. óra)" mondat TÖRLENDŐ; helyette a struktúra-listába: `apps/server` (Express, /api/chat + /debug/knowledge) és `apps/web` (Vite + React chat, tool-kártyák). A README projektstruktúra-blokkjába (61–73. sor) ugyanez + a `knowledge_chunks` tábla és a `seed/knowledge/` említése.

- [ ] **Step 3: README scripts-tábla pótlása (J8)**

A „hasznos scriptek" táblába (129–141. sor) új sorok:

```markdown
| `pnpm server` | Express API dev-módban (port 3001) |
| `pnpm web` | Vite dev-szerver a chat UI-hoz (port 4200) |
| `pnpm knowledge:ingest` | tudásbázis-cikkek darabolása + vektorizálása a knowledge_chunks táblába |
```

(Ellenőrizd a `package.json`-ban a pontos script-neveket, és azokat írd.)

- [ ] **Step 4: seed/README starter-kit jelölés (J9)**

A `seed/README.md` tetejére:

```markdown
> **FIGYELEM:** ez a mappa a kurzus induló csomagja (starter kit) — TÖRTÉNETI másolat.
> Az ÉLŐ forrás a `packages/db/prisma/` (plants.ts + seed.ts); azt szerkeszd, ezt ne.
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architektura.md docs/stack.md seed/README.md
git commit -m "docs: doksi-szinkron — Vercel AI SDK a valóság, RAG+server/web átvezetve, seed starter-kit jelölés"
```

---

### Task 8: `@plantbase/db` fogyaszthatóvá tétele + közös Prisma-kliens a core-ban

**Files:**
- Modify: `packages/db/package.json`, `packages/core/package.json`, `apps/server/package.json`
- Create: `packages/core/src/lib/tools/prisma-client.ts`

**Interfaces:**
- Produces: `import { PrismaClient } from '@plantbase/db'` működik core-ból és serverből; `getPrisma(): PrismaClient` lazy singleton a core tool-rétegének.

- [ ] **Step 1: Exports a db csomagra**

`packages/db/package.json` bővítése:

```json
{
  "name": "@plantbase/db",
  "version": "0.0.1",
  "private": true,
  "main": "./generated/client/index.js",
  "types": "./generated/client/index.d.ts",
  "exports": {
    ".": {
      "types": "./generated/client/index.d.ts",
      "default": "./generated/client/index.js"
    },
    "./package.json": "./package.json"
  },
  "nx": { "name": "db" }
}
```

Függőség felvétele: `packages/core/package.json` és `apps/server/package.json` dependencies-be
`"@plantbase/db": "workspace:*"`, majd `pnpm install`.

- [ ] **Step 2: Lazy Prisma-singleton a core-ban**

`packages/core/src/lib/tools/prisma-client.ts`:

```typescript
import { PrismaClient } from '@plantbase/db';

// prisma-client.ts — EGY közös Prisma-kliens a tool-rétegnek (queryCustomers és a későbbi
// csomag-toolok). A runSql tudatosan NEM ezt használja: az a nyers, READ-ONLY pg-úton fut
// (három védelmi réteg) — a Prisma a "rendes" adatelérés, ahol nem az SQL a tananyag.
// Lazy: csak az első használatkor jön létre, és hiányzó DATABASE_URL-nél magyarul hal meg.

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (client === null) {
    if (!process.env['DATABASE_URL']) {
      throw new Error('Hiányzó DATABASE_URL — a Prisma-alapú toolokhoz kötelező.');
    }
    client = new PrismaClient();
  }
  return client;
}

/** Tiszta leálláshoz (CLI/szerver shutdown). Ha nem jött létre kliens, nem csinál semmit. */
export async function closePrisma(): Promise<void> {
  if (client !== null) {
    await client.$disconnect();
    client = null;
  }
}
```

Export az `index.ts`-be a tool-blokk tetején: `export * from './lib/tools/prisma-client.js';`

- [ ] **Step 3: Ellenőrzés + commit**

Run: `pnpm install && pnpm typecheck && pnpm build`
Expected: zöld (a generált kliens létezik — ha nem: `pnpm prisma generate`).

```bash
git add packages/db/package.json packages/core/package.json apps/server/package.json pnpm-lock.yaml packages/core/src/lib/tools/prisma-client.ts packages/core/src/index.ts
git commit -m "feat: @plantbase/db exports + közös lazy Prisma-kliens a core tool-rétegben"
```

---

### Task 9: `customers` tábla + 20 soros seed

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts`
- Create: `packages/db/prisma/customers.ts`, migráció (`pnpm db:migrate -- --name customers`)

**Interfaces:**
- Produces: Prisma `Customer` modell (mezők lent); `customers: CustomerSeed[]` a seedben; a `expertiseLevel` értékkészlete SZÁNDÉKOSAN a `products.difficulty` skálája: `'kezdő' | 'haladó' | 'profi'`.

- [ ] **Step 1: Modell a schema.prisma végére**

```prisma
// customers — a bolt ÜGYFELEI (lakberendező partnerei). A csomag-összeállítás rájuk épül:
// a budget kemény korlát lesz, az expertise_level a products.difficulty skálájára képeződik.
model Customer {
  id              Int      @id @default(autoincrement())
  code            String   @unique // rövid ügyfélkód — az agent ezzel hivatkozik (pl. ACME)
  name            String // cégnév vagy magánszemély neve
  contactName     String?  @map("contact_name")
  email           String
  city            String
  customerType    String   @map("customer_type") // magánszemély | iroda | étterem | hotel | üzlet
  budget          Decimal  @db.Decimal(12, 2) // keret (HUF)
  expertiseLevel  String   @map("expertise_level") // kezdő | haladó | profi (= products.difficulty)
  petSafeRequired Boolean  @map("pet_safe_required")
  kidSafeRequired Boolean  @map("kid_safe_required")
  notes           String // döntést befolyásoló kontextus (fény, stílus, öntözési hajlandóság)
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("customers")
}
```

- [ ] **Step 2: Migráció**

Run: `docker compose up -d && pnpm db:migrate -- --name customers`
Expected: új mappa `packages/db/prisma/migrations/<ts>_customers/` és sikeres apply.

- [ ] **Step 3: Seed-adat — `packages/db/prisma/customers.ts`**

```typescript
// customers.ts — 20 kézzel írt, ÉLETSZERŰ ügyfél a csomag-demókhoz. A három régi kód
// (ACME, GLOBEX, INITECH) megmarad kompatibilitásból. A budget szándékosan szórt
// (15e–800e Ft), hogy a "nem fér a keretbe → visszalépés" élőben demózható legyen.

export interface CustomerSeed {
  code: string;
  name: string;
  contact_name: string | null;
  email: string;
  city: string;
  customer_type: 'magánszemély' | 'iroda' | 'étterem' | 'hotel' | 'üzlet';
  budget: number;
  expertise_level: 'kezdő' | 'haladó' | 'profi';
  pet_safe_required: boolean;
  kid_safe_required: boolean;
  notes: string;
}

export const customers: CustomerSeed[] = [
  { code: 'ACME', name: 'ACME Studio Kft.', contact_name: 'Vass Petra', email: 'petra@acmestudio.hu', city: 'Budapest', customer_type: 'iroda', budget: 15000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kis belvárosi iroda, kevés természetes fény; senki nem ér rá öntözni, heti egy locsolás a realitás.' },
  { code: 'GLOBEX', name: 'Globex Hungary Zrt.', contact_name: 'Nagy Bence', email: 'bence.nagy@globex.hu', city: 'Budapest', customer_type: 'iroda', budget: 120000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Nyitott irodatér nagy üvegfelületekkel, déli fekvés; recepció mellé látványos, nagy növényeket szeretnének.' },
  { code: 'INITECH', name: 'Initech Consulting', contact_name: 'Kovács Márk', email: 'mark.kovacs@initech.hu', city: 'Budaörs', customer_type: 'iroda', budget: 250000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Van irodai "növényfelelős", ritkaságokra is nyitottak; tárgyalónként legalább egy nagy termetű növény kell.' },
  { code: 'ZOLDSAROK', name: 'Zöld Sarok Kávézó', contact_name: 'Tóth Lilla', email: 'hello@zoldsarok.hu', city: 'Szeged', customer_type: 'étterem', budget: 80000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Családbarát kávézó, a növények gyerekmagasságban lesznek; párás, meleg tér, sok szórt fénnyel.' },
  { code: 'HOTELDUNA', name: 'Hotel Duna Panoráma', contact_name: 'Szabó Gergő', email: 'gergo.szabo@hotelduna.hu', city: 'Budapest', customer_type: 'hotel', budget: 800000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Lobbi + wellness-részleg; reprezentatív, nagy növények kellenek, saját kertész gondozza őket.' },
  { code: 'KISSCSALAD', name: 'Kiss család', contact_name: 'Kiss Andrea', email: 'andrea.kiss84@gmail.com', city: 'Debrecen', customer_type: 'magánszemély', budget: 35000, expertise_level: 'kezdő', pet_safe_required: true, kid_safe_required: true, notes: 'Két kisgyerek és egy macska; napos nappali, de csak strapabíró, nem mérgező növény jöhet.' },
  { code: 'NOVA', name: 'Nova Fitness', contact_name: 'Balogh Réka', email: 'reka@novafitness.hu', city: 'Győr', customer_type: 'üzlet', budget: 60000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Edzőterem magas párával; a recepcióra és az ablakpárkányokra kellenek jól tűrő növények.' },
  { code: 'VERANDA', name: 'Veranda Étterem', contact_name: 'Molnár Dávid', email: 'david@verandaetterem.hu', city: 'Pécs', customer_type: 'étterem', budget: 150000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Télikert jellegű vendégtér, sok direkt nappal; mediterrán hangulatot szeretnének fűszernövényekkel.' },
  { code: 'PIXELLAB', name: 'PixelLab Digital', contact_name: 'Fekete Zsófi', email: 'zsofi@pixellab.hu', city: 'Budapest', customer_type: 'iroda', budget: 45000, expertise_level: 'kezdő', pet_safe_required: true, kid_safe_required: false, notes: 'Kutyabarát iroda (két iroda-kutya); észak fekvés, árnyékos asztalok — csak pet-safe növény jöhet.' },
  { code: 'HARMONIA', name: 'Harmónia Jógastúdió', contact_name: 'Oláh Eszter', email: 'eszter@harmoniajoga.hu', city: 'Budapest', customer_type: 'üzlet', budget: 40000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: true, notes: 'Nyugodt, természetes tér; légtisztító növényeket kérnek, a termekben tompított fény van.' },
  { code: 'SARKANY', name: 'Sárkány Bisztró', contact_name: 'Varga Tamás', email: 'tamas@sarkanybisztro.hu', city: 'Miskolc', customer_type: 'étterem', budget: 25000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kis bisztró, szűk keret; pár mutatós, de olcsó és igénytelen növény az ablakba.' },
  { code: 'GRANIT', name: 'Gránit Ügyvédi Iroda', contact_name: 'dr. Papp Ilona', email: 'ilona.papp@granitlegal.hu', city: 'Budapest', customer_type: 'iroda', budget: 180000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Elegáns, konzervatív enteriőr; formára nyírható / szobrászi megjelenésű növényeket keresnek.' },
  { code: 'BABAKUCKO', name: 'Babakuckó Bölcsőde', contact_name: 'Horváth Kata', email: 'kata@babakucko.hu', city: 'Kecskemét', customer_type: 'üzlet', budget: 30000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Bölcsőde — KIZÁRÓLAG gyerekbiztos növény jöhet, magas polcra is csak nem mérgező kerülhet.' },
  { code: 'SKYLINE', name: 'Skyline Coworking', contact_name: 'Lukács Ádám', email: 'adam@skylinecw.hu', city: 'Budapest', customer_type: 'iroda', budget: 220000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: false, notes: 'Ötszintes coworking, szintenként más fényviszony; állatbarát ház, gurulós kaspókat terveznek.' },
  { code: 'RETROMOZI', name: 'Retro Mozi & Kávézó', contact_name: 'Simon Petra', email: 'petra@retromozi.hu', city: 'Szombathely', customer_type: 'étterem', budget: 55000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Sötét előtér, alig van természetes fény — csak árnyéktűrő növény életképes itt.' },
  { code: 'TOTHKERT', name: 'Tóth Bernadett', contact_name: null, email: 'bernadett.toth@freemail.hu', city: 'Eger', customer_type: 'magánszemély', budget: 90000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Gyűjtő: ritka filodendronokat és könnyen szaporítható különlegességeket keres a déli teraszára.' },
  { code: 'MEDIPONT', name: 'MediPont Magánklinika', contact_name: 'dr. Szűcs Gábor', email: 'gabor.szucs@medipont.hu', city: 'Budapest', customer_type: 'iroda', budget: 130000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Váró és gyerekorvosi részleg; allergiabarát, nem virágzó, könnyen tisztán tartható növények.' },
  { code: 'LOFT27', name: 'Loft27 Airbnb', contact_name: 'Kerekes Máté', email: 'mate@loft27.hu', city: 'Budapest', customer_type: 'magánszemély', budget: 20000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kiadó lakás — hetekig nem jár ott senki, csak extrém szárazságtűrő növény marad életben.' },
  { code: 'PANORAMA', name: 'Panoráma Étterem', contact_name: 'Bakos Nóra', email: 'nora@panorama-etterem.hu', city: 'Balatonfüred', customer_type: 'étterem', budget: 300000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Tóra néző terasz + belső tér; nyáron tűző nap, télen fűtött télikert — kétlaki növényállomány kell.' },
  { code: 'GREENDESK', name: 'GreenDesk Iroda', contact_name: 'Sipos Vera', email: 'vera@greendesk.hu', city: 'Veszprém', customer_type: 'iroda', budget: 70000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: true, notes: 'Családbarát + kutyabarát iroda; közepes fény, a kollégák beosztásban öntöznek.' },
];
```

- [ ] **Step 4: Seed bekötése — `seed.ts`**

Import + a `main()` bővítése (a products-blokk UTÁN), upsert a FK-biztos idempotenciáért:

```typescript
import { customers, type CustomerSeed } from './customers';

function toCustomerInput(c: CustomerSeed): Prisma.CustomerCreateInput {
  return {
    code: c.code,
    name: c.name,
    contactName: c.contact_name,
    email: c.email,
    city: c.city,
    customerType: c.customer_type,
    budget: c.budget,
    expertiseLevel: c.expertise_level,
    petSafeRequired: c.pet_safe_required,
    kidSafeRequired: c.kid_safe_required,
    notes: c.notes,
  };
}

// a main()-ben:
  // Ügyfelek: upsert code szerint — deleteMany helyett, mert a threads FK-val hivatkozik rájuk.
  for (const c of customers) {
    await prisma.customer.upsert({
      where: { code: c.code },
      create: toCustomerInput(c),
      update: toCustomerInput(c),
    });
  }
  console.log(`Seed kész: ${customers.length} ügyfél betöltve.`);
```

- [ ] **Step 5: Futtatás + ellenőrzés + commit**

Run: `pnpm db:seed` kétszer egymás után.
Expected: mindkétszer hibátlan (idempotens), „20 ügyfél betöltve".
Gyors ellenőrzés: `docker compose exec -T db psql -U plantbase -c "select count(*) from customers;"` → 20.

```bash
git add packages/db/prisma
git commit -m "feat: customers tábla + 20 életszerű seed-ügyfél"
```

---

### Task 10: `queryCustomers` tool + a `getClientPreferences` kivezetése (J10-zel)

**Files:**
- Create: `packages/core/src/lib/tools/query-customers/query-customers-tool.ts`, `.../query-customers-tool.spec.ts`
- Modify: `packages/core/src/lib/agents/query-agent/query-agent.ts`, `.../query-prompt.ts:89`, `packages/core/src/index.ts`
- Delete: `packages/core/src/lib/tools/get-client-preferences/` (mindkét fájl)

**Interfaces:**
- Consumes: `getPrisma()` (Task 8), `ToolOutcome`, `ToolReporter`.
- Produces: `executeQueryCustomers(rawInput: unknown, deps?: { prisma?: PrismaClient }): Promise<ToolOutcome>` és `queryCustomersTool(report?: ToolReporter)`; a `buildQueryToolset` kulcsai: `runSql, searchKnowledge, queryCustomers` (+ admin: `delegateToIngest`).

- [ ] **Step 1: Write the failing tests**

`query-customers-tool.spec.ts` — a Prisma-t injektáljuk, nem kell élő DB:

```typescript
import { executeQueryCustomers } from './query-customers-tool.js';

const acme = {
  code: 'ACME', name: 'ACME Studio Kft.', contactName: 'Vass Petra',
  email: 'petra@acmestudio.hu', city: 'Budapest', customerType: 'iroda',
  budget: 15000, expertiseLevel: 'kezdő',
  petSafeRequired: false, kidSafeRequired: false,
  notes: 'Kis belvárosi iroda, kevés fény.',
};

function fakePrisma(rows: unknown[]) {
  return { customer: { findMany: async () => rows } } as never;
}

describe('executeQueryCustomers', () => {
  it('kód szerint visszaadja az ügyfelet', async () => {
    const out = await executeQueryCustomers({ code: 'ACME' }, { prisma: fakePrisma([acme]) });
    expect(out.isError).toBe(false);
    expect(out.rowCount).toBe(1);
    expect(JSON.parse(out.content)[0].code).toBe('ACME');
  });

  it('nincs találat → nem hiba, hanem magyar üzenet', async () => {
    const out = await executeQueryCustomers({ code: 'NINCS' }, { prisma: fakePrisma([]) });
    expect(out.isError).toBe(false);
    expect(out.rowCount).toBe(0);
    expect(out.content).toContain('Nincs ilyen ügyfél');
  });

  it('DB-hiba → ToolOutcome hibaként, nem exception', async () => {
    const boom = { customer: { findMany: async () => { throw new Error('kapcsolat megszakadt'); } } } as never;
    const out = await executeQueryCustomers({}, { prisma: boom });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('ügyfél-lekérdezés');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test @plantbase/core -- run src/lib/tools/query-customers/query-customers-tool.spec.ts`
Expected: FAIL — a modul nem létezik.

- [ ] **Step 3: Implementáció**

`query-customers-tool.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaClient } from '@plantbase/db';
import type { ToolOutcome, ToolReporter } from '../tool-outcome.js';
import { getPrisma } from '../prisma-client.js';

// queryCustomers tool — a bolt ÜGYFELEINEK lekérdezése (customers tábla, Prismán át).
// A getClientPreferences utódja: a fix térkép helyett élő DB, és nemcsak preferenciát,
// hanem teljes ügyfél-profilt ad (keret, szint, pet/kid-safe, notes). A modell ebből
// tudja, KINEK ajánl: a budget és a notes a csomag-összeállítás alapja lesz.

const CUSTOMER_TYPES = ['magánszemély', 'iroda', 'étterem', 'hotel', 'üzlet'] as const;

const InputSchema = z.object({
  code: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
});

const LIST_LIMIT = 20;

export async function executeQueryCustomers(
  rawInput: unknown,
  deps: { prisma?: PrismaClient } = {},
): Promise<ToolOutcome> {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      content:
        'Érvénytelen ügyfél-lekérdezés. Használható mezők: code (pontos ügyfélkód), ' +
        `search (név/város részlet), customerType (${CUSTOMER_TYPES.join(' | ')}).`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
  const { code, search, customerType } = parsed.data;

  try {
    const prisma = deps.prisma ?? getPrisma();
    const rows = await prisma.customer.findMany({
      where: {
        ...(code ? { code: code.toUpperCase() } : {}),
        ...(customerType ? { customerType } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
      take: LIST_LIMIT,
    });

    if (rows.length === 0) {
      return {
        content: 'Nincs ilyen ügyfél a nyilvántartásban.',
        isError: false,
        summary: 'ügyfél-lekérdezés · 0 találat',
        rowCount: 0,
      };
    }

    // Kompakt JSON a modellnek: csak a döntéshez kellő mezők, Decimal → szám.
    const compact = rows.map((r) => ({
      code: r.code,
      name: r.name,
      city: r.city,
      customerType: r.customerType,
      budget: Number(r.budget),
      expertiseLevel: r.expertiseLevel,
      petSafeRequired: r.petSafeRequired,
      kidSafeRequired: r.kidSafeRequired,
      notes: r.notes,
    }));
    const label = code ?? search ?? customerType ?? 'összes';
    return {
      content: JSON.stringify(compact),
      isError: false,
      summary: `${rows.length} ügyfél · ${label}`,
      rowCount: rows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Az ügyfél-lekérdezés nem sikerült: ${message}`,
      isError: true,
      summary: null,
      rowCount: null,
    };
  }
}

export const queryCustomersTool = (report?: ToolReporter) =>
  tool({
    description:
      'A bolt ügyfeleinek lekérdezése. Ha a felhasználó egy ügyfélre hivatkozik (kóddal, névvel ' +
      'vagy várossal), ezzel kérd le a profilját: keret (budget, Ft), hozzáértés (expertiseLevel: ' +
      'kezdő | haladó | profi), pet/kid-safe igény és szöveges jegyzet (notes — fényviszonyok, ' +
      'stílus). Paraméter nélkül az első 20 ügyfelet listázza.',
    inputSchema: z.object({
      code: z.string().optional().describe('Pontos ügyfélkód, pl. ACME.'),
      search: z.string().optional().describe('Név- vagy városrészlet kereséshez.'),
      customerType: z.string().optional().describe('Szűrés típusra: magánszemély | iroda | étterem | hotel | üzlet.'),
    }),
    execute: async (input, { toolCallId }) => {
      const outcome = await executeQueryCustomers(input);
      report?.(toolCallId, 'queryCustomers', input, outcome);
      return outcome.content;
    },
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test @plantbase/core -- run src/lib/tools/query-customers/query-customers-tool.spec.ts`
Expected: PASS (3 teszt).

- [ ] **Step 5: Bekötés + a régi tool kivezetése**

1. `query-agent.ts`: importcsere (`getClientPreferencesTool` → `queryCustomersTool`), a `buildQueryToolset`-ben `getClientPreferences: …` sor helyett `queryCustomers: queryCustomersTool(report),`.
2. `query-agent.spec.ts` (Task 1): a várt kulcslista frissítése `'queryCustomers'`-re.
3. `query-prompt.ts:89`: a tool-leírás cseréje:

```
- queryCustomers(code|search|customerType): a bolt ügyfeleinek profilja — keret (Ft), hozzáértés
  (kezdő|haladó|profi), pet/kid-safe igény, jegyzet. Ha a kérdés egy ügyfélről szól ("az ACME-nek",
  "a szegedi kávézónak"), ELŐSZÖR ezt hívd, és a választ az ő keretéhez/igényeihez igazítsd.
```

4. `index.ts`: a `get-client-preferences` export helyett `export * from './lib/tools/query-customers/query-customers-tool.js';`
5. `git rm -r packages/core/src/lib/tools/get-client-preferences`
6. Grep-ellenőrzés: `grep -rn "getClientPreferences" packages apps --include="*.ts*" | grep -v node_modules` → üres.

- [ ] **Step 6: Teljes teszt + kézi füst + commit**

Run: `pnpm nx test @plantbase/core && pnpm typecheck && pnpm build`
Kézi: `pnpm cli ask "mit ajánlanál a Kiss családnak 30 ezer forintból?"` — a trace-ben `queryCustomers` hívás fut, a válasz a macskás/gyerekes profilhoz igazodik.

```bash
git add -A packages/core
git commit -m "feat: queryCustomers tool (Prisma, customers tábla) — a getClientPreferences kivezetve"
```

---

### Task 11: `threads` + `messages` táblák

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Customer modell kiegészítése + két új modell), migráció.

**Interfaces:**
- Produces: `Thread` (id: string cuid, title, customerId?, createdAt, updatedAt), `Message` (id, threadId, role, parts Json, createdAt).

- [ ] **Step 1: Modellek**

A `Customer` modellbe (a `createdAt` alá): `threads Thread[]`. Majd a séma végére:

```prisma
// threads + messages — a WEB-CHAT PERZISZTENCIA. A DB az igazságforrás: a kliens csak az új
// üzenetet küldi, az előzményt a szerver innen tölti. A parts a TELJES UIMessage.parts JSON —
// így újratöltéskor a tool-kártyák is visszarajzolódnak, nem csak a szöveg.
model Thread {
  id         String    @id @default(cuid())
  title      String // az első user-üzenet első ~60 karaktere
  customerId Int?      @map("customer_id") // opcionális: melyik ügyfélről szól (a csomag-flow tölti majd)
  customer   Customer? @relation(fields: [customerId], references: [id])
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  messages   Message[]

  @@map("threads")
}

model Message {
  id        Int      @id @default(autoincrement())
  threadId  String   @map("thread_id")
  thread    Thread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role      String // user | assistant
  parts     Json // a teljes UIMessage.parts
  createdAt DateTime @default(now()) @map("created_at")

  @@index([threadId])
  @@map("messages")
}
```

- [ ] **Step 2: Migráció + ellenőrzés + commit**

Run: `pnpm db:migrate -- --name threads_messages && pnpm db:reset`
Expected: migráció OK; a reset után seed zöld (products + 20 customer).

```bash
git add packages/db/prisma
git commit -m "feat: threads + messages táblák (web-chat perzisztencia, parts JSON-nal)"
```

---

### Task 12: szerver — thread-API (`threads.ts`)

**Files:**
- Create: `apps/server/src/threads.ts`, `apps/server/src/threads.spec.ts`, `apps/server/vitest.config.mts`
- Modify: `apps/server/src/main.ts` (router bekötése), `apps/server/package.json` (ha kell: vitest devDep a rootból jön)

**Interfaces:**
- Consumes: `PrismaClient` (`@plantbase/db`).
- Produces: `threadsRouter` (Express Router: `GET /` lista, `GET /:id` üzenetek), `clipTitle(text: string): string`, `rowToUIMessage(row: { id: number; role: string; parts: unknown }): UIMessage`, valamint `getServerPrisma(): PrismaClient` (modul-szintű lazy singleton, a Task 13 is ezt használja).

- [ ] **Step 1: Write the failing tests**

`apps/server/src/threads.spec.ts`:

```typescript
import { clipTitle, rowToUIMessage } from './threads.js';

describe('clipTitle', () => {
  it('rövid szöveget változatlanul hagy', () => {
    expect(clipTitle('Pet-safe növények?')).toBe('Pet-safe növények?');
  });
  it('60 karakter fölött levág és … jelet tesz', () => {
    const long = 'a'.repeat(80);
    expect(clipTitle(long)).toHaveLength(61); // 60 + '…'
    expect(clipTitle(long).endsWith('…')).toBe(true);
  });
  it('sortöréseket szóközzé lapít', () => {
    expect(clipTitle('első\nmásodik')).toBe('első második');
  });
});

describe('rowToUIMessage', () => {
  it('DB-sorból UIMessage-et épít', () => {
    const msg = rowToUIMessage({ id: 7, role: 'assistant', parts: [{ type: 'text', text: 'szia' }] });
    expect(msg).toEqual({ id: '7', role: 'assistant', parts: [{ type: 'text', text: 'szia' }] });
  });
});
```

`apps/server/vitest.config.mts` (a core configja mintájára):

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  test: {
    name: 'server',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
  },
}));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test server`
Expected: FAIL — `threads.js` nem létezik. (Ha az nx nem látja a test targetet, futtasd közvetlenül: `pnpm vitest run --config apps/server/vitest.config.mts`.)

- [ ] **Step 3: Implementáció — `threads.ts`**

```typescript
import { Router } from 'express';
import { PrismaClient } from '@plantbase/db';
import type { UIMessage } from 'ai';

// threads.ts — a beszélgetés-perzisztencia HTTP-oldala. A DB az igazságforrás: ez a réteg
// listázza a threadeket és adja vissza egy thread üzeneteit UIMessage[]-ként, hogy a kliens
// (useChat) pontosan ott folytassa, ahol az előzmény tart — tool-kártyákkal együtt.

let prisma: PrismaClient | null = null;
/** Lazy Prisma a szervernek — a chat-handler (main.ts) is ezt használja. */
export function getServerPrisma(): PrismaClient {
  if (prisma === null) {
    prisma = new PrismaClient();
  }
  return prisma;
}

const TITLE_MAX = 60;

/** Thread-cím az első user-üzenetből: egy sorba lapítva, 60 karakterre vágva. */
export function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX) + '…' : flat;
}

/** DB-sor → UIMessage. A parts változtatás nélkül jön vissza (úgy mentettük, ahogy streameltük). */
export function rowToUIMessage(row: {
  id: number;
  role: string;
  parts: unknown;
}): UIMessage {
  return {
    id: String(row.id),
    role: row.role as UIMessage['role'],
    parts: row.parts as UIMessage['parts'],
  };
}

export const threadsRouter = Router();

// GET /api/threads — a lista a chat alá: cím + frissesség, legutóbbi elöl.
threadsRouter.get('/', async (_req, res) => {
  const threads = await getServerPrisma().thread.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  res.json(threads);
});

// GET /api/threads/:id — egy beszélgetés teljes előzménye UIMessage[]-ként.
threadsRouter.get('/:id', async (req, res) => {
  const thread = await getServerPrisma().thread.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!thread) {
    res.status(404).send('Nincs ilyen beszélgetés.');
    return;
  }
  res.json({ id: thread.id, title: thread.title, messages: thread.messages.map(rowToUIMessage) });
});
```

`main.ts`-be a debug-router mellé: `app.use('/api/threads', threadsRouter);` (+ import).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test server` (vagy a közvetlen vitest-parancs)
Expected: PASS (4 teszt).

- [ ] **Step 5: Kézi füst + commit**

Run: `pnpm server` külön terminálban, majd `curl -s localhost:3001/api/threads` → `[]`.

```bash
git add apps/server
git commit -m "feat: thread-API (GET /api/threads, GET /api/threads/:id) + szerver-vitest"
```

---

### Task 13: szerver — a chat-handler perzisztál (DB az igazságforrás)

**Files:**
- Modify: `apps/server/src/main.ts` (a `POST /api/chat` handler átírása), `apps/server/src/threads.ts` (egy helper hozzáadása)

**Interfaces:**
- Consumes: `getServerPrisma`, `clipTitle`, `rowToUIMessage` (Task 12); `askAgent` (core); `createUIMessageStream`, `pipeUIMessageStreamToResponse`, `convertToModelMessages` (`ai`).
- Produces: `POST /api/chat` body: `{ threadId?: string, message: UIMessage }`; a stream elején `data-thread` part `{ threadId }` adattal; user+assistant üzenetek a `messages` táblában.
- FONTOS: a kliens (Task 14) ugyanebben a taskban még nem áll át — a régi `messages[]` body ettől a tasktól kezdve NEM támogatott, ezért a Task 13+14 EGY PR-nyi egység, közéjük más ne ékelődjön.

- [ ] **Step 1: `stripDataParts` helper a `threads.ts`-be**

```typescript
/** A data-* partok (pl. data-thread) CSAK a UI-nak szólnak — a modell-előzménybe nem valók. */
export function stripDataParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.filter((part) => !part.type.startsWith('data-')),
  }));
}
```

Spec-kiegészítés a `threads.spec.ts`-be:

```typescript
describe('stripDataParts', () => {
  it('kiszűri a data-* partokat, a többit megtartja', () => {
    const [m] = stripDataParts([
      { id: '1', role: 'assistant', parts: [
        { type: 'data-thread', data: { threadId: 'x' } },
        { type: 'text', text: 'szia' },
      ] } as never,
    ]);
    expect(m.parts).toEqual([{ type: 'text', text: 'szia' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then implement, then pass**

Run: `pnpm nx test server` → FAIL (nincs `stripDataParts`) → add hozzá → PASS.

- [ ] **Step 3: A handler átírása (`main.ts`)**

A `POST /api/chat` teljes cseréje (az `extractText` marad):

```typescript
app.post('/api/chat', async (req, res) => {
  const { threadId, message } = (req.body ?? {}) as {
    threadId?: string;
    message?: UIMessage;
  };
  const question = message?.role === 'user' ? extractText(message) : '';
  if (!message || question === '') {
    res.status(400).send('Üres kérdést nem lehet feltenni.');
    return;
  }

  const prisma = getServerPrisma();
  try {
    // (1) Thread: meglévő betöltése vagy új nyitása — a cím az első kérdésből.
    const thread = threadId
      ? await prisma.thread.findUnique({ where: { id: threadId } })
      : await prisma.thread.create({ data: { title: clipTitle(question) } });
    if (!thread) {
      res.status(404).send('Nincs ilyen beszélgetés.');
      return;
    }

    // (2) Előzmény a DB-ből (a mostani üzenet ELŐTTI állapot) → modell-előzmény.
    const priorRows = await prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    const history = await convertToModelMessages(
      stripDataParts(priorRows.map(rowToUIMessage)),
    );

    // (3) A user-üzenet mentése — a válasz sikerétől függetlenül megmarad.
    await prisma.message.create({
      data: { threadId: thread.id, role: 'user', parts: message.parts as object },
    });

    // (4) Stream: elöl a data-thread part (ebből tudja meg a kliens az új thread id-t),
    //     mögé az agent üzenet-streamje; a kész választ az onFinish menti.
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'data-thread', data: { threadId: thread.id } });
        await askAgent(question, {
          print: true,
          history,
          onStream: (result) => writer.merge(result.toUIMessageStream()),
        });
      },
      onFinish: async ({ responseMessage }) => {
        await prisma.message.create({
          data: {
            threadId: thread.id,
            role: 'assistant',
            parts: responseMessage.parts as object,
          },
        });
        // frissesség a listához
        await prisma.thread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
    pipeUIMessageStreamToResponse({ response: res, stream });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`plantbase szerver hiba: ${messageText}`);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).send(messageText);
    }
  }
});
```

Importok frissítése: `createUIMessageStream, pipeUIMessageStreamToResponse` az `ai`-ból;
`getServerPrisma, clipTitle, rowToUIMessage, stripDataParts` a `./threads.js`-ből.
A fejléc-komment KLIENS-bekezdését igazítsd: „a kliens csak az ÚJ üzenetet + threadId-t küldi; az előzmény a DB-ből jön."
Ha a `pipeUIMessageStreamToResponse` szignatúrája eltér (typecheck hiba), nézd meg: `node_modules/ai/dist/index.d.ts` — a v6-ban `pipeUIMessageStreamToResponse({ response, stream })` a helyes forma.
A shutdown-ba: `await getServerPrisma().$disconnect();` a pool-zárások mellé.

- [ ] **Step 4: Ellenőrzés + commit**

Run: `pnpm typecheck && pnpm nx test server`
Kézi füst (kliens még a régi — curl-lel tesztelünk):

```bash
curl -sN localhost:3001/api/chat -H 'content-type: application/json' \
  -d '{"message":{"id":"u1","role":"user","parts":[{"type":"text","text":"Mennyibe kerül a monstera?"}]}}' | head -5
```

Expected: a stream elején `data-thread` part; utána `curl -s localhost:3001/api/threads` → 1 thread; a `messages` táblában 2 sor.

```bash
git add apps/server/src
git commit -m "feat: chat-handler perzisztál — DB-előzmény, data-thread part, üzenet-mentés onFinish-ben"
```

---

### Task 14: web — új üzenet-küldés, URL-betöltés, thread-lista

**Files:**
- Create: `apps/web/src/components/thread-list.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/threads`, `GET /api/threads/:id`, `POST /api/chat { threadId?, message }`, `data-thread` part (Task 13).
- Produces: `?thread=<id>` URL-séma; `<ThreadList activeId onSelect />` komponens.

- [ ] **Step 1: ThreadList komponens**

`apps/web/src/components/thread-list.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// thread-list.tsx — a korábbi beszélgetések a chat ALATT. Kattintásra ?thread=<id>-re
// navigálunk TELJES újratöltéssel: a betöltés útja így ugyanaz, mint egy megosztott linké —
// egy útvonal van, nem kettő (szándékos egyszerűsítés).

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

export function ThreadList({ activeId }: { activeId: string | null }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/threads`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setThreads)
      .catch(() => setThreads([]));
  }, []);

  if (threads.length === 0) {
    return null;
  }
  return (
    <nav className="border-t pt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase">Korábbi beszélgetések</h2>
        <Button variant="ghost" size="sm" onClick={() => window.location.assign(window.location.pathname)}>
          Új beszélgetés
        </Button>
      </div>
      <ul className="max-h-40 overflow-y-auto">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted ${t.id === activeId ? 'bg-muted font-medium' : ''}`}
              onClick={() => window.location.assign(`?thread=${t.id}`)}
            >
              {t.title}
              <span className="text-muted-foreground ml-2 text-xs">
                {new Date(t.updatedAt).toLocaleDateString('hu-HU')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: App.tsx — threadId a URL-ből, csak az új üzenet megy fel**

A modul-szintű `transport` konstans TÖRLENDŐ; a komponensbe:

```tsx
// A thread id a URL-ben él (?thread=<id>) — megosztható, újratöltés-álló. Új beszélgetésnél
// a szerver data-thread partja adja meg az id-t, és csendben beírjuk a címsorba.
const initialThreadId = new URLSearchParams(window.location.search).get('thread');

export default function App() {
  const threadIdRef = useRef<string | null>(initialThreadId);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
    initialThreadId ? null : [],
  );

  // URL-ből érkezve: az előzmény a szerverről (tool-kártyákkal együtt).
  useEffect(() => {
    if (!initialThreadId) return;
    fetch(`${apiBaseUrl}/api/threads/${initialThreadId}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((t) => setInitialMessages(t.messages))
      .catch(() => setInitialMessages([]));
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBaseUrl}/api/chat`,
        // Csak az ÚJ üzenet + a threadId megy fel — az előzmény a szerver DB-jéből jön.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { threadId: threadIdRef.current, message: messages[messages.length - 1] },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport,
    onData: (part) => {
      // A szerver első partja az új thread id-je — URL-be írjuk, hogy megosztható legyen.
      if (part.type === 'data-thread') {
        const { threadId } = part.data as { threadId: string };
        threadIdRef.current = threadId;
        window.history.replaceState(null, '', `?thread=${threadId}`);
      }
    },
  });

  // Betöltött előzmény beemelése a chatbe (egyszer, amikor megérkezett).
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);
```

Betöltés-jelzés: amíg `initialMessages === null`, a lista helyén `<p className="text-muted-foreground text-sm">beszélgetés betöltése…</p>`.
A JSX aljára (a form UTÁN): `<ThreadList activeId={threadIdRef.current} />`.
Importok: `useEffect, useMemo, useRef` a reactból, `type UIMessage` az `ai`-ból, `ThreadList` a komponensből.
(Ha a `useChat` `onData` opciója más néven fut a telepített verzióban, ellenőrizd: `node_modules/@ai-sdk/react/dist/index.d.ts` — a cél: a `data-thread` part elkapása.)

- [ ] **Step 3: Ellenőrzés + commit**

Run: `pnpm typecheck && pnpm nx build web`
Kézi füst: `pnpm server` + `pnpm web` →
1. új kérdés → az URL `?thread=<id>`-re vált;
2. F5 → az előzmény tool-kártyákkal visszajön;
3. második beszélgetés után a lista két elemet mutat, kattintásra vált;
4. „Új beszélgetés" → üres chat, URL paraméter nélkül.

```bash
git add apps/web/src
git commit -m "feat: web thread-lista + URL-ből betölthető beszélgetés (?thread=<id>), csak az új üzenet megy fel"
```

---

### Task 15: zárókör — teljes verifikáció

**Files:** nincs új; futtatás + jegyzőkönyv.

- [ ] **Step 1: Teljes kapu**

```bash
pnpm build && pnpm test && pnpm lint && pnpm typecheck
```

Expected: mind zöld.

- [ ] **Step 2: Végig-füstteszt (a spec 6. pontja)**

`pnpm db:reset` → `pnpm server` + `pnpm web` → új beszélgetés („mit ajánlanál a GreenDesk irodának?") → a trace-ben `queryCustomers` fut → URL-be kerül az id → F5 → chipekkel visszajön → thread-listából váltás működik → `pnpm cli ask` továbbra is működik (CLI-t nem érintettük).

- [ ] **Step 3: Záró commit (ha maradt el bármi) + jelentés**

A branch NEM kerül pushra — jelezd Istvánnak, hogy a `worktree-baseline-proposal` branch kész a review-ra, és ezután indulhat az orchestrator-terv.
