# Demó-útmutató — mi épült, hol, hogyan teszteld

**Dátum:** 2026-07-15 · **Hely:** `.claude/worktrees/baseline-proposal` worktree · **Push:** még nincs

## Branching

```
main (628bc43)
  └── demo/01-cleanup        (81bcb1c)  ← javítási kör + pnpm demo
        └── demo/02-alapfunkciok  (81e5d0e)  ← customers + threads + web
              └── demo/03-orchestrator (d307267)  ← multi-agent, ORCHESTRATION_MODE flaggel
```

Lineáris lánc: minden stage a előzőre épül, a diákok bármely stage-re checkoutolhatnak.
**Branch-váltás után mindig: `pnpm demo`** — port-kill (3001/4200), cache-tisztítás (nx, dist,
Vite), install, prisma generate, DB-migráció + seed, friss build, server+web indítás. Ez oldja
meg a „régi verzió fut a másik branchről" problémát.

---

## 1. fázis — `demo/01-cleanup`: a meglévő kód rendbetétele

**Mi történt:** viselkedés-semleges javítási kör (a review-doksi J0–J10 tételei) + a demó-indító
script. Egyetlen logikai változás: az admin-szerep újra él.

| Fájl | Mi történt |
|---|---|
| `packages/core/.../query-agent/query-agent.ts` | **MÓDOSÍTÁS (logika!):** a hardcode-olt `admin=false` holtág feloldva — exportált `buildQueryToolset(role)`; admin újra megkapja a `delegateToIngest` toolt; prompt és toolset ugyanabból a role-ból épül |
| `packages/core/.../query-agent/query-agent.spec.ts` | **ÚJ teszt:** a toolset role-függő összetételét ellenőrzi |
| `packages/core/src/lib/echo.ts` + `echo.spec.ts` | **TÖRÖLVE:** halott kód (a B2 óta senki nem hívta) |
| `packages/core/src/lib/ansi.ts` | **ÚJ:** közös terminál-szín helper (a trace-ből kiemelve) |
| `packages/core/src/lib/trace.ts`, `rag/retrieve.ts` | **MÓDOSÍTÁS:** mindkettő a közös `c` helpert használja (a retrieve nyers `\x1b` escape-jei kigyomlálva) |
| `packages/core/src/lib/rag/chunk.ts` | **MÓDOSÍTÁS:** komment-javítás (nem létező fájlra hivatkozott) |
| `apps/server/src/main.ts` | **MÓDOSÍTÁS:** elavult fejléckomment átírva a tool-stream valóságra |
| `apps/cli/src/ingest-knowledge.ts` | **MÓDOSÍTÁS:** rossz port a súgóban (3000 → 3001) |
| `apps/web/src/App.tsx` + `lib/message-parts.ts` (ÚJ) | **REFAKTOR:** a render-blokk szétválogatása `splitAssistantParts()` segédbe, castok és debug `console.log` ki |
| `.gitignore` + törölt gyökér-fájlok | **TAKARÍTÁS:** összeragadt ignore-sor kettébontva; `.playwright-mcp/`, `embed-demo.json`, `postman/`, `railpack.*.json` trackelése megszüntetve |
| `README.md`, `docs/architektura.md`, `docs/stack.md`, `seed/README.md` | **DOKSI-SZINKRON:** Vercel AI SDK 6 az igazság (a „kézzel írt Anthropic-loop" történetté fokozva); RAG + server/web átvezetve; scripts-tábla pótolva; seed/ „starter kit" jelölés |
| `scripts/demo.sh` + `package.json` | **ÚJ:** `pnpm demo` — friss-indító script (lásd fent) |

---

## 2. fázis — `demo/02-alapfunkciok`: ügyfelek + thread-perzisztencia

**Mi történt:** a demó alaprétege — élő ügyfél-adatbázis és DB-ben tárolt beszélgetések.

| Fájl | Mi történt |
|---|---|
| `packages/db/prisma/schema.prisma` | **MÓDOSÍTÁS:** 3 új modell: `Customer`, `Thread`, `Message` (parts JSON — a tool-kártyák is visszatölthetők) |
| `packages/db/prisma/migrations/...customers`, `...threads_messages`, `...ro_grants` | **ÚJ migrációk;** a `ro_grants` a smoke-tesztben talált bug javítása: a read-only szerep jogai reset-állóan a migrációban élnek |
| `packages/db/prisma/customers.ts` + `seed.ts` | **ÚJ seed:** 20 kézzel írt, életszerű ügyfél (15e–800e Ft keret, pet/kid-safe profilok, döntést befolyásoló notes); upsert kóddal = idempotens |
| `packages/db/package.json` + `packages/core/.../tools/prisma-client.ts` (ÚJ) | **ÚJ infra:** a `@plantbase/db` importálható lett; lazy közös Prisma-kliens a tool-rétegnek (a `runSql` tudatosan NEM ezt használja) |
| `packages/core/.../tools/query-customers/` (ÚJ, 2 fájl) | **ÚJ TOOL:** `queryCustomers` — kód/név/típus szerinti ügyfél-lekérdezés Prismán; a fix térképes `getClientPreferences`-t **kivezette** (törölve) |
| `packages/core/.../query-agent.ts` + `query-prompt.ts` | **MÓDOSÍTÁS:** toolset- és prompt-csere az új toolra |
| `apps/server/src/threads.ts` (ÚJ) + `threads.spec.ts` (ÚJ) | **ÚJ API:** `GET /api/threads` (lista), `GET /api/threads/:id` (előzmény UIMessage-ként); tiszta helperek (clipTitle, rowToUIMessage, stripDataParts, dropTrailingUserRow) tesztekkel |
| `apps/server/src/main.ts` | **ÁTÍRÁS:** a chat-handler perzisztál — a kliens csak az ÚJ üzenetet küldi, az előzmény a DB-ből épül; új threadnél `data-thread` part streamel vissza; mentés `onFinish`-ben; hibavédelem |
| `apps/server/vitest.config.mts` + tsconfig-ok | **ÚJ teszt-infra** a szerver-appnak |
| `apps/web/src/App.tsx` | **MÓDOSÍTÁS:** `?thread=<id>` URL-betöltés, csak-új-üzenet felküldés, `data-thread` → URL-frissítés |
| `apps/web/src/components/thread-list.tsx` (ÚJ) | **ÚJ komponens:** korábbi beszélgetések a chat alatt + „Új beszélgetés" gomb |
| `docs/ddd/glossary.md`, `model.md` | **DOKSI-SZINKRON** az új ügyfél-fogalmakra |
| `docs/demo/agent-topologiak.html` (ÚJ) | **ÚJ vetíthető ábra:** 3 topológia (master–slave / mesh / orchestrator), lépésenként kattintható |

---

## 3. fázis — `demo/03-orchestrator`: multi-agent, flaggel kapcsolva

**Mi történt:** orchestrator + csomag-agent + 6 új tool + látható handover a UI-ban + tesztelő
skill. **`ORCHESTRATION_MODE=off` (default) esetén az app bájtra úgy viselkedik, mint a 2. fázis.**

| Fájl | Mi történt |
|---|---|
| `packages/core/.../agents/orchestrator-agent/` (ÚJ, 8 fájl) | **ÚJ AGENT:** `orchestrator-agent.ts` (belépési pont, sosem válaszol a usernek), `orchestrator-prompt.ts`, `router-handover.ts` (az orchestrator közvetít, látható for-ciklus, max 3 ugrás), `delegate-handover.ts` (agent hív agentet toolként), `find-last-flow-signal.ts` (flow-lock tool-eseményekből, tiszta függvény), `orchestration-mode.ts` (off/router/delegate) + spec-ek |
| `packages/core/.../agents/package-agent/` (ÚJ, 3 fájl) | **ÚJ AGENT:** csomag-összeállító — irányított kérdések, előtöltött ügyfél-preferenciák, összesítő + „Ez így rendben van?" megerősítés, mentés csak utána; mód-függő kapocs-tool |
| `packages/core/.../tools/route-to/`, `request-info/`, `cancel-package/` (ÚJ) | **ÚJ jelző-toolok:** routing-döntés, adat-kérés (router-mód, ÜRES execute), lemondás — minden agent-közti jelzés tool-hívás, nincs szöveg-parse |
| `packages/core/.../tools/validate-package/` (ÚJ, 4 fájl) | **ÚJ kapu-tool:** determinisztikus Prisma-validálás (készlet, pet/kid-safe, difficulty≤szint, **budget kemény korlát**); sikeres kimenete a strukturált csomagterv (`data-package` forrása) |
| `packages/core/.../tools/save-package/` (ÚJ) | **ÚJ kapu-tool:** mentés ELŐTT újra-validál (ugyanaz a validátor), tranzakciós írás |
| `packages/core/.../tools/ask-info-agent/` (ÚJ) | **ÚJ kapocs-tool** (delegate mód): a tool execute-ja MAGA futtatja az info-agent loopját |
| `packages/core/.../agents/agent-loop.ts` + spec | **MÓDOSÍTÁS (opt-in):** `onToolEvent` hook — a tool-események kicsatornázása a szervernek; hook nélkül változatlan viselkedés |
| `packages/db/prisma/schema.prisma` + `...packages_package_items` migráció | **ÚJ táblák:** `packages` (FK a customers-re) + `package_items` |
| `packages/db/prisma/seed.ts` | **FIX:** a reseed előbb a csomag-sorokat törli (FK) — a `pnpm demo` találta meg élesben |
| `apps/server/src/chat-stream.ts` (ÚJ) + `main.ts` | **ÚJ réteg:** mód-választó — off = a mai út érintetlenül; router/delegate = orchestrált stream `data-agent` / `data-tool` / `data-package` partokkal (az orchestrator `routeTo` döntése is látszik) |
| `apps/web/src/components/agent-chips.tsx` (ÚJ), `package-summary.tsx` (ÚJ), `App.tsx`, `message-parts.ts` | **ÚJ UI:** agent-badge (🌱 Info / 📦 Csomag), routing-chip, tool-chipek; csomag-összesítő kártya („Rendben, mentsd" / „Módosítanék" gombok — csak chat-üzenetet küldenek); off-módban semmi új nem renderelődik |
| `.claude/skills/flow-test/` (ÚJ, 11 fájl) | **ÚJ SKILL:** LLM-as-user tesztelés — 5 forgatókönyv (happy path, lemondás, visszalépés, kitörési kísérlet, adat-routing), http + Playwright runner, log-alapú értékelő javaslatokkal, módonkénti összevető riport |
| `.env.example`, `CLAUDE.md`, `docs/architektura.md` | **DOKSI:** `ORCHESTRATION_MODE` + a két handover-mód leírása |

---

## Hogyan teszteld — lépésről lépésre

### 0. Egyszeri előkészület
```bash
cd .claude/worktrees/baseline-proposal   # (vagy ahová a branchek kerülnek)
# .env kell: ANTHROPIC_API_KEY + DB URL-ek (a meglévő .env-ed jó)
```

### 1. fázis ellenőrzése
```bash
git checkout demo/01-cleanup && pnpm demo
# külön terminálban:
pnpm cli ask "mutass 3 pet-safe növényt raktáron"
```
- A trace-ben `tools: [runSql, searchKnowledge, getClientPreferences]`.
- Admin-demó: `user-role.ts`-ben `CURRENT_ROLE: 'admin'` → a trace-ben megjelenik a `delegateToIngest`.

### 2. fázis ellenőrzése
```bash
git checkout demo/02-alapfunkciok && pnpm demo
```
Böngésző: http://localhost:4200
1. Kérdés: „mit ajánlanál a Kiss családnak 30 ezer forintból?" → a tool-kártyák közt `queryCustomers` fut, a válasz a macskás/kisgyerekes profilhoz igazodik.
2. Az URL `?thread=<id>`-re vált → **F5** → az előzmény tool-kártyákkal együtt visszajön.
3. A chat alatt „Korábbi beszélgetések" lista; „Új beszélgetés" gomb üres chatet ad.

### 3. fázis ellenőrzése
```bash
git checkout demo/03-orchestrator && pnpm demo
```
1. **off mód** (default): minden pont úgy néz ki, mint a 2. fázisban — ez a „mielőtt".
2. `.env`: `ORCHESTRATION_MODE=router` → szerver újraindítás (Ctrl+C, `pnpm demo` v. `pnpm server`+`pnpm web`):
   - „Állíts össze csomagot az ACME-nek" → routing-chip (🎯 routeTo → csomag-agent), 📦 badge, irányított kérdések egyesével;
   - próbálj kitörni („mesélj a monsterről") → visszaterel, a lock tart;
   - a kérdések végén összesítő kártya + „Ez így rendben van?" → „Rendben, mentsd" → mentés + záró visszajelzés;
   - szűk keretű ügyféllel (pl. ACME, 15 000 Ft) kérj sokat → a `validatePackage` chip hibát mutat, az agent visszalép.
3. `ORCHESTRATION_MODE=delegate` → ugyanez a flow, de a trace-ben/chipekben az `askInfoAgent` beágyazott futása látszik (orchestrator csak az elején irányít).
4. **Automata teszt (skill):**
```bash
npx tsx --env-file=.env .claude/skills/flow-test/scripts/run-scenario-http.ts scenarios/01-happy-path.md
npx tsx --env-file=.env .claude/skills/flow-test/scripts/evaluate.ts   # értékelés + javaslatok
```
5. **Topológia-ábra vetítéshez:** `open docs/demo/agent-topologiak.html` (3 nézet, ←/→ léptetés).

### Teljes kapu (bármikor)
```bash
pnpm build && pnpm test && pnpm lint && pnpm typecheck
```

## Ismert apróságok
- A reseed (`pnpm demo` / `pnpm db:reset`) a mentett csomagokat is törli (FK miatt) — demó előtt mentett „mutatvány-csomag" nem éli túl.
- A modell néha „szimulált tool-hívásról" szabadkozik, mielőtt korrigál — a determinisztikus kapuk így is fogják; prompt-finomítási javaslatok az evaluate riportjában.
- A worktree és a fő checkout ugyanazt a dev DB-t használja (5433) — a migrációk additívak, de a reseed közös.
