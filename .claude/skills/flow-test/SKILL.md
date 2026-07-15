---
name: flow-test
description: A Plantbase orchestrator/csomag-flow szimulált beszélgetés-tesztje (LLM-as-user). Használd, amikor a csomag-flow-t, a routingot vagy a flow-lockot kell végigtesztelni — öt forgatókönyv, két driver (HTTP: gyors iteráció; Playwright: valódi web UI + badge/chip asszertek), determinisztikus + LLM-értékeléssel, két ORCHESTRATION_MODE összehasonlításával.
---

# Flow-test — szimulált beszélgetés-teszt

## Előfeltételek
- DB fut (`docker compose up -d`), seedelve; `.env`-ben ANTHROPIC_API_KEY.
- A szerver a TESZTELT móddal fusson: `ORCHESTRATION_MODE=router pnpm server` (a web UI-hoz
  `pnpm web` is, ha a browser-drivert használod).

## Futtatás (egy forgatókönyv, HTTP driver — default)
```bash
pnpm tsx .claude/skills/flow-test/scripts/run-scenario-http.ts \
  .claude/skills/flow-test/scenarios/01-happy-path.md --mode router
```
A futás trace-e a `logs/flow-test/<ts>-01-happy-path-router.json` fájlba kerül, az elérési
utat a szkript kiírja.

## Browser driver (órai demó-mód, badge/chip asszertekkel)
```bash
pnpm tsx .claude/skills/flow-test/scripts/run-scenario-browser.ts \
  .claude/skills/flow-test/scenarios/01-happy-path.md --mode router
```

## Értékelés
```bash
pnpm tsx .claude/skills/flow-test/scripts/evaluate.ts logs/flow-test/<fájl>.json
```
Determinisztikus assertek (jó agent kapta a labdát; validatePackage a savePackage előtt;
nem zárult flow jelzés nélkül) + LLM-értékelés a puha szempontokra (visszaterelés,
kérdés-sorrend) + javítási javaslatok a promptokra/toolokra. Hibás assert → exit 1.

## Összehasonlító futás (a skill fő munkamenete)
1. Indítsd a szervert `ORCHESTRATION_MODE=router`-rel, futtasd le MIND az öt forgatókönyvet
   a HTTP driverrel, értékeld ki mindet.
2. Állítsd át `delegate`-re, indítsd újra a szervert, futtasd le újra mind az ötöt.
3. Az evaluate.ts-nek add be az összes logot egyszerre:
   `pnpm tsx .claude/skills/flow-test/scripts/evaluate.ts logs/flow-test/*.json`
   — módonként csoportosított összevető riportot ír (assert-eredmények, körszám, hibák),
   a végén javítási javaslatokkal.
