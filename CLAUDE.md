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
pnpm nx test @plantbase/core -- run src/lib/tools/sql-guard.spec.ts
pnpm nx test @plantbase/core -- -t "rejects non-SELECT"

# Run the CLI in DEV (runs TypeScript source directly, no build — see source condition below)
pnpm cli ask "mutass 3 pet-safe növényt raktáron, 5000 Ft alatt"
pnpm cli ask                 # interactive query mode
pnpm cli ingest "..."        # catalog-editor agent (writes!); no args → interactive
pnpm cli ask --quiet "..."   # only the final answer, no live trace

# Database (Prisma, read-write connection)
docker compose up -d         # Postgres on host port 5433 (NOT 5432)
pnpm db:migrate              # prisma migrate dev
pnpm db:seed                 # idempotent ~30-plant seed
pnpm db:reset                # drop + migrate + seed
pnpm db:studio               # Prisma Studio (localhost:5555)
```

First-time setup: `pnpm install` (postinstall runs `prisma generate`) → `cp .env.example .env` and fill `ANTHROPIC_API_KEY` → `docker compose up -d` → `pnpm db:migrate && pnpm db:seed`.

## Architecture

Nx monorepo, three projects: **`apps/cli`** (`@plantbase/cli`, commander + readline entrypoint), **`packages/core`** (`@plantbase/core`, framework-agnostic agent logic), **`packages/db`** (`@plantbase/db`, Prisma schema/migrations/seed + generated client).

`packages/core` is **framework-agnostic**: it does not know its entrypoint (CLI/API/web). There is deliberately **no agent framework** so the mechanics stay legible.

### Two agents, one loop (`packages/core/src/lib/agents/`)

**One agent = prompt + tools + loop.** The shared loop lives in **`agents/agent-loop.ts`** (`runAgentLoop`): Vercel AI SDK 6 `generateText` + `stopWhen: stepCountIs(n)`, with the transparent per-step trace wired via `prepareStep`/`onStepFinish` (see `trace.ts`; live console + `logs/<ts>.json` + `logs/agent.log`). The loop was originally hand-written over the raw Anthropic SDK; the SDK now runs the same prompt→tool-call→tool-result→repeat cycle. Each agent file is a thin definition (~40 lines): its prompt, its toolset, its limits.

- **Query agent** — `askAgent` (`agents/query-agent.ts`), prompt `buildQueryPrompt` (`agents/query-prompt.ts`). NL → SQL → read-only `runSql` → Hungarian answer. Tools: `runSql`, `getClientPreferences`.
- **Ingest agent** — `askIngestAgent` (`agents/ingest-agent.ts`), prompt `buildIngestPrompt` (`agents/ingest-prompt.ts`). Conversationally edits the catalog. Tools: `fetchFeed` (live Shopify `products.json` from tropicalhome.hu / thesill.com), `runSql` (read current state), `upsertProduct` (the **only** in-app write path).

### Tool layer (`packages/core/src/lib/tools/`)

**One tool = one file**, containing everything: the model-facing description, the permissive AI SDK `tool()` schema (type + describe), the **strict boundary validation** (Zod) in the `execute*` function, and the `<name>Tool(report)` factory. `execute*` functions **never throw** — they return a `ToolOutcome` (`content` string, `isError`, `summary`, `rowCount`; see `tool-outcome.ts`), so even bad LLM input comes back as our own Hungarian error text, not an SDK exception. The `report` callback is the side-channel that feeds the full outcome to the `Trace` (the model only sees `content`). **Adding a tool = one new file + one line in the agent's toolset** (`buildTools` in the agent file). Supporting non-tool modules are named by function: `sql-guard.ts`, `db-readonly.ts`, `db-readwrite.ts`, `shopify-feed.ts` (the feed client behind `fetch-feed.ts`), `product-schema.ts`.

### Read/write separation (NFR1) — the core safety design

The query path can **never** write. Three independent layers enforce it: (1) the `plantbase_ro` Postgres role (SELECT-only), (2) `sql-guard.ts` (only `SELECT`/`WITH … SELECT`, single statement, mandatory `LIMIT`), (3) every query runs inside `START TRANSACTION READ ONLY` (`db-readonly.ts`).

Writes happen only via Prisma (migrations/seed) and the ingest agent's `upsertProduct`, which runs on a **separate read-write pg pool** (`db-readwrite.ts`) — strictly Zod-validated (`product-schema.ts`) and parameterized, keyed on `latin_name` for idempotent upsert. The agent cannot run raw write SQL.

This maps to **two DB URLs / two roles**: `DATABASE_URL` (read-write: Prisma + ingest upsert) and `DATABASE_URL_READONLY` (query agent `runSql`). Note the agent does **not** query through Prisma — `runSql` uses a direct `pg` read-only connection; Prisma is only schema/migration/seed/studio and the generated client (`packages/db/generated/client`).

### Config boundary

`config.ts` validates env with Zod (fail-fast): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_URL_READONLY`. The read-write `DATABASE_URL` is validated **locally in `db-readwrite.ts`** (deliberately kept out of shared config so the query agent doesn't require it).

### Dev vs. build resolution (source condition)

`@plantbase/core`'s `exports` map defines a `@plantbase/source` condition → `./src/index.ts`. `pnpm cli` runs `tsx --conditions=@plantbase/source`, so the CLI executes **TypeScript source directly with no build** — edits to `core` take effect immediately. Tests and `nx build` use the compiled `./dist`, so run a build/typecheck to catch what the source path won't.

### Prompts

The **product's** prompts to the LLM (`prompts.ts`, `ingest-prompts.ts`) are XML-tagged (`<role>`, `<schema>`, `<rules>`, `<tools>`, …) to reduce hallucination. This applies only to prompts the product sends the model, not to developer-facing prompts. The two agents have separate prompt files.

### Feed ingest details

`shopify-feed.ts` fetches paginated Shopify `products.json`, filters out non-plants, extracts the botanical (latin) name as the natural key, converts non-HUF prices at fixed rates (**USD=310, EUR=350**), and dedups by latin name. The agent then fills the Hungarian name/description and inferred care fields before writing via `upsertProduct`. The standalone `.claude/skills/product-ingest/` skill implements the same pipeline as scripts for bulk use outside the app.

## Reference docs

Domain and decisions live in `docs/`: `architektura.md` (structure + key decisions), `system-prompt.md` (source of the SQL rules), `konvenciok.md` (project-agnostic TS conventions applied here), `ddd/model.md` + `ddd/glossary.md` (domain model + ubiquitous language), `stack.md`, `brs-plantbase.md`.

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
