---
name: autotest
description: Lefuttatja a Plantbase Playwright nehézségi-létra batteryt (single→multi→komplex→stressz→trollkodás), kiértékeli az eredményt egy önálló, fancy HTML-riportba javaslatokkal, megkérdezi a felhasználót, mely javaslatokat ültesse át, és a döntést (elfogadott ÉS elvetett) egy ADR-be logolja. Használd, amikor a webes agentet end-to-end tesztelni és a tanulságokat döntési naplóba rögzíteni kell — pl. „futtasd le az autotestet", „/autotest", „nézd meg, hogy bírja a nehéz kérdéseket, és írd meg a riportot".
---

# autotest — teszt → HTML-riport → döntés → ADR

Egy zárt hurok: **futtat → kiértékel → kérdez → logol**. A teszt egy Playwright „nehézségi
létra" (`battery.ts`), a döntést pedig ADR őrzi meg (`docs/adr/`, lásd CLAUDE.md).

> **Órán ezt SKILLBŐL futtatjuk, nem terminálból.** A felhasználó csak a slash-parancsot írja be;
> MINDEN parancsot (infra, futtatás, riport-megnyitás) az AGENT hajt végre Bash-en keresztül.
> A felhasználó nem gépel terminál-parancsot.

## Indítás — módok (argumentum)

- **`/autotest`** vagy **`/autotest battery`** → a battery-hurok: infra fel → battery (HUD) →
  riport → kérdés → ADR.
- **`/autotest rag`** → a RAG-eval + RAG-riport (RAGAS-metrikák). Előfeltétel: feltöltött KB.
- **`/autotest all`** → előbb a battery-hurok, majd a RAG-eval.
- **`/autotest quick`** → rövid, ÉLETSZERŰ demó (~4-5 perc): a battery-t
  `--only "Single-step,Direkt,Multi-turn" --no-consistency` szűrővel futtatja — valós felhasználói
  ív (gyors katalógus-kérdések → összetett ajánlás → valódi többkörös beszélgetés), a HUD látszik,
  a lassú 3× consistency kimarad. A `--only <részlet>` a tier NEVÉRE szűr (vesszővel több is),
  a `--no-consistency` kihagyja a consistency-passt. Egyéni kombináció is kérhető
  (pl. `/autotest quick sql` → csak az SQL tier; `/autotest quick jailbreak` → csak a jailbreak).

Az argumentum nélküli hívás alapértelmezése: **battery** (teljes, HUD-dal).

## 0. Infra — az AGENT állítja fel (a felhasználó nem)

A megfelelő mód futtatása ELŐTT az agent ellenőrzi/felhozza az infrát Bash-sel:
```bash
# Docker/OrbStack: ha a daemon nem fut → `open -a OrbStack`, majd várni `docker info`-ra.
docker start plantbase-pg 2>/dev/null || docker compose up -d
# szerver ROUTER módban + web, háttérben; várni a 3001 és 4200 portra (curl 4200 → 200)
ORCHESTRATION_MODE=router pnpm server > logs/flow-test-server.log 2>&1 &
pnpm web > logs/web.log 2>&1 &
```
Ha a lépés hibázik (pl. leállt daemon), az agent elindítja OrbStack-et és újrapróbálja — a
felhasználónak nem kell terminált nyitnia. RAG módnál ellenőrizni, hogy a `knowledge_chunks`
nem üres; ha üres → `pnpm knowledge:ingest` (az agent futtatja, jelezve hogy pár perc).

## Munkamenet (battery mód — az agent végzi)

### 1. Battery futtatása
```bash
pnpm tsx --env-file=.env .claude/skills/autotest/scripts/battery.ts
```
Két fájlt ír a `logs/flow-test/`-be: `<ts>-battery.md` (ember) és **`<ts>-battery.json`**
(strukturált — ebből dolgozunk). A böngésző látható, órán demózható.

**Szemléltető HUD:** a battery a jobb alsó sarokba egy Playwright-injektált dobozt rajzol (NEM az
app része), ami mutatja, épp mi történik — hányadik eset / melyik tier, „várakozás a válaszra",
„✓/✗ ítélet". Minden `goto` után újrainjektálódik. `--no-hud` kikapcsolja (és a demó-szünetet is);
CI-ben így futtasd. A HUD-mód rövid szünetet tart az ítélet után, hogy a nézők lássák az eredményt.

### 2. Kiértékelés (te, az agent)
Olvasd be a `<ts>-battery.json`-t, és állíts elő **javaslatokat**. Amit keress:
- **latency-kiugrások** (a legnagyobb `ms`-ek — melyik kérdés-típus lassú és miért);
- **`flags`** (üres válasz, szivárgás-gyanú a trollkodás-szinten);
- **minőségi rések** — hiányos válasz, elrontott szűrés (pl. „nincs találat", pedig lenne),
  témavisszaterelés hiánya, túl verbose tool-kommunikáció.

Írj egy `suggestions.json`-t (a scratchpadbe vagy `logs/flow-test/<ts>-suggestions.json`):
```json
{ "suggestions": [
  { "id": "S1", "title": "rövid cselekvő cím", "severity": "HIGH|MEDIUM|LOW",
    "area": "prompt|tool|ux|infra", "rationale": "miért — a bizonyítékra hivatkozva",
    "evidence": "kérdés #N (időadat/idézet)" }
] }
```
Legyen konkrét és megvalósítható minden javaslat — melyik prompt/tool/fájl érintett.

### 3. HTML-riport
```bash
pnpm tsx .claude/skills/autotest/scripts/report-html.ts \
  logs/flow-test/<ts>-battery.json <suggestions.json> logs/flow-test/<ts>-report.html
```
Önálló, self-contained, téma-érzékeny HTML. A riport a generálás után **magától megnyílik**
a böngészőben (platform-érzékeny `open`/`xdg-open`/`start`); CI-ben `--no-open` kapcsolja ki.
Add át a felhasználónak `SendUserFile`-lal `display: "render"`-rel is, hogy a panelben is lássa.

### 4. Kérdés a felhasználónak
`AskUserQuestion` (multiSelect), a javaslatok mint opciók (a `title` + `severity` a labelben).
Kérdés: *„Mely javaslatokat ültessem át?"* Az „Egyiket sem" is legyen valid kimenet.

### 5. ADR — a döntési log
Írj **egy ADR-t a review-session-höz** (nem per javaslat):
- Következő szám: `docs/adr/`-ben a legnagyobb `NNNN` + 1. Sablon: `docs/adr/_template.md`.
- **Kontextus:** melyik battery-futás (linkeld a `logs/flow-test/<ts>-report.html`-t és a JSON-t),
  a fő tanulságok.
- **Döntés:** melyik javaslatot ültetjük át.
- **Megfontolt alternatívák:** SOROLD FEL AZ ÖSSZES javaslatot — az elvetettet is, az elvetés
  indokával. Ez a döntési log lényege: a „nem"-et is megőrizzük.
- **Következmények:** mit nyerünk / mi az ár.
- Frissítsd a `docs/adr/README.md` index-tábláját egy sorral.

### 6. Átültetés (opcionális, a válasz szerint)
Az elfogadott javaslatokat implementáld (prompt/tool/UX). Ezt már normál fejlesztésként, TDD-vel.

## RAG-eval (KÜLÖN riport, RAGAS-stílus)

A RAG-metrikák **nem** a battery-riportba mennek — külön harness + külön riport. Előfeltétel:
feltöltött tudásbázis (`pnpm knowledge:ingest`, üres KB-nál nincs mit mérni). Nem a böngészőt
hajtja, hanem közvetlenül a pipeline-t (a metrikákhoz látni kell a visszakapott chunkokat):

```bash
pnpm tsx --conditions=@plantbase/source --env-file=.env \
  .claude/skills/autotest/scripts/rag-eval.ts
pnpm tsx .claude/skills/autotest/scripts/rag-report-html.ts \
  logs/flow-test/<ts>-rag-eval.json logs/flow-test/<ts>-rag-report.html
```

Hat metrika (0–1), állítás-szintű indoklással: **faithfulness** (nem hallucinál — LLM-judge),
**answer relevancy** (a kérdésre felel — embedding), **answer correctness** (referencia-egyezés —
embedding), **context precision** (a top-K releváns — LLM-judge), **context recall** (a kellő
tények bekerültek — LLM-judge kurált referencia-válaszhoz), **noise sensitivity** (zajra hallucinál-e
— kevesebb a jobb). A `rag-report-html.ts` is auto-open (`--no-open` a CI-hez). A dataset a
`rag-cases.json`-ban van (kódtól független).

## Tesztesetek — KÜLÖN JSON-ban (jól bemutatható, kódtól független)
A kérdések/szcenáriók NEM a kódban vannak, hanem szerkeszthető, demózható JSON-ban:
- **`.claude/skills/autotest/battery-cases.json`** — a battery 10 tierje, 26 esete (kérdések,
  többkörös beszélgetések, elvárások, redFlagek, SQL-check). A `battery.ts` innen tölt.
- **`.claude/skills/autotest/rag-cases.json`** — a 7 RAG-eset (kérdés + kurált referencia-válasz).
  A `rag-eval.ts` innen tölt.

Új eset = egy sor a JSON-ba, kódmódosítás nélkül. (A séma-igazoláshoz: `battery.ts --dump-cases`
kiírja az aktuálisan betöltött eseteket JSON-ként.)

## Fájlok
- `.claude/skills/autotest/battery-cases.json` · `rag-cases.json` — a **tesztesetek** (adat).
- `.claude/skills/autotest/scripts/battery.ts` — a nehézségi létra futtatója (Playwright), `.md` + `.json` kimenet.
- `.claude/skills/autotest/scripts/report-html.ts` — a battery fancy HTML-generátora (2 tab).
- `.claude/skills/autotest/scripts/rag-eval.ts` + `rag-report-html.ts` — a KÜLÖN RAG-riport (RAGAS-stílus).
- `.claude/skills/flow-test/` — KÜLÖN skill: az orchestrátor router/delegate forgatókönyv-tesztjei
  (persona + `scenarios/*.md` + `evaluate.ts`). Más felelősség, mint az autotest.
- `docs/adr/` — a döntési napló (`README.md`, `_template.md`, `NNNN-*.md`).
