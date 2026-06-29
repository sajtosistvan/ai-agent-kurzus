# Plantbase — implementációs terv (proposal)

> Forrás: `brs-plantbase.md`, `architektura.md`, `stack.md`, `konvenciok.md`, `dev-workflow.md`, `system-prompt.md`.
> A terv két nagy részből áll: **A) a környezet létrehozása** (mérföldkő: kész, futó, tesztelhető projekt) és **B) az implementáció 3 fázisa** (echo → LLM DB nélkül → SQL-es agent).
> Minden fázis kicsi, önállóan tesztelhető increment. A fázis végén **te tesztelsz**, majd egy **commit** zárja (Conventional Commits, feature branch — lásd `dev-workflow.md`).

---

## Alapelvek (minden fázisra érvényes)

- **Context7 először.** Minden kódolási lépés előtt a releváns library doksit (Nx, Prisma, `@anthropic-ai/sdk`, commander, Zod, Vitest) Context7-tel beolvassuk, csak utána kódolunk (`architektura.md` 7. pont).
- **Framework-agnostic core.** A `packages/core` nem ismeri a CLI-t/API-t/webet (`architektura.md` 1. pont).
- **Saját agent-loop.** Az `askAgent` kézzel írt tool-use loop az `@anthropic-ai/sdk` `messages.create` fölött — **nem** a SDK `toolRunner` helperje és **nem** agent-framework, hogy a mechanika látható maradjon (`architektura.md` 3. pont).
- **Két DB-kapcsolat, két jog.** Prisma a READ-WRITE kapcsolaton (`DATABASE_URL`) viszi a sémát/migrációt/seedet; az agent `runSql`-je READ-ONLY kapcsolaton (`DATABASE_URL_READONLY`) fut, csak SELECT (`architektura.md` 2. pont, NFR1).
- **Átláthatóság.** Minden interakció JSONL-be naplózva; `--show-prompt` a teljes promptot kiírja (FR4/FR5).
- **Konvenciók.** TS strict, `unknown` a külső inputra, immutabilitás, Zod a határokon, kis fókuszált fájlok, nincs `console.log` a termékkódban → strukturált logger (`konvenciok.md`).
- **TDD ahol értelmes.** Tiszta egységek (SQL-guard, logger, schema-context) teszttel; cél 80%+ (`konvenciok.md`, `testing`).

## Megerősítendő feltételezések (döntések)

Nem blokkoló kérdések; ha másként szeretnéd, szólj a megfelelő fázis előtt:

1. **Termék-agent modellje:** alapból egy aktuális, stabil Claude modell (pl. `claude-sonnet-4-6`), `.env`-ből felülírhatóan (`ANTHROPIC_MODEL`). Költségérzékeny demóhoz `claude-haiku-4-5` is állítható.
2. **READ-ONLY jog megvalósítása:** a docker-compose Postgres init-SQL-jében külön `plantbase_ro` role-t hozunk létre (csak `SELECT` a `products`-on); a `DATABASE_URL_READONLY` ehhez csatlakozik. (Védelmi réteg = DB-jog, nem hook — `dev-workflow.md`.)
3. **Naplózás és `--show-prompt` belépése:** a 2. fázisban vezetjük be (LLM-hívás), a 3. fázisban bővítjük a generált SQL-lel és az eredménnyel.
4. **Prisma kliens kimenete:** a `packages/db` libbe generálva, onnan importál a core és a seed (a séma az Nx graph része — `architektura.md` 6. pont).

---

# A) A KÖRNYEZET LÉTREHOZÁSA

> **Mérföldkő:** a projekt felépül, a Postgres fut, a séma migrálva, a kész seed betöltve (~30 növény), és egy üres CLI elindul. Innentől minden fázis erre épül.

### A1 — Nx monorepo + tooling váz

- `create-nx-workspace` (TS monorepo template, pnpm), `packages/*` + `apps/*` a `pnpm-workspace.yaml`-ban.
- TypeScript **strict**, ESLint + Prettier, Vitest, `tsx`. `.gitignore`, `.env.example`. Git init, `main` + `feat/*` branch-stratégia.
- **Tesztelés (te):** `pnpm nx report` és `pnpm nx graph` fut; `pnpm prettier --check .` és lint zöld.
- **Commit:** `chore: scaffold nx workspace and tooling`

### A2 — `packages/core` és `apps/cli` váz (üres)

- `nx g @nx/js:lib core --directory=packages/core --bundler=tsc` (framework-agnostic mag).
- `nx g @nx/node:app cli --directory=apps/cli` (CLI belépési pont, egyelőre üres `main.ts`).
- Smoke-teszt mindkét projektben (egy triviális Vitest).
- **Tesztelés (te):** `pnpm nx build core`, `pnpm nx run cli:build`, `pnpm nx test core` zöld.
- **Commit:** `chore: add core lib and cli app skeletons`

### A3 — Lokális Postgres (docker-compose, OrbStack) + két kapcsolat

- `docker-compose.yml`: Postgres szolgáltatás, named volume. Init-SQL: `plantbase` (RW, Prisma) és `plantbase_ro` (RO, csak SELECT) role-ok.
- `.env`: `DATABASE_URL` (RW) és `DATABASE_URL_READONLY` (RO). `.env.example` frissítve.
- **Tesztelés (te):** `docker compose up -d` után `psql "$DATABASE_URL" -c '\conninfo'` és a RO kapcsolat is csatlakozik.
- **Commit:** `chore: add postgres docker-compose with rw and read-only roles`

### A4 — `packages/db` Prisma lib (products séma + migráció)

- **Context7:** Prisma schema, `migrate dev`, snake_case `@map`, kliens-output beolvasása.
- `packages/db` lib; `prisma/schema.prisma` a `products` modellel a `stack.md` szerint (mezőnevek snake_case `@map`-pel, a Prisma modell `Product`). Kliens a libbe generálva.
- `prisma migrate dev --name init_products` → `products` tábla létrejön.
- **Tesztelés (te):** `psql "$DATABASE_URL" -c '\d products'` mutatja az oszlopokat; `prisma migrate status` clean.
- **Commit:** `feat: add prisma db lib with products schema and initial migration`

### A5 — Kész seed betöltése (NEM generáljuk újra)

- A meglévő `seed/plants.ts` + `seed/seed.ts` bemásolása `packages/db/prisma/`-ba (a `seed/README.md` szerint), `package.json` `prisma.seed` bekötése (`tsx ...seed.ts`).
- `prisma db seed` (idempotens: töröl, majd betölt ~30 növényt).
- **Tesztelés (te):** `psql "$DATABASE_URL" -c 'select count(*) from products;'` → 30; pár soros mintalekérdezés értelmes adatot ad.
- **Commit:** `feat: load prebuilt plant catalog seed`

### A6 — Üres CLI elindul (LLM és DB nélkül)

- `apps/cli`: commander program `plantbase` névvel, regisztrált `ask` parancs + `--help`/`--version`. Egyelőre placeholder (pl. „nincs implementálva"), nincs LLM, nincs DB.
- **Tesztelés (te):** `pnpm nx run cli:serve -- --help` (vagy a buildelt bin) kiírja a használatot és tisztán kilép.
- **Commit:** `feat: bootstrap empty plantbase cli entrypoint`

**→ Mérföldkő kész: a környezet fut és tesztelhető.**

---

# B) AZ IMPLEMENTÁCIÓ — 3 FÁZIS

> Rétegről rétegre: előbb a CLI-mechanika (echo), majd az LLM (DB nélkül), végül az SQL-es tool. Mindegyik fázis előtt Context7, után a TE teszted, majd commit.

## 1. fázis — CLI visszhang (echo), LLM nélkül

**Cél:** a CLI-n keresztül interaktálsz, a program visszaírja, amit beírtál. Még nincs LLM, nincs DB.

- **Context7:** commander (parancsok/opciók) + `node:readline` interaktív mód.
- `plantbase ask "<kérdés>"` → visszhangozza a szöveget; argumentum nélkül **interaktív readline mód** (`exit`-ig), minden sort visszaír (`echo: <amit beírtál>`).
- Az echo-logika tiszta függvény a `packages/core`-ban (pl. `echo(input: string): string`), a CLI csak az I/O — így egységgel tesztelhető (TDD: piros→zöld).
- **Tesztelés (te):** `plantbase ask "szia"` → `echo: szia`; interaktív módban több sor visszhangzik, `exit` kilép.
- **Commit:** `feat: cli echo loop (single-shot and interactive)`

## 2. fázis — LLM, adatbázis nélkül

**Cél:** a CLI egy sima LLM-hívásba van kötve. Az agent válaszol, de **nincs DB-hozzáférése**: adatra vonatkozó kérdésnél őszintén jelzi, hogy nem fér hozzá az adatbázishoz, és nem tud válaszolni.

- **Context7:** `@anthropic-ai/sdk` — `messages.create`, system prompt, `model`/`max_tokens`, `usage`.
- `packages/core`: `askAgent(question)` egyetlen `messages.create` hívással, **tool nélkül**. System prompt a `system-prompt.md` alapján, de **kifejezett megkötéssel**: „nincs adatbázis-hozzáférésed; ha az adatra (katalógusra) vonatkozó kérdés jön, közöld őszintén, hogy nem férsz hozzá az adatbázishoz, és ne találj ki adatot."
- `ANTHROPIC_API_KEY` és `ANTHROPIC_MODEL` `.env`-ből (Zod-validált config, fail-fast indításkor). XML-szerűen tagolt prompt (`konvenciok.md`).
- **Naplózás bevezetése:** `logs/<timestamp>.jsonl` — system prompt, üzenetek, válasz, token-felhasználás. `--show-prompt` kiírja a teljes üzenet-tömböt.
- A CLI ugyanaz (single-shot + interaktív), csak már `askAgent`-et hív echo helyett.
- **Tesztelés (te):**
  - Általános kérdés (pl. „mitől függ egy növény fényigénye?") → értelmes válasz.
  - Adat-kérdés (pl. „hány pozsgás van raktáron?") → őszintén jelzi, hogy nincs DB-hozzáférése, nem talál ki számot.
  - `logs/` JSONL keletkezik; `--show-prompt` kiírja a promptot.
- **Commit:** `feat: wire cli to llm (no db) with jsonl logging and --show-prompt`

## 3. fázis — SQL-es interakció (runSql tool)

**Cél:** bekötjük a `runSql` toolt. Az agent a kérdésből SQL-t ír, READ-ONLY lefuttatja a katalóguson, és valós, természetes nyelvű választ ad.

- **Context7:** `@anthropic-ai/sdk` tool use (`tools`, `tool_use`/`tool_result` blokkok, `stop_reason: "tool_use"`); Zod (tool-input validáció); a RO Postgres-kapcsolat kliense.
- `packages/core`:
  - **`runSql(query)` tool** — READ-ONLY kapcsolat (`DATABASE_URL_READONLY`). Védelmi rétegek: csak `SELECT` (guard: tiltjuk az INSERT/UPDATE/DELETE/DDL-t), kötelező/auto `LIMIT`, paraméterezett/escapelt futtatás, Zod-validált input. A jog a DB-role-ból is jön (kettős védelem, NFR1).
  - **schema-context** — a `products` séma + szabályok a modellnek (a `system-prompt.md` `<schema>`/`<rules>`/`<behavior>` tartalma).
  - **kézzel írt tool-use loop** — `messages.create` ciklus: amíg `stop_reason === "tool_use"`, lefuttatja a `runSql`-t, `tool_result`-ot visszaad, újra hív; a végén természetes nyelvű válasz. Multistep (FR2).
  - Naplózás bővítése: generált SQL + eredmény + tool-lépések a JSONL-be.
- A SELECT-only guard és a schema-context tiszta, egységgel tesztelhető (TDD).
- **Tesztelés (te):** Demo-flow (siker-kritérium): élő kérdés → helyes SQL → helyes válasz, pl.:
  - „Mutass 3 pet-safe, alacsony fényigényű növényt raktáron, 5000 Ft alatt." → helyes szűrés, `COALESCE(sale_price, price)`, `stock > 0`, `LIMIT`.
  - Próba: módosító kérdés (pl. „töröld a…") → az agent nem módosít (csak SELECT, RO kapcsolat is tiltja).
- **Commit:** `feat: add read-only runSql tool and hand-written tool-use loop`

**→ v1 kész:** természetes nyelvű kérdés → helyes SQL → helyes válasz, naplózva, read-only, `--show-prompt`-tal átlátható (BRS 5. sikerkritériumok).

---

## Fázis-összefoglaló (mérföldkövek és commitok)

| #   | Fázis                  | Eredmény                                    | Commit (típus) |
| --- | ---------------------- | ------------------------------------------- | -------------- |
| A1  | Nx + tooling           | workspace, lint/teszt fut                   | `chore`        |
| A2  | core + cli váz         | buildelhető skeletonok                      | `chore`        |
| A3  | Postgres + 2 kapcsolat | RW/RO role-ok, `.env`                       | `chore`        |
| A4  | Prisma db lib          | `products` séma + migráció                  | `feat`         |
| A5  | Seed betöltés          | ~30 növény az adatbázisban                  | `feat`         |
| A6  | Üres CLI               | `plantbase --help` fut                      | `feat`         |
| B1  | CLI echo               | visszhang single-shot + interaktív          | `feat`         |
| B2  | LLM, DB nélkül         | válaszol; adat-kérdésnél őszinte „nincs DB" | `feat`         |
| B3  | runSql tool            | NL → SQL → NL válasz, read-only             | `feat`         |

Minden sor végén: **te tesztelsz → ha zöld, commitolunk.**
