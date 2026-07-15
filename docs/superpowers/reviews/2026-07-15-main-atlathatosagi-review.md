# Main branch — szemléltetési és átláthatósági review

**Dátum:** 2026-07-15 · **Vizsgált állapot:** main @ 628bc43 · **Módszer:** 3 párhuzamos
review-agent (core / apps / db+skillek+docs), minden forrásfájl átnézve.

## Összkép

A kód maga jó állapotban van a tanítási célhoz: nincs túlméretes fájl (legnagyobb a
`trace.ts`, 353 sor), a `*-tool.ts / *-agent.ts / *-prompt.ts` naming következetes, a magyar
„miért"-kommentek többsége tankönyvi, a rétegezés (vékony CLI/server a core fölött) átlátható.
**A fő gondok nem a kód olvashatóságában vannak, hanem három másik helyen: (1) a dokumentáció
elcsúszott a kódtól, (2) egy hardcode kiüti a fő multi-agent tanítási pontot, (3) a gyökérben
verziókövetett szemét van.** Plusz megvan a branch-váltásos „régi verzió fut" rejtély
legvalószínűbb oka.

---

## MAGAS — órán félrevezet, javítandó

### M1. A doksik rossz agent-technológiát tanítanak
`README.md:20-21,29,51`, `docs/architektura.md:24`, `docs/stack.md` mind ezt írja: *„Anthropic
SDK fölé épülő, kézzel írt tool-use loop"*. A valóság: **Vercel AI SDK 6** (`generateText` +
`stopWhen`). A CLAUDE.md már helyes — azt kell átvezetni a README/architektura/stack fájlokba.

### M2. A RAG-réteg és a server/web app hiányzik a fő doksikból
`docs/architektura.md:15` még azt mondja: *„Később (NEM most): apps/api, apps/web"* — miközben
mindkettő létezik, ahogy a `knowledge_chunks` tábla, a pgvector, a `seed/knowledge/` (~200 cikk)
és a `knowledge:ingest` is. A README projektstruktúrája sem említi őket.

### M3. `query-agent.ts:42` — a hardcode-olt `admin = false` kiüti a multi-agent demót
A fájl kommentje (14-24. sor) azt tanítja, hogy admin szerep megkapja a `delegateToIngest`
toolt — de a `role`-t felülírja egy fix `admin = false`, így a tool SOHA nincs bekötve, és a
97 soros `delegate-to-ingest-tool.ts` halott kód a futó appban. Ráadásul a prompt
(`query-prompt.ts:11`) a VALÓDI role-lal épül: admin role esetén a prompt leírja a toolt, ami
nincs ott. **Vagy vissza `isAdmin(role)`-ra, vagy a kommentet a valósághoz igazítani — és a
prompt+toolset egy forrásból épüljön.** (Az orchestrator-demónak ez az alapja, előtte rendbe
kell tenni.)

### M4. `apps/server/src/main.ts:24-31` — elavult fejléckomment
A komment még a régi `TextStreamChatTransport` / text-plain világot magyarázza, a kód alatta már
`pipeUIMessageStreamToResponse` + typed tool-partok. Tanító repóban a komment a tananyag.

### M5. Verziókövetett szemét a gyökérben
Commitolva: `.playwright-mcp/` (6 debug-dump), `embed-demo.json`, `postman/`,
`railpack.*.json`. Oka részben a `.gitignore` elrontott utolsó sora (két minta egy sorba
ragadva: `vitest.config.*.timestamp*.playwright-mcp/`). → `git rm -r --cached` + a sor
kettébontása.

### M6. A branch-váltásos „régi verzió fut" fő oka: worktree port-csapda
4 aktív checkout van ugyanabból a repóból, fix portokkal (szerver 3001, web 4200 + proxy).
Ha egy MÁSIK worktree-ből indított dev-szerver fut, a böngésző a 4200-on egy másik branch
kódját mutatja — pont a tapasztalt tünet. Másodlagos gyanúsítottak: lemezen maradt `apps/*/dist`
(Jul 13-i), Vite dep-cache, nx cache. A `tsx` source-condition útvonal (cli/server/web dev)
önmagában mindig friss. → A tervezett `pnpm demo` scriptnek pont ezeket kell kezelnie:
port-kill (3001, 4200), `nx reset`, dist + `.vite` törlés, friss indítás.

---

## KÖZEPES — olvashatóságot rontja

- **K1.** `packages/core/.../chunk.ts:55` — nem létező `knowledge-document.ts`-re hivatkozik
  (a valódi hívó: `apps/cli/src/ingest-knowledge.ts`).
- **K2.** ANSI-színezés kétféleképp: a `trace.ts` tiszta `c.cyan()` helperrel, a `retrieve.ts`
  nyers `\x1b[36m` escape-ekkel. → közös szín-helper.
- **K3.** `trace.ts` (353 sor) négy felelősség egy fájlban (színek, watch-log, Trace osztály,
  üzenet-render). → a render-réteg kiemelése `trace-render.ts`-be.
- **K4.** `echo.ts` — halott kód elavult kommenttel („a CLI ezt hívja" — már nem). Törlés vagy
  „történelmi állványzat" jelölés.
- **K5.** `apps/cli/src/ingest-knowledge.ts:113` — a diáknak szánt súgó rossz portot ír
  (3000 → 3001).
- **K6.** `App.tsx:72-114` — sűrű render-blokk: side-effect `console.log`, szűrés, háromszoros
  `as` cast egyben. → `splitAssistantParts()` segéd + szűk `ToolUIPart` típus.
- **K7.** `seed/plants.ts` bitre azonos a `packages/db/prisma/plants.ts`-szel — két
  igazságforrás. → a gyökér `seed/` törlése vagy explicit „starter-kit" jelölés.
- **K8.** `docs/` keveri a kanonikus doksikat a generált anyagokkal (convention-audit-report,
  superpowers plans/specs). → `docs/archive/` vagy külön jelölés.
- **K9.** README „hasznos scriptek" táblája hiányos (`server`, `web`, `knowledge:ingest` nincs
  benne); a fázis-narratíva nem említi a RAG-réteget.

## ALACSONY — szépészeti

- `retrieve.ts:46` `logHits` trükkös `'score' in hit` + cast → union típus tisztább.
- Tool-boilerplate duplikáció (safeParse+try/catch minden toolban) — **tudatos, tanításban jó,
  NE absztraháljuk el.**
- `apps/web/src/lib/utils.ts` — semmitmondó név (csak `cn()` van benne; shadcn-konvenció).
- `message-scroller.tsx:125-127` — nem használt exportok.
- `App.tsx:75` — `console.log` render közben (szándékos demó-debug, jelölni vagy useEffect-be).

---

## Megtartandó pozitívumok

- „Egy tool = egy mappa", never-throw execute, `ToolOutcome` — mindenhol tartva.
- A read/write szétválasztás három rétege (RO szerep + sql-guard + READ ONLY tranzakció) tiszta.
- A db-séma, a seed és a skill-szkriptek komment-minősége példaértékű.
- Fájlméretek: 28 core-fájl / 2740 sor, appok ~1380 sor — nincs monstre fájl.

## Javasolt sorrend (egyszerűen)

1. **M3** (admin-holtág + prompt↔toolset egy forrásból) — az orchestrator-demó előfeltétele.
2. **M6** (port-csapda + `pnpm demo` script) — a demó-megbízhatóság alapja.
3. **M1+M2+M4** (doksi-szinkron egy menetben: README, architektura, stack, server-fejléc).
4. **M5** (gyökér-takarítás + .gitignore-javítás) — 10 perc, nagy jólfésültség-nyereség.
5. K1-K9 szemezgetve, akár az orchestrator-branch részeként, ahol útba esik.
