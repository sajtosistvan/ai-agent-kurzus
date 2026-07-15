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
