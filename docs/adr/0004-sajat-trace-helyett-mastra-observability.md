# ADR-0004: A saját `Trace` és a `ToolOutcome` side-channel megszüntetése

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-05
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [ADR-0003](./0003-mastra-keretrendszer-bevezetese.md),
  [ADR-0006](./0006-tarolas-postgresen-marad.md), `packages/core/src/lib/trace.ts` (törölve),
  `packages/core/src/lib/tools/tool-outcome.ts` (törölve)

## Kontextus

A Plantbase átláthatóságát eddig két saját mechanizmus adta:

1. **`Trace`** — a `prepareStep` / `onStepFinish` hookokra kötött házi nyomkövetés: élő konzol-kiírás,
   `logs/<ts>.json` és `logs/agent.log`.
2. **`ToolOutcome` + `ToolReporter`** — minden tool JSON-*stringet* adott vissza a modellnek
   (`content`), a teljes eredményt (`summary`, `rowCount`, `isError`) pedig egy `report` callback
   side-channelen küldte a `Trace`-nek.

Ez a pár működött, de két külön igazságforrást tartott fenn: amit a modell lát, és amit mi látunk.
Minden új tool két helyen kellett hogy „elszámoljon" magával, a `report` átfűzése minden tool-gyár
szignatúráját fertőzte (`(report: ToolReporter) => ToolSet`), a naplók pedig fájlokban álltak, nem
lekérdezhető formában. A Mastra bevezetésével (ADR-0003) mindez duplikáció lett: a keretrendszer
strukturált tracet, naplózót és felületet is hoz.

## Döntés

A saját `Trace`-t és a `ToolOutcome`/`ToolReporter` side-channelt **megszüntetjük**, és helyette
a Mastra beépített megfigyelhetőségére támaszkodunk:

- **`@mastra/observability`** — automatikus span-ek az agent-futásokra, tool-hívásokra,
  modellhívásokra; a trace a `PostgresStore`-ba kerül (ADR-0006).
- **`PinoLogger`** (`@mastra/loggers`) — strukturált napló; a toolok `mastra?.getLogger()`-rel
  `logger.warn`-olnak (pl. amikor az SQL-guard elutasít egy lekérdezést).
- **Mastra Studio** — a trace-fa, a tool-be/kimenetek és a naplók böngészhető felülete.
- Minden tool `createTool`-lal készül, és **strukturált objektumot** ad vissza az `outputSchema`
  szerint (nem JSON-stringet). Hibát nem dobunk: a séma tartalmaz `sikeres: false` + hibaszöveg
  mezőt. Így ugyanaz az egy visszatérési érték szolgálja a modellt és a megfigyelést — nincs
  többé side-channel.
- A minőség számszerű mérését nem a trace, hanem a **scorerek** (`packages/core/src/mastra/scorers/`)
  adják: magyar nyelvű válasz, katalógus-fedettség (hallucinált ár), RAG-forráshivatkozás,
  NFR1 csak-olvasó út, és egy olcsó LLM-judge.

## Megfontolt alternatívák

- **Mindkettőt megtartjuk (saját `Trace` + Mastra observability)** — a legkisebb kockázat, de két
  párhuzamos nyomkövetés, kétszeres karbantartás és zavaros tanítási üzenet („melyiket nézzem?").
  Elvetve.
- **Saját `Trace` megtartása, csak a `ToolOutcome` elhagyása** — a `report` callback nélkül a
  `Trace` amúgy is elveszítené az információ felét, tehát a fél lépésnek nincs értelme. Elvetve.
- **OpenTelemetry-exporter külső backendbe (Langfuse / Jaeger)** — erősebb, de új szolgáltatást
  húz be a kurzus-környezetbe (`docker compose` + fiók). Későbbre halasztva; a Mastra
  observability OTel-alapú, tehát ez később ráköthető anélkül, hogy a kódot újraírnánk.

## Következmények

- **Pozitív:** egy igazságforrás; a toolok szignatúrája letisztul (nincs `report` paraméter);
  a trace kereshető és perzisztens (Postgres), nem fájl-alapú; a scorerek számot adnak arra,
  amire eddig csak ránézésünk volt.
- **Ár:** elveszítjük a `logs/agent.log` élő, soronkénti, magyar nyelvű kiírását, ami a CLI-ben
  demózáskor nagyon szemléletes volt — helyette Studiót kell nyitni. A `--quiet` / élő-trace
  megkülönböztetés a CLI-ben értelmét veszti vagy átalakul.
- **Ár:** a megfigyelhetőség mostantól **függőség**: ha a Mastra trace-formátuma változik, a
  tananyag képernyőképei elavulnak.
- **Semleges:** a `logs/` mappa szerepe visszaszorul a teszt-riportokra (`flow-test`, `autotest`).
