# 🌱 Plantbase

> Parancssori (CLI) AI agent, amely a természetes nyelvű kérdést **SQL-re fordítja** egy növény-katalógus (`products`) felett, **read-only** lefuttatja, és **természetes nyelvű választ** ad. Önkiszolgáló analitika SQL-tudás nélkül.

A persona egy **lakberendező**, aki a szobák adottságai (fény, méret), az ügyfél igényei és a büdzsé alapján állít össze növénycsomagot. Az adat megvan, de a kinyerése SQL-tudást igényelne — a Plantbase ezt automatizálja.

A projekt egy AI-agent kurzus kísérleti repója: a cél, hogy az agent mechanikája **az alapoktól, rétegről rétegre** látszódjon (echo → LLM → SQL-es tool), agent-framework nélkül.

---

## Hogyan működik?

```
felhasználó kérdése
        │
        ▼
   apps/cli  ──────────►  packages/core  (askAgent)
  (commander,             │
   readline)              │  1. system prompt (séma + szabályok, XML-tagolt)
                          │  2. Anthropic messages.create  ◄── kézzel írt
                          │  3. a modell SQL-t ír  ──► runSql tool       tool-use loop
                          │  4. SELECT-guard + READ-ONLY kapcsolat ──► Postgres (products)
                          │  5. sorok ──► a modell magyar választ ad
                          ▼
                 természetes nyelvű válasz  +  logs/<timestamp>.jsonl
```

A `packages/core` **framework-agnostic**: nem ismeri a belépési pontot (CLI/API/web). Az `askAgent` az Anthropic SDK fölé épülő, **kézzel írt, többlépéses tool-use loop** — szándékosan nincs agent-framework, hogy a mechanika látható maradjon.

---

## Háromrétegű read-only védelem (NFR1)

Az agent **soha nem módosítja az adatot**. Három, egymástól független réteg gondoskodik erről:

1. **DB-szerepkör** — a `runSql` a `plantbase_ro` (csak `SELECT`) szerepkörön fut, ami fizikailag sem tud írni.
2. **SELECT-guard** — a generált SQL-t a `core/sql-guard` ellenőrzi: csak `SELECT`/`WITH … SELECT`, egyetlen utasítás, kötelező `LIMIT`.
3. **Read-only tranzakció** — minden lekérdezés `START TRANSACTION READ ONLY`-ban fut.

A Prisma (séma, migráció, seed) ezzel szemben a **READ-WRITE** kapcsolatot használja — két DB-URL, két jog.

---

## Tech stack

| Réteg          | Eszköz                                                       |
| -------------- | ------------------------------------------------------------ |
| Monorepo       | Nx 23, pnpm workspaces, TypeScript (strict), Node LTS        |
| Agent          | `@anthropic-ai/sdk` (hivatalos kliens) + saját tool-use loop |
| Validáció      | Zod (rendszer-határokon)                                     |
| CLI            | commander + `node:readline`                                  |
| Adatbázis      | PostgreSQL 17 (docker-compose, OrbStack), `pg` (read-only)   |
| ORM / migráció | Prisma 6 (séma, migráció, seed)                              |
| Tooling        | Vitest, ESLint, Prettier, tsx                                |

---

## Projektstruktúra

```
.
├── apps/
│   └── cli/            # plantbase CLI: ask parancs + interaktív mód
├── packages/
│   ├── core/           # agent-logika (framework-agnostic)
│   │   └── src/lib/    # agent, config, system-prompt, sql-guard,
│   │                   # db-readonly, runsql-tool, logger, echo
│   └── db/             # Prisma lib: séma, migráció, generált kliens, seed
├── docs/               # BRS, architektúra, stack, konvenciók, system-prompt, terv
├── docker-compose.yml  # Postgres + read-only role (initdb)
└── .env.example        # két DB-kapcsolat (RW/RO) + Anthropic kulcs/model
```

---

## Előfeltételek

- Node LTS, **pnpm** (`corepack enable`)
- **Docker** (OrbStack a Postgreshez)
- `psql` (opcionális, kézi ellenőrzéshez)
- **Anthropic API-kulcs**

## Indulás

```bash
# 1. Függőségek (a postinstall lefuttatja a `prisma generate`-et)
pnpm install

# 2. Környezeti változók — másold és töltsd ki az ANTHROPIC_API_KEY-t
cp .env.example .env

# 3. Postgres indítása (a read-only role-t az initdb hozza létre)
docker compose up -d

# 4. Séma + kész seed (~30 növény) betöltése
pnpm db:migrate        # init_products migráció
pnpm db:seed           # idempotens: 30 növény
```

> A Postgres a **host 5433-as porton** fut (a 5432-t gyakran foglalja másik projekt) — lásd `docker-compose.yml` és `.env.example`.

## Használat

```bash
# Egyszeri kérdés
pnpm cli ask "mutass 3 pet-safe, alacsony fényigényű növényt raktáron, 5000 Ft alatt"

# Interaktív mód (több kérdés, 'exit'-ig)
pnpm cli ask

# A teljes system prompt + üzenet-tömb kiírása (átláthatóság)
pnpm cli ask --show-prompt "milyen pozsgásokat ajánlasz?"

# Súgó
pnpm cli --help
```

Minden interakció naplózva: `logs/<timestamp>.jsonl` (system prompt, üzenetek, **generált SQL**, eredmény, válasz, token-felhasználás).

A modell `.env`-ből állítható (`ANTHROPIC_MODEL`); költségérzékeny demóhoz pl. `claude-haiku-4-5`.

---

## Hasznos scriptek

| Script                    | Mit csinál                                      |
| ------------------------- | ----------------------------------------------- |
| `pnpm cli ask "…"`        | CLI buildelése + futtatása                      |
| `pnpm db:migrate`         | Prisma migráció (dev)                           |
| `pnpm db:seed`            | Seed betöltése (idempotens)                     |
| `pnpm db:studio`          | Prisma Studio                                   |
| `pnpm build`              | minden projekt buildje (`nx run-many -t build`) |
| `pnpm test`               | Vitest (unit tesztek)                           |
| `pnpm lint` / `typecheck` | ESLint / `tsc`                                  |
| `pnpm format`             | Prettier                                        |

---

## A három implementációs fázis

A működés rétegről rétegre épül (lásd `docs/proposal-implementacio.md`):

1. **CLI echo** — a CLI visszaírja a bemenetet (még nincs LLM, nincs DB).
2. **LLM, DB nélkül** — sima `messages.create`; adat-kérdésnél az agent **őszintén jelzi**, hogy nincs adatbázis-hozzáférése, és nem talál ki adatot.
3. **SQL-es interakció** — a `runSql` toollal a kérdésből SQL lesz, read-only lefut, és valós, természetes nyelvű választ kapsz.

---

## Dokumentáció

A részletek a [`docs/`](docs/) mappában:

- [`brs-plantbase.md`](docs/brs-plantbase.md) — üzleti követelmények (BRS), ROI, scope
- [`architektura.md`](docs/architektura.md) — fájlstruktúra és kulcsdöntések
- [`stack.md`](docs/stack.md) — tech stack és a `products` séma
- [`konvenciok.md`](docs/konvenciok.md) — kódkonvenciók, prompt-stílus
- [`system-prompt.md`](docs/system-prompt.md) — a termék-agent system promptja
- [`dev-workflow.md`](docs/dev-workflow.md) — git, hookok, dokumentáció
- [`proposal-implementacio.md`](docs/proposal-implementacio.md) — a fázisolt implementációs terv
