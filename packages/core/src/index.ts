// A @plantbase/core publikus felülete. A szerkezet a tananyag térképe:
//   mastra/index.ts    — a MASTRA PÉLDÁNY: ide van bekötve minden agent, tool, workflow,
//                        a tárolás, a vektortár, a megfigyelhetőség és a logger
//   mastra/agents/     — KI mit csinál: 1 agent = 1 fájl (instrukciók + toolok + memória +
//                        processzorok). SAJÁT LOOP NINCS: az agent.stream()/generate() a loop
//   mastra/tools/      — MIVEL: 1 tool = 1 fájl (createTool: id + leírás + input/outputSchema),
//                        a hozzávalói (séma, guard, DB-kapcsolat) a tool nevét viselő mappában
//   mastra/workflows/  — determinisztikus lépéssorok, emberi jóváhagyással (suspend/resume)
//   mastra/processors/ — bemeneti szűrők: PII → RBAC → témakör (a sorrend számít)
//   mastra/rag/        — a tudás-oldal: pgvector vektortár + kereső tool
//   config             — a környezet validálása (fail-fast)

// A Mastra példány — minden agent- és toolfutás ehhez tartozik.
export { mastra } from './mastra/index.js';

// Tárolás és memória — a szerver/CLI ezekkel adja meg a beszélgetés-szálat.
export { plantbaseTarolo, plantbaseVektortar } from './mastra/tarolas.js';
export { plantbaseMemoria } from './mastra/memoria.js';

// Agentek — 1 agent = 1 fájl.
export { plantbaseSupervisor } from './mastra/agents/plantbase-supervisor.js';
export { plantbaseQueryAgent } from './mastra/agents/plantbase-query-agent.js';
export { csomagAgent } from './mastra/agents/csomag-agent.js';
export { katalogusAgent } from './mastra/agents/katalogus-agent.js';

// Workflow — a csomag-folyamat emberi jóváhagyási pontja (suspend/resume).
export { csomagWorkflow } from './mastra/workflows/csomag-workflow.js';

// Bemeneti processzorok + a szerepkör (a régi user-role.ts helyett: RequestContext-ből).
export * from './mastra/processors/index.js';

// Toolok — a Mastra tool-réteg (createTool), egy tool = egy fájl + a mellette lévő logika.
// A modell felé látszó nevek: katalogus_sql, ugyfel_lekerdezes, webshop_feed, termek_mentes,
// csomag_ellenorzes, csomag_mentes, csomag_elvetes.
export * from './mastra/tools/index.js';

// RAG — a tudás-oldal Mastra-natívan: PgVector vektortár, MDocument darabolás,
// beágyazás, HyDE, @mastra/rag rerank, és a kereső tool (tudasbazis_kereses).
export * from './mastra/rag/vektortar.js';
export * from './mastra/rag/beagyazas.js';
export * from './mastra/rag/hipotetikus-valasz.js';
export * from './mastra/rag/atrangsorolas.js';
export * from './mastra/rag/tudasbazis-feltoltes.js';
export * from './mastra/rag/tudasbazis-debug.js';
export * from './mastra/rag/tudasbazis-tool.js';

// Konfiguráció
export * from './lib/config.js';
