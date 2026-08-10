# Plantbase — architektúra (fájlstruktúra + főbb döntések)

> Kurzus-melléklet. A "mivel" (verziók, eszközlista, séma) a `stack.md`-ben; itt a STRUKTÚRA és a kulcsdöntések.

## Fájlstruktúra (Nx monorepo)

```
plantbase/
├── packages/core   agent-logika (LLM-hívás, runSql tool, séma-kontextus, naplózás)
├── packages/db     Prisma lib (séma, migráció, kliens, seed) — NEM a gyökérben
├── apps/cli        CLI (ask parancs + interaktív mód)
├── apps/server     Express API (/api/chat + /debug/knowledge)
├── apps/web        Vite + React chat UI, tool-kártyák
├── docs            dokumentáció (lásd dev-workflow.md)
└── konfig          nx, package.json, .env, docker-compose
```

(Csak nagy vonalakban; a fájl-szintű bontást Claude generálja a konvenciók szerint.)

## Főbb technológiai döntések

1. **Framework-agnostic core.** A `packages/core` nem ismeri a belépési pontokat (CLI/API/web). Új felület = új app, nem újraírás. (Mastra majd az 5. órán a core köré.)
2. **Két DB-kapcsolat, két jog.** Az agent `runSql`-je READ-ONLY kapcsolaton fut (`DATABASE_URL_READONLY`), csak SELECT. A Prisma READ-WRITE kapcsolaton (`DATABASE_URL`) viszi a sémát, migrációt, seedet. Az agent NEM Prismán kérdez.
3. **Agent-loop a Vercel AI SDK-ra építve.** Az agent a **Vercel AI SDK 6**-ra épül (`generateText` + `stopWhen: stepCountIs(n)`): a prompt → tool-hívás → tool-eredmény → ismétlés ciklust az SDK futtatja, de a lépésenkénti átláthatóságot a saját trace-rétegünk adja (`prepareStep`/`onStepFinish` → trace.ts). A loop eredetileg kézzel íródott a nyers Anthropic SDK fölé — a tananyag ezt a fejlődést követi.
4. **Átláthatóság beépítve.** Minden interakció JSONL-be naplózva; `--show-prompt` a teljes prompt megjelenítéséhez.
5. **Lokális DB.** docker-compose Postgres, OrbStack futtatja. Helyben dolgozunk, nincs felhő-DB.
6. **Prisma külön Nx lib.** A Prisma (séma, migráció, kliens, seed) a `packages/db` libben él, NEM a repo gyökerében: a séma az Nx graph része, a core és a seed onnan importál.
7. **Library-doksi munka előtt.** Új vagy ritkán használt API-nál (pl. Prisma) ELŐBB beolvassuk a doksit Context7-tel, csak utána kódolunk, mert így kevesebb a hiba a tesztek alatt.

Konvenciók: `konvenciok.md`. Git/hook/automatizmus: `dev-workflow.md`.

## Orchestrator — két handover-mód

A szerveres chat-út (`/api/chat`) egy `ORCHESTRATION_MODE` kapcsolóval három módban futhat.
`off` (alapértelmezés): a mai egy-agentes út, változatlanul — a kérdést közvetlenül a
query-agent kapja, semmi orchestráció. A két orchestrált módban egy **orchestrator-agent**
dönt a routingról (`routeTo` tool-hívással — minden agent-közti jelzés tool-hívás, soha nem
szöveg-parse), és flow közben a **flow-lock** tartja a labdát a csomag-agentnél: a
`findLastFlowSignal` a mentett `data-tool` partokból (strukturált tool-eseményekből) olvassa
ki, hogy nyitva van-e csomag-flow.

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

- **router**: a csomag-agent `requestInfo(q)` toolja ÜRES execute-tal csak JELEZ; a kérdést
  az orchestrator kézbesíti az info-agentnek (a mai query-agent), a választ címkézett
  üzenetként adja vissza a csomag-agent loopjának — látható for-ciklus, max 3 ugrás.
  *Ugyanaz a tool-felület (kérdés be, adat vissza), csak az execute más.*
- **delegate**: a csomag-agent `askInfoAgent(q)` toolja MAGA futtatja le a beágyazott
  info-agent loopot (a `delegateToIngest` mintájára); az adat nem hagyja el a tool-hívás
  körét. *Ugyanaz a tool-felület (kérdés be, adat vissza), csak az execute más.*
- **off**: a mai egy-agentes út, változatlanul.

A csomag-flow tool-kapui determinisztikusak: `validatePackage` (Prisma-ellenőrzés: pet/kid/
difficulty/készlet/budget kemény korlát), `savePackage` (mentés előtt ÚJRA validál; `packages`
+ `package_items`, FK a `customers`-re), `cancelPackage` (a lemondás rögzítése tool-hívásként).
A stream a hop-okat `data-agent`/`data-tool`/`data-package` partokként viszi ki a web UI-nak
(agent-badge, routing-chip, összesítő kártya) — `off` módban ilyen part nem is keletkezik.

> **Történeti fejezet.** A fenti kézi orchestrátort a Mastra sub-agent delegálása váltja fel,
> az `ORCHESTRATION_MODE` megszűnik — lásd [ADR-0005](./adr/0005-kezi-orchestrator-helyett-mastra-sub-agent.md).
> A leírás azért marad itt, mert a tananyag ezt a fejlődést követi.

## Mastra — a keretrendszeres felállás

A 2026-08-05-i refaktor óta a `packages/core` a **Mastra** keretrendszerre épül
([ADR-0003](./adr/0003-mastra-keretrendszer-bevezetese.md)). A kézi loop, a saját `Trace` és a
`ToolOutcome` side-channel megszűnt ([ADR-0004](./adr/0004-sajat-trace-helyett-mastra-observability.md)),
a tárolás Postgresen maradt ([ADR-0006](./adr/0006-tarolas-postgresen-marad.md)).

```
packages/core/src/mastra/index.ts   ← EGY Mastra példány fogja össze az egészet
   │
   ├── agents/        query-agent ─────────┐   csomag-agent ──(sub-agent)──▶ info-agent
   │                  katalógus-szerkesztő │
   │                                       │
   ├── tools/         katalogus_sql (READ ONLY, sql-guard, plantbase_ro)  ◀── NFR1
   │                  termek_mentes (read-write pool, Zod)
   │                  webshop_feed, csomag_ellenorzes, csomag_mentes
   │                  tudasbazis_kereses ──▶ rag/  (PgVector)
   │
   ├── workflows/     csomag-folyamat (createStep + suspend/resume = HITL megerősítés)
   ├── processors/    input/output guardrail (PII, RBAC)
   └── scorers/       magyar-valasz · katalogus-fedettseg · rag-hivatkozas
                      csak-olvaso-ut (NFR1) · hasznossag-judge (Haiku)
   │
   ▼ storage / observability
PostgresStore (memória, trace, score) + PgVector (embedding) — UGYANAZ a Postgres,
PinoLogger (strukturált napló) + Mastra Studio (trace-fa, tool be/kimenet, scorek)
```

Amit ez a felállás cserébe elvesz: a loop mechanikája **nem látszik soronként a kódban**.
Ami eddig a saját `agent-loop.ts`-ben volt olvasható (prompt → tool-hívás → tool-eredmény →
újra modell), azt ezután a Studio trace-fáján kell megnézni. Ez tudatosan vállalt ár —
az indoklás az ADR-0003 „Következmények" szakaszában.
