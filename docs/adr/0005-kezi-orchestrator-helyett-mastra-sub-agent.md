# ADR-0005: A kézi orchestrator felváltása Mastra sub-agent delegálással

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-05
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [ADR-0003](./0003-mastra-keretrendszer-bevezetese.md),
  `packages/core/src/lib/agents/orchestrator-agent/**` (törölve), `docs/architektura.md`

## Kontextus

Az agentek közti átadást eddig saját orchestrator intézte:

- a `routeTo` tool döntött az útválasztásról (minden agent-közi jelzés tool-hívás volt, sosem
  szövegértelmezés),
- a `findLastFlowSignal` tartotta a **flow-lockot** a strukturált `data-tool` részekből,
- két handover-változat élt egymás mellett: `router-handover.ts` (az orchestrator továbbítja a
  `requestInfo` kérdéseket az info-agentnek, látható for-ciklus, max 3 ugrás) és
  `delegate-handover.ts` (a csomag-agent toolként hívja az info-agentet),
- mindezt az **`ORCHESTRATION_MODE=off|router|delegate`** env kapcsolta, kérésenként olvasva.

Ez sokat tanított, de három kódúttá szaporodott (`off` / `router` / `delegate`), amelyet külön kellett
tesztelni (a `flow-test` skill 5 forgatókönyve **kétszer** fut), és a flow-lock kézi állapotkezelése
volt a leggyakoribb hibaforrás. A Mastra bevezetése (ADR-0003) után ugyanezt a keretrendszer
natívan adja: egy agent al-agentet hívhat, a delegálás a trace-ben látszik.

## Döntés

A kézi orchestrátort **megszüntetjük**, és a Mastra natív **sub-agent delegálására** állunk át:

- a csomag- (package-) agent a Mastra sub-agent mechanizmusán keresztül kéri az adatot az
  info-agenttől — nincs többé saját `routeTo`, `requestInfo`, `askInfoAgent` tool,
  nincs `findLastFlowSignal`, nincs kézi hop-számláló,
- az **`ORCHESTRATION_MODE` env megszűnik**: egy kódút marad, nincs `off`/`router`/`delegate`
  elágazás,
- a több lépésből álló, felfüggeszthető folyamat (csomag-összeállítás megerősítéssel) a Mastra
  **workflow**-jára kerül (`createWorkflow` / `createStep`, suspend-resume), nem kézi
  állapotgépre.

## Megfontolt alternatívák

- **A kézi orchestrator megtartása a Mastra mellett** — a `routeTo`-loop tanításilag értékes, de két
  egymással versengő delegálási mechanizmus egy repóban zavaró, és a flow-lock a Mastra memóriájával
  duplikálódna. Elvetve.
- **Csak a `delegate` mód megtartása, a `router` eldobása** — kisebb lépés, egy kódúttal kevesebb,
  de a saját `askInfoAgent` tool és a `data-tool` jel-protokoll így is megmaradna a keretrendszer
  natív megoldása mellett. Elvetve.
- **Mastra „network" / multi-agent hálózat** — dinamikusabb útválasztás, de több varázslat és
  kevésbé kiszámítható a determinisztikus csomag-folyamathoz, ahol a lépések sorrendje kötött.
  Elvetve — a workflow + sub-agent páros explicitebb.

## Következmények

- **Pozitív:** egy kódút három helyett; a `flow-test` forgatókönyvek fele annyi futással
  ellenőrizhetők; a delegálás állapotát a keretrendszer tartja, nem mi; a HITL-megerősítés
  a workflow suspend-resume-jával természetes.
- **Ár:** elveszítjük a látható `for`-ciklust, amiben a hop-ok soronként követhetők voltak — ez volt
  a „két agent beszélget" fejezet legszemléletesebb kódrészlete. Az agent-közi átadás mostantól a
  trace-fában látszik, nem a forrásban.
- **Ár:** az A/B jellegű összehasonlítás (`router` vs. `delegate` ugyanazon forgatókönyvön)
  megszűnik mint futtatható demó; a két minta összevetése átkerül a tananyagba, illetve az
  ADR-be mint döntéstörténet.
- **Semleges:** az `apps/server` streaming része egyszerűsödik (nem kell módfüggő
  `data-agent` / `data-tool` / `data-package` részeket kibocsátani).
