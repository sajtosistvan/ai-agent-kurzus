# ADR-0003: A Mastra agent-keretrendszer bevezetése

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-05
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [ADR-0004](./0004-sajat-trace-helyett-mastra-observability.md),
  [ADR-0005](./0005-kezi-orchestrator-helyett-mastra-sub-agent.md),
  [ADR-0006](./0006-tarolas-postgresen-marad.md), `CLAUDE.md`, `docs/architektura.md`,
  branch: `refactor/mastra`

## Kontextus

A projekt eddigi — eddig csak a `CLAUDE.md`-ben rögzített, ADR-ben soha le nem írt — elve az volt,
hogy **szándékosan nincs agent-framework**: „packages/core is framework-agnostic … There is
deliberately no agent framework so the mechanics stay legible." A loop kézzel készült (előbb nyers
Anthropic SDK, majd Vercel AI SDK `generateText` + `stopWhen`), a megfigyelhetőséget saját `Trace`
adta, az agentek közti átadást saját orchestrator intézte.

Ez a kurzus első felében pontosan azt hozta, amit vártunk: minden réteg látszott. A projekt
azonban túlnőtt ezen. Ma már négy agent, tíz körüli tool, RAG, HITL-jellegű csomag-folyamat,
több entrypoint (CLI, HTTP/streaming, web, MCP) van benne — és minden keretrendszer-funkciót
(trace, memória, perzisztencia, kiértékelés, tool-regisztráció, streaming-protokoll) magunknak
kell megírni és karbantartani. A saját infrastruktúra karbantartása kezdte elszívni az időt a
tananyagtól, és a kurzus résztvevője a munkahelyén úgyis keretrendszerrel fog találkozni.

## Döntés

Bevezetjük a **Mastra** agent-keretrendszert (`@mastra/core` 1.55), és rá építjük át a
`packages/core`-t. A kód a `packages/core/src/mastra/` alá költözik a Mastra konvenciói szerint:

- `index.ts` — a `Mastra` példány (agents, tools, workflows, scorers, storage, vectors),
- `agents/` — 1 agent = 1 fájl (`new Agent({...})`),
- `tools/` — 1 tool = 1 fájl (`createTool`, input+output sémával),
- `workflows/`, `scorers/`, `processors/`, `rag/`.

A stack NEM változik: Postgres + pgvector + Prisma + TypeScript + Anthropic/OpenAI modellek.
A `packages/core/src/lib/**` fokozatosan kiürül; amit kiváltunk, azt töröljük, nem hagyjuk holtan.

Ezzel a döntéssel a `CLAUDE.md` „deliberately no agent framework" elve **hatályát veszti**.
(Önálló ADR nem tartozott hozzá — ez a bekezdés a felváltása; a `CLAUDE.md`-t ennek megfelelően
frissítjük.)

## Megfontolt alternatívák

- **Maradunk kézi loopnál (status quo)** — maximális átláthatóság, nulla új függőség. Elvetve:
  a memória, a perzisztencia, az evals és a Studio-szerű felület megírása nem tananyag, hanem
  keretrendszer-fejlesztés; egyre több időt vitt el, és a végeredmény gyengébb, mint egy kész
  keretrendszeré.
- **Vercel AI SDK „agent" absztrakciók, keretrendszer nélkül** — kis lépés lett volna a
  jelenlegiből, de a hiányzó darabok (perzisztált memória, scorerek, workflow-suspend/resume,
  observability-felület) ugyanúgy ránk maradnak. Elvetve.
- **LangGraph.js** — érett, de a gráf-modell és a Python-központú ökoszisztéma idegen ettől a
  TS-monorepótól; a tanítási példák nagy része Pythonban él. Elvetve.
- **Mastra** — TypeScript-natív, Postgres-store és pgvector támogatással, tool/agent/workflow/
  scorer fogalmakkal, saját Studióval. Illeszkedik a meglévő stackre. **Választva.**

## Következmények

- **Pozitív:** a keretrendszer hozza a memóriát, a perzisztenciát, a tracinget, az evalst és a
  Studiót; kevesebb saját infrastruktúra, több idő a domainre. A tanított fogalmak (agent, tool,
  workflow, scorer, processor) iparági nevet kapnak, amivel a hallgató máshol is találkozik.
- **Ár (és ez valós ár egy kurzus-repóban):** a loop mechanikája **már nem látszik soronként a
  kódban**. Eddig egy fájlban lehetett megmutatni, hogy prompt → tool-call → tool-result → újra
  modellhívás; ezután ez a keretrendszer belsejében fut. A „mi történik valójában" kérdésre
  ezentúl a Mastra Studio trace-fája és a naplók válaszolnak, nem a saját `agent-loop.ts`.
  Ezt a veszteséget tudatosan vállaljuk, és a tananyagban külön fejezettel pótoljuk
  („mit csinál helyettünk a keretrendszer").
- **Ár:** új, gyorsan mozgó függőség (verzió-frissítések, breaking change kockázat), és egy
  nagy, kockázatos refaktor a `refactor/mastra` branchen.
- **Semleges:** a fájlszerkezet átrendeződik (`lib/` → `mastra/`); a domain-logika (SQL-guard,
  read/write szétválasztás, feed-parser, csomag-validáció) változatlanul a miénk marad.
