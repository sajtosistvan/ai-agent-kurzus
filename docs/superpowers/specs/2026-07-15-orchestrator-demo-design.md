# Orchestrator multi-agent demó — design

**Dátum:** 2026-07-15 · **Státusz:** jóváhagyásra vár · **Cél óra:** orchestrator / agent-handover demó

## 1. Cél és kontextus

Órai demó, amely két agent közötti **handovert** mutat be kétféle megközelítésben, egyetlen
kapcsolóval váltva, a web UI-ban látható trace-szel:

1. **`router` mód** — egy orchestrator minden körben eldönti, melyik agent kapja a labdát; az
   agentek nem tudnak egymásról.
2. **`delegate` mód** — az agentek egymást hívják toolként (a meglévő `delegateToIngest` minta
   általánosítása).

A demó a meglévő Plantbase repóra épül (`packages/core` agent-loop, tool-konvenciók, trace).

## 2. Szereplők

| Szereplő | Hely | Toolok | Szerep |
|---|---|---|---|
| **Orchestrator** | `agents/orchestrator-agent/` | `routeTo` | **Soha nem válaszol a felhasználónak.** Nem-streamelő routing-lépés: üzenet + előzmény alapján dönt, melyik agent dolgozik. |
| **Info-agent** | a meglévő **query agent** | `runSql`, `queryCustomers`, `searchKnowledge` (bekötendő, ha hiányzik) | Adatot szolgáltat: katalógus (SQL) + tudásbázis (RAG). Változatlan, csak toolset-bővítés. |
| **Csomag-agent** | `agents/package-agent/` | `queryCustomers`, `validatePackage`, `savePackage`, `cancelPackage`, + módfüggő kapocs: `requestInfo` (router) VAGY `askInfoAgent` (delegate) | 4-5 irányított kérdéssel ügyfél-csomagot állít össze. **Nincs saját `runSql`-je** — adatot az info-agenttől kér. |

Konvenciók: egy agent = saját mappa (`*-agent.ts` + `*-prompt.ts`), egy tool = saját mappa,
`ToolOutcome`, never-throw execute, magyar hibaszövegek, XML-tagelt promptok.

## 3. A két orchestration-mód

**Kapcsoló:** `ORCHESTRATION_MODE=router | delegate` env. Egy belépési pont
(`orchestrator-agent.ts`) választ a két, **külön fájlban tisztán szeparált** implementáció közül:
`router-mode.ts` és `delegate-mode.ts`.

Mindkét módban az orchestrator a belépési pont: minden felhasználói üzenetnél lefut (gyors,
olcsó hívás, akár kisebb modellel), a `routeTo(agent, reason)` toollal dönt, és a kiválasztott
agent streameli a választ. A **flow-lock** is közös: amíg a csomag-agent nem adott strukturált
záró jelzést (lásd 4.4), az orchestrator minden üzenetet hozzá irányít — akkor is, ha a
felhasználó másról kezd beszélni (a visszaterelés hangneme a csomag-agent promptjának dolga; a
bentartás maga kód). A lock állapota **nem session-store**: az orchestrator az üzenet-előzményből
olvassa ki az utolsó záró jelzést (a szerver stateless marad).

**Minden agent-közti jelzés tool-hívás, soha nem a válasz-szöveg parse-olása.** (Szöveges
JSON-jelzés törékeny és táblánál követhetetlen; a tool-hívás a repo filozófiája is.)

**A két mód abban különbözik, hogyan jut adathoz a csomag-agent** — és a kontraszt egy mondat:
*ugyanaz a tool-felület, csak az execute más.*

### 3.1 `router` mód — az orchestrator közvetít

- A csomag-agent a **`requestInfo`** toolt kapja. Az execute itt ÜRES: csak rögzíti a kérdést
  („kérés továbbítva az info-agentnek"), és az agent köre lezárul.
- Az orchestrator-réteg (`router-handover.ts`) látja a rögzített kérést, meghívja az
  info-agentet, és a válaszát visszaadva folytatja a csomag-agent körét. A labdamenet egy
  **látható, sima `for` ciklus** (max 3 ugrás egy felhasználói körön belül), nem rejtett
  rekurzió; minden ugrás látszik a trace-ben.
- Az agentek nem tudnak egymásról — csak az orchestrator ismeri mindkettőt.

### 3.2 `delegate` mód — az agentek egymást hívják

- A csomag-agent az **`askInfoAgent`** toolt kapja (a `delegateToIngest` mintájára): az execute
  itt MAGA futtatja az info-agent saját loopját, és annak összegzését adja vissza — az
  adat-kérés nem hagyja el a csomag-agent körét.
- Az orchestrator szerepe itt a per-üzenet routingra és a flow-lockra szűkül; adatot nem
  közvetít. A trace-ben az egymásba ágyazott agent-futás látszik.

## 4. Csomag-flow

### 4.1 Irányított kérdések

A csomag-agent promptja írja elő: egyszerre egy kérdés, sorrendben:

1. **Ügyfél azonosítása** → `queryCustomers` betölti az ügyfelet és preferenciáit.
2. A további kérdéseknél (méret, fényigény, pet/kid-safe, darabszám) az ügyfél-preferenciák
   **előtöltött javaslatok** („a keret 250 000 Ft és kezdő szint — maradjunk ennél?"), a
   felhasználó felülbírálhat.

### 4.2 Tool-kapuk (a tool kényszerít, a prompt terel)

- **`validatePackage`** — determinisztikus, **Prisma-alapú** ellenőrzés: a termék-ID-k léteznek,
  teljesítik a feltételeket (méret, fény, pet/kid-safe, `difficulty` ≤ ügyfél
  `expertise_level`), megvan a kért darabszám, **és az összár nem lépi túl az ügyfél
  büdzséjét (kemény korlát)**. Hiba esetén magyar üzenettel tér vissza (pl. „csak 4 találat a
  feltételekre"), az agent visszalép: feltétel-lazítást vagy kevesebb darabot ajánl.
- **`savePackage`** — mentés előtt újra lefuttatja ugyanazt a validálást; csak validált csomagot
  ír a `packages` + `package_items` táblákba (Prisma, read-write út).

### 4.3 Összesítő + megerősítés a mentés előtt

Sikeres `validatePackage` után a mentés NEM automatikus:

1. A `validatePackage` sikeres kimenete a strukturált csomagtervet is tartalmazza (tételek,
   darabszám, egységár, összár, ügyfél-keret) — ez a szerveren **`data-package`** partként
   kimegy a streambe.
2. A web UI ebből egy **csomag-összesítő kártyát** renderel (lásd 6.2), az agent pedig
   szövegben felteszi a záró kérdést: **„Ez így rendben van?"**
3. Mentés csak a felhasználó explicit megerősítése UTÁN történhet (`savePackage`); ezt a
   csomag-agent promptja írja elő. Megerősítés helyett módosítás-kérés → vissza a kérdezgetésbe
   (új validálás új összesítőt ad); lemondás → `cancelPackage`.
4. Sikeres mentés után az agent **végleges visszajelzést** ad (csomag-azonosító, összár,
   tételek egy mondatban), és a flow lezárul.

### 4.4 Kilépés a flowból — pontosan két út, mindkettő tool-hívás

- A felhasználó explicit lemond → az agent a **`cancelPackage`** toolt hívja (az execute csak
  nyugtáz és rögzít).
- Sikeres **`savePackage`** (csak megerősítés után) → a flow kész.

A flow-lock állapota így a beszélgetés-előzményben már úgyis ott lévő tool-eseményekből
olvasható ki: egy pici, tiszta függvény (`findLastFlowSignal`) nézi végig a `data-tool`
partokat — nyitás: `routeTo → csomag-agent`; zárás: sikeres `savePackage` vagy `cancelPackage`.
Nincs szöveg-parse-olás.

## 5. Adatbázis (Prisma migráció + seed)

**Az ügyfél-réteg a baseline-proposalból jön készen**
(`2026-07-15-baseline-customers-threads-proposal.md`): a **`customers`** tábla (20 életszerű
sor, `budget`, `expertise_level`, `pet_safe_required`, `kid_safe_required`, `notes`) és a
**`queryCustomers`** tool (a `getClientPreferences`-t kiváltotta). Ez a spec ezekre épít, nem
hoz létre sajátot.

Amit ez a spec ad hozzá:

- **`packages`**: `id`, `customer_id` (FK a `customers`-re), `total_price`, `created_at`.
- **`package_items`**: `package_id`, `product_id`, `qty`.
- Új toolok adatelérése: **Prisma** (generált kliens). Csak a `runSql` marad a nyers pg
  read-only úton.

## 6. Szerver és web UI

### 6.1 Szerver (`apps/server`)

- A `/api/chat` az `askAgent` helyett az orchestrator belépési pontját hívja; **stateless
  marad** (flow-állapot az előzményből).
- **Stream-protokoll váltás:** `text/plain` → AI SDK **UI message stream**
  (`createUIMessageStream`). A szöveg-deltákon túl strukturált partok:
  - `data-agent` — melyik agent aktív (handover-esemény);
  - `data-tool` — tool-hívás összefoglaló a meglévő `ToolOutcome.summary`-ból (a Trace `report`
    callback már gyűjti; mostantól a streambe is megy). **Az orchestrator `routeTo` hívásai is
    kimennek** — a döntési pont látható.
- **A protokoll-transzformáció egyetlen fájlba zárva:** `apps/server/src/chat-stream.ts` — a
  `main.ts` handler ~20 sor marad. A visszaküldött előzmény `data-*` partjainak kiszűrése a
  `convertToModelMessages` előtt egy jól elnevezett egysoros helper (`stripDataParts`).

### 6.2 Web UI (`apps/web`)

- `TextStreamChatTransport` → `DefaultChatTransport`.
- Minden asszisztens-üzenet fölött **agent-badge** (🌱 Info / 📦 Csomag — az orchestrator nem
  beszélő szereplő, az ő döntése egy diszkrét routing-chip: „🎯 routeTo → csomag-agent (indok)").
- **Csomag-összesítő kártya** (`apps/web/src/components/package-summary.tsx`): a
  `data-package` partból renderelődik — tétel-lista (növény, db, egységár), összár, az ügyfél
  kerete melletti összevetés. Alatta két gomb: **„Rendben, mentsd"** és **„Módosítanék"** —
  mindkettő csak egy előre írt chat-üzenetet küld be (nincs külön API-út: a megerősítés is a
  beszélgetésben él, az agent dönt rá tool-hívással).
- Tool-hívások **chip-ekként** időrendben („runSql — 4 sor", „validatePackage — hiba: csak 4
  találat"); delegate módban a beágyazott info-agent hívások behúzva a csomag-agent chipje alatt.
- A részletes trace továbbra is a szerverkonzolra és a `logs/`-ba megy.

## 7. Tesztelő skill (`.claude/skills/flow-test/`)

Szimulált beszélgetés-teszt (LLM-as-user), **két driverrel, közös maggal**:

- **Forgatókönyvek** (`scenarios/*.md`): perszóna + cél + elvárások. Induló készlet:
  1. happy path — végigmegy, ment;
  2. menet közben lemondja;
  3. „5 nagy növényt kérek 10 ezer alatt" — csak 4 felel meg → visszalépést várunk;
  4. kitörési kísérlet — flow közben másról beszél → visszaterelés, lock marad;
  5. adat-kérdés — a router az info-agenthez irányít.
- **User-szimulátor — két különálló, fentről lefelé olvasható szkript** (szándékosan NINCS
  driver-absztrakció; kis duplikáció, nagy olvashatóság). A felhasználót mindkettőben a
  **Vercel AI SDK** `generateText` játssza a perszóna-prompt alapján, max N körig; a közös apró
  helperek: `persona.ts`, `evaluate.ts`.
  - `run-scenario-http.ts` (default): `fetch` a `/api/chat`-re, a stream feldolgozása
    `readUIMessageStream`-mel — gyors, fejlesztés közbeni iterációra;
  - `run-scenario-browser.ts`: **Playwright** a valódi web UI ellen — gépel a chat-inputba,
    DOM-ból olvassa a választ; órai demó-mód, mellékesen a UI-render (badge, chip) meglétét is
    asserteli.
- **Értékelő** (`evaluate.ts`): a `logs/<ts>.json` trace-ből determinisztikus assertek (jó agent
  kapta a labdát; `validatePackage` megtörtént a `savePackage` előtt; nem zárult le a flow jelzés
  nélkül) + LLM-értékelés a puha szempontokra (visszaterelés minősége, kérdés-sorrend), végül
  **javítási javaslatok** a promptokra/toolokra.
- **Összehasonlító futás:** a skill mindkét `ORCHESTRATION_MODE`-ban lefuttatja a
  forgatókönyveket és összevető riportot ad.

## 8. Új fájlok, tesztek, munkamenet

**Szemléltethetőségi vállalások:** minden új fájl ~150 sor alatt marad, a meglévő stílusú magyar
„miért"-kommentekkel; minden fájlnév hordozza a típusát (`*-agent.ts`, `*-prompt.ts`,
`*-tool.ts`, `*-handover.ts`); a tool-mappák cselekvés-nevűek.

```
agents/orchestrator-agent/
├── orchestrator-agent.ts      # belépési pont: ORCHESTRATION_MODE alapján választ (pár sor)
├── orchestrator-prompt.ts
├── router-handover.ts         # 1. megközelítés: az orchestrator közvetít
└── delegate-handover.ts       # 2. megközelítés: agent hív agentet toolként
agents/package-agent/
├── package-agent.ts
└── package-prompt.ts
tools/
├── route-to/route-to-tool.ts
├── request-info/request-info-tool.ts      # router mód „kapcsa" (üres execute)
├── ask-info-agent/ask-info-agent-tool.ts  # delegate mód „kapcsa" (beágyazott agent-loop)
├── cancel-package/cancel-package-tool.ts
├── validate-package/validate-package-tool.ts
└── save-package/save-package-tool.ts
```
- **Vitest specek** az új toolokra (input-validálás, never-throw, budget-korlát) — repo-konvenció,
  a skilltől független.
- Prisma migráció (`clients`, `packages`, `package_items`) + seed-bővítés.
- **Branch:** `feat/orchestrator-demo`; push csak külön jelzésre.
- **Docs:** `docs/architektura.md` kiegészítés (két mód ábrával), CLAUDE.md agents-szekció frissítés.

## 9. Demó-ops: friss indítás egy paranccsal

**Probléma:** branch-váltás után az app újraindítva is a korábbi verziót futtatja — a demón
branchről branchre váltunk, ez így nem vállalható. Gyanús források (implementációkor kivizsgálandó,
mindet kezelni): Nx computation cache (`.nx/cache`), a `packages/*/dist` állapota (tesztek/build
ezt használják), a Vite dev-cache (`node_modules/.vite`), életben maradt régi dev-processzek,
és az elavult generált Prisma-kliens.

**Megoldás: `pnpm demo` root script** — egyetlen parancs, ami mindig friss állapotból indít:

1. leállítja az esetleg futó dev-processzeket (port-alapú kill: 3001, 5173);
2. tisztít: `nx reset` + `dist` + `node_modules/.vite` törlés;
3. `prisma generate`, `docker compose up -d`, migráció + seed (idempotens);
4. friss build, majd server + web indítása együtt (concurrently), egy terminálban.

A cél: branch-váltás után `pnpm demo`, és determinisztikusan az AKTUÁLIS branch kódja fut.

## 10. Nem cél (YAGNI)

- Auth / szerepkezelés a web rétegben.
- Session-store a szerveren.
- Playwright-alapú UI-regressziós tesztsuite (a browser-driver csak minimál DOM-asserteket ad).
- CLI-bekötés az új agentekhez (a demó web-first; a CLI marad a mai két agentnél).
