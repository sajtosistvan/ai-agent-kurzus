# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Plantbase is a CLI AI agent (course project) that turns natural-language questions into **read-only SQL** over a plant catalog (`products`) and answers in Hungarian. The pedagogical goal is that the agent mechanics stay **visible layer by layer**. User-facing text, comments, and the domain vocabulary are Hungarian; keep that convention when editing.

## Commands

Package manager is **pnpm** (via `corepack enable`). Root scripts wrap Nx; prefer them.

```bash
# Build / test / lint / typecheck (all projects, via nx run-many)
pnpm build            # nx run-many -t build
pnpm test             # nx run-many -t test  (Vitest)
pnpm lint
pnpm typecheck
pnpm format           # prettier --write .

# Per-project
pnpm nx build @plantbase/core
pnpm nx test @plantbase/core

# A single test file / test name (Vitest args after `--`)
pnpm nx test @plantbase/core -- run src/mastra/tools/katalogus-sql/sql-guard.spec.ts
pnpm nx test @plantbase/core -- -t "rejects non-SELECT"

# Run the CLI in DEV (runs TypeScript source directly, no build — see source condition below)
pnpm cli ask "mutass 3 pet-safe növényt raktáron, 5000 Ft alatt"
pnpm cli ask                 # interactive query mode (one Mastra Memory thread per session)
pnpm cli ingest "..."        # catalog-editor agent (writes!); no args → interactive
pnpm cli ask --thread <id>   # continue an earlier conversation (Mastra Memory thread id)

# Mastra Studio — the agent/tool/trace inspector (replaces the old hand-written live trace)
pnpm mastra:dev              # `mastra dev --dir packages/core/src/mastra --env .env`
pnpm mastra:build            # `mastra build --dir packages/core/src/mastra`

# MCP server (stdio) — the Plantbase tools exposed to an EXTERNAL host (Claude Code/Desktop)
pnpm mcp                     # runs the stdio server; a host normally spawns this, not you
pnpm mcp:inspect             # MCP Inspector in the browser — test tools without a host


# Database (Prisma, read-write connection)
docker compose up -d         # Postgres on host port 5433 (NOT 5432)
pnpm db:migrate              # prisma migrate dev
pnpm db:seed                 # idempotent ~30-plant seed
pnpm db:reset                # drop + migrate + seed
pnpm db:studio               # Prisma Studio (localhost:5555)
```

First-time setup: `pnpm install` (postinstall runs `prisma generate`) → `cp .env.example .env` and fill `ANTHROPIC_API_KEY` → `docker compose up -d` → `pnpm db:migrate && pnpm db:seed`.

## Architecture

Nx monorepo, three projects: **`apps/cli`** (`@plantbase/cli`, commander + readline entrypoint), **`packages/core`** (`@plantbase/core`, the Mastra instance and everything on it), **`packages/db`** (`@plantbase/db`, Prisma schema/migrations/seed + generated client). Plus the other entrypoints over the same core: **`apps/server`** (HTTP + streaming chat), **`apps/web`**, and **`apps/mcp`** (`@plantbase/mcp`, MCP stdio server — see `docs/mcp.md`).

`packages/core` runs on the **Mastra** agent framework (ADR-0003). It used to have a hand-written agent loop, deliberately framework-free; that decision was reversed once the mechanics were taught and the maintenance cost of the home-grown loop, trace and orchestrator outweighed its teaching value. Read ADR-0003…0006 before changing the shape of this layer.

### The Mastra instance (`packages/core/src/mastra/index.ts`)

Everything hangs off **one** `Mastra` instance: agents, tools, workflows, scorers, storage, vector store, observability, logger. What is not registered there does not appear in Mastra Studio (`pnpm mastra:dev`).

```
packages/core/src/mastra/
├── index.ts        # the Mastra instance — the root of everything
├── tarolas.ts      # PostgresStore (threads, messages, working memory, traces, scores)
├── memoria.ts      # Memory: lastMessages + semanticRecall (PgVector) + workingMemory
├── agents/         # 1 agent = 1 file
├── tools/          # 1 tool = 1 file (createTool), its parts in a sibling dir of the same name
├── workflows/      # deterministic step chains with human approval (suspend/resume)
├── processors/     # input processors, in order: PII → RBAC → topic guardrail
├── scorers/        # 4 deterministic + 1 LLM judge
└── rag/            # PgVector knowledge base + the search tool
```

**There is no hand-written loop.** `agent.stream()` / `agent.generate()` *is* the loop. Observability is the framework's job too: no custom `Trace`, no `ToolOutcome` report side-channel — traces, logs and scores go to Postgres and are read back in Studio (ADR-0004).

- **`plantbase-supervisor`** — entry point of the server chat path. Delegates via Mastra sub-agents (the `agents` field), which replaced the hand-written orchestrator: no `routeTo`/`requestInfo`/`askInfoAgent` signal tools, no router/delegate handover split, no flow-lock, and **no `ORCHESTRATION_MODE` env switch** — one path (ADR-0005). The field is dynamic: in customer role the catalog agent is not in the list at all, so it cannot be delegated to.
- **`plantbase-query`** — NL → SQL → read-only catalog, plus the knowledge base. Tools: `katalogus_sql`, `tudasbazis_kereses`, `ugyfel_lekerdezes`. Never writes.
- **`plantbase-katalogus`** — conversational catalog editing. Tools: `webshop_feed` (live Shopify `products.json`), `katalogus_sql`, `termek_mentes` (the **only** in-app write path).
- **`plantbase-csomag`** — the plant-package flow. Tools: `csomag_ellenorzes`, `csomag_mentes`, `csomag_elvetes`; the human approval point is `workflows/csomag-workflow.ts` (suspend/resume).

Sub-agents get their **own memory thread** — sharing the caller's thread makes the Anthropic API reject the message order („does not support assistant message prefill"). See the comment block in `plantbase-supervisor.ts`.

### Tool layer (`packages/core/src/mastra/tools/`)

**One tool = one file** (`createTool`), its ingredients in a sibling directory named after it — `ls tools/` shows all seven tools on one screen:

```
tools/
├── katalogus-sql-tool.ts        # katalogus_sql        → katalogus-sql/{sql-guard,db-readonly}
├── ugyfel-lekerdezes-tool.ts    # ugyfel_lekerdezes
├── webshop-feed-tool.ts         # webshop_feed         → webshop-feed/shopify-feed
├── termek-mentes-tool.ts        # termek_mentes        → termek-mentes/{product-schema,db-readwrite}
├── csomag-{ellenorzes,mentes,elvetes}-tool.ts          → csomag/{package-validation,package-plan}
└── prisma-client.ts             # shared by three tools
```

The model-facing `id` is snake_case Hungarian. Every tool declares both an `inputSchema` and an **`outputSchema`**, and returns a structured object — not a JSON string. `execute` **never throws**: errors come back inside the schema (`sikeres: false` + a Hungarian message), so bad LLM input yields our own error text, not an SDK exception. Logging goes through `mastra?.getLogger()`. **Adding a tool = one new file + one line in the agent's `tools` map** (and one in `mastra/index.ts` if you want it standalone in Studio).

### Read/write separation (NFR1) — the core safety design

The query path can **never** write. Three independent layers enforce it: (1) the `plantbase_ro` Postgres role (SELECT-only), (2) `sql-guard.ts` (only `SELECT`/`WITH … SELECT`, single statement, mandatory `LIMIT`), (3) every query runs inside `START TRANSACTION READ ONLY` (`db-readonly.ts`).

Writes happen only via Prisma (migrations/seed) and the catalog agent's `termek_mentes`, which runs on a **separate read-write pg pool** (`db-readwrite.ts`) — strictly Zod-validated (`product-schema.ts`) and parameterized, keyed on `latin_name` for idempotent upsert. The agent cannot run raw write SQL.

This maps to **two DB URLs / two roles**: `DATABASE_URL` (read-write: Prisma, `termek_mentes`, and all Mastra storage) and `DATABASE_URL_READONLY` (the `katalogus_sql` tool). Note the agent does **not** query the catalog through Prisma — `katalogus_sql` uses a direct `pg` read-only connection; Prisma is schema/migration/seed/studio, the generated client (`packages/db/generated/client`), and the customer/package tools.

A fourth, softer layer sits on top: the `csak-olvaso-ut` scorer measures on every query-agent run whether a writing tool was called — a metric, not a guard, visible in Studio.

### Config boundary

`config.ts` validates env with Zod (fail-fast): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_URL_READONLY`. The read-write `DATABASE_URL` is validated **locally in `db-readwrite.ts`** (deliberately kept out of shared config so the query agent doesn't require it).

### Dev vs. build resolution (source condition)

`@plantbase/core`'s `exports` map defines a `@plantbase/source` condition → `./src/index.ts`. `pnpm cli` runs `tsx --conditions=@plantbase/source`, so the CLI executes **TypeScript source directly with no build** — edits to `core` take effect immediately. Tests and `nx build` use the compiled `./dist`, so run a build/typecheck to catch what the source path won't.

### Prompts

The **product's** prompts to the LLM live in the agent file itself, as the Mastra `instructions` field (there are no separate `*-prompt.ts` files any more). They are XML-tagged (`<role>`, `<schema>`, `<rules>`, `<tools>`, …) to reduce hallucination. This applies only to prompts the product sends the model, not to developer-facing prompts.

### Feed ingest details

`shopify-feed.ts` fetches paginated Shopify `products.json`, filters out non-plants, extracts the botanical (latin) name as the natural key, converts non-HUF prices at fixed rates (**USD=310, EUR=350**), and dedups by latin name. The agent then fills the Hungarian name/description and inferred care fields before writing via `upsertProduct`. The standalone `.claude/skills/product-ingest/` skill implements the same pipeline as scripts for bulk use outside the app.

## Architecture Decision Records (ADR)

The project keeps a **decision log** in `docs/adr/`: one file per decision recording *why*, the alternatives considered, and the consequences. The code shows *what* we do; ADRs preserve *why*.

**When to write an ADR** (this is a rule, not a suggestion): whenever a decision is architecturally significant or hard to reverse — a structural/technology choice, a project-wide convention, or the disposition of an **autotest review** (which suggestions we adopt vs. reject, and why). Skip ADRs for trivial, easily-reversible changes. Rule of thumb: if someone would ask „why this way?" in six months, write one.

Mechanics: copy `docs/adr/_template.md` → `docs/adr/NNNN-short-title.md` (four-digit, monotonically increasing; never reuse a number), fill it in, add a row to the index table in `docs/adr/README.md`. Accepted ADRs are never rewritten — supersede with a new one and set the old status to „Felváltva: ADR-NNNN". Full convention: `docs/adr/README.md`.

## Testing / QA

Beyond the unit tests, two levels run against a live app. **Scorers** (`packages/core/src/mastra/scorers/`) grade every agent run automatically — Hungarian answer, catalog grounding, RAG citation, read-only path, plus a sampled LLM judge; results land in Postgres and in Studio's Scores tab.

`.claude/skills/flow-test/` — LLM-as-user conversation tests for the supervisor/package flow (HTTP + Playwright drivers). **Stale:** its 5 scenarios are still parameterised by the removed `router`/`delegate` modes; the skill needs updating to the single supervisor path. `.claude/skills/autotest/` — runs the Playwright difficulty-ladder **battery** (single→multi→complex→stress→trolling), evaluates the results into a self-contained HTML report with suggestions, asks which suggestions to implement, and logs the decision as an ADR.

## Reference docs

Domain and decisions live in `docs/`: `architektura.md` (structure + key decisions), `adr/` (architecture decision records — the decision log), `system-prompt.md` (source of the SQL rules), `konvenciok.md` (project-agnostic TS conventions applied here), `ddd/model.md` + `ddd/glossary.md` (domain model + ubiquitous language), `mcp.md` (the MCP entrypoint: data-tool vs. agent-as-tool, stdio pitfalls, host wiring), `stack.md`, `brs-plantbase.md`.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
