# 7. óra — Multi-agent orchestráció + beszélő agent

Az óra két nagy blokkja: **agentek együttműködése** (orchestrátor, handover, flow-kontroll) és a
**hangalapú agent** (STT → LLM → TTS lánc). Minden anyag ebben a repóban él; a demók három,
egymásra épülő branchen követhetők.

## A demó-branchek (checkout-olható állomások)

| Branch | Mit ad hozzá |
|---|---|
| `demo/01-cleanup` | A meglévő kód rendbetétele: az admin-szerep (delegateToIngest) újraélesztése, halott kód törlése, doksi-szinkron, **`pnpm demo`** friss-indító script |
| `demo/02-alapfunkciok` | `customers` tábla (20 életszerű ügyfél) + `queryCustomers` tool; **thread-perzisztencia** (a DB az igazságforrás), thread-lista + `?thread=<id>` URL |
| `demo/03-orchestrator` | **Multi-agent réteg** `ORCHESTRATION_MODE` flaggel: orchestrator (sosem válaszol, csak irányít), csomag-agent tool-kapukkal, két handover-mód, látható handover a web UI-ban, flow-test skill |

Branch-váltás után mindig: **`pnpm demo`** — determinisztikusan az aktuális branch kódja fut.

## 1. blokk — Orchestráció (demo/03)

**A három topológia** (vetíthető, kattintható ábra: `docs/demo/agent-topologiak.html`):
1. *Master–slave*: agent a másik agent keze — a query agent toolként futtatja az ingest agentet (végrehajtat).
2. *Peer/mesh (delegate mód)*: agent a másik agent kollégája — a csomag-agent az `askInfoAgent` toollal konzultál az info-agenttel; a belépési pont itt is az orchestrator, de az ADAT nem rajta megy át.
3. *Csillagpont (router mód)*: minden az orchestratoron át — a csomag-agent `requestInfo`-val jelez, az orchestrator ugrik az info-agenthez és hozza vissza a választ.

**Kulcs-elvek, amiket a kód kikényszerít:**
- Minden agent-közti jelzés **tool-hívás**, soha nem szöveg-parse (`routeTo`, `requestInfo`, `askInfoAgent`, `cancelPackage`).
- **A tool kényszerít, a prompt terel:** a `validatePackage` determinisztikus Prisma-kód (készlet, pet/kid-safe, szint, **budget kemény korlát**), a `savePackage` mentés előtt újra validál; mentés csak az összesítő kártya utáni explicit „Ez így rendben van?" megerősítéssel.
- **Flow-lock:** amíg a csomag-flow nyitott, minden üzenet a csomag-agenté — a lock állapota a történelem tool-eseményeiből olvasható ki (`findLastFlowSignal`, tiszta, unit-tesztelt függvény), nem session-store-ból.
- **`ORCHESTRATION_MODE=off`** (default) = a korábbi egy-agentes viselkedés bájtra pontosan; `router` / `delegate` élőben kapcsolható (`.env` + szerver-restart).

**Automata tesztelés:** `.claude/skills/flow-test/` — LLM játssza a felhasználót 5 forgatókönyvben
(happy path, lemondás, visszalépés, kitörési kísérlet, adat-routing), az értékelő a trace-logból
determinisztikus asserteket futtat és javítási javaslatokat ír; a két mód összevethető.

```bash
npx tsx --env-file=.env .claude/skills/flow-test/scripts/run-scenario-http.ts scenarios/01-happy-path.md
npx tsx --env-file=.env .claude/skills/flow-test/scripts/evaluate.ts
```

## 2. blokk — Beszélő agent (`docs/voice/`)

Mini Node-szerver + plain HTML (kulcs env-ből: `OPENAI_API_KEY`), három élő demó:
1. **Cascade latency waterfall** — STT → LLM → TTS lépésenkénti idő és köztes szövegek: a latency a rétegek összege, a köztes szöveg maga az observability.
2–3. A további demókat lásd `docs/voice/README.md`.

```bash
cd docs/voice && npm install
cp .env.example .env   # írd bele a saját OPENAI_API_KEY-edet (helyi, gitignore-olt fájl)
node --env-file=.env server.mjs   # → http://localhost:3777 (Chrome + mikrofon)
```

## Kapcsolódó anyagok a repóban

- `docs/demo/agent-topologiak.html` — interaktív topológia-ábra (3 nézet, lépésenkénti kiemelés)
- `docs/demo/demo-utmutato.md` — fázisonkénti változások fájlonként + tesztlépések
- `docs/architektura.md` — „Orchestrator — két handover-mód" szekció
- `docs/superpowers/specs/` és `plans/` — a tervezési dokumentumok (spec → plan → implementáció)
