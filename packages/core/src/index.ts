// A @plantbase/core publikus felülete. A szerkezet a tananyag térképe:
//   agents/ — KI mit csinál: a két agent (query, ingest) + a közös agent-loop
//   tools/  — MIVEL: egy tool = egy fájl (leírás + séma + szigorú validáció + execute)
//   trace   — MEGFIGYELHETŐSÉG: az élő színes nyom + JSON log
//   config  — a környezet validálása (fail-fast)

// Agentek (egy agent = prompt + toolok + loop)
export * from './lib/agents/agent-loop.js';
export * from './lib/agents/query-agent.js';
export * from './lib/agents/query-prompt.js';
export * from './lib/agents/ingest-agent.js';
export * from './lib/agents/ingest-prompt.js';

// Toolok (egy tool = egy fájl)
export * from './lib/tools/tool-outcome.js';
export * from './lib/tools/run-sql.js';
export * from './lib/tools/get-client-preferences.js';
export * from './lib/tools/fetch-feed.js';
export * from './lib/tools/upsert-product.js';

// A toolok háttere: guard, DB-kapcsolatok, feed-kliens, termék-séma
export * from './lib/tools/sql-guard.js';
export * from './lib/tools/db-readonly.js';
export * from './lib/tools/db-readwrite.js';
export * from './lib/tools/shopify-feed.js';
export * from './lib/tools/product-schema.js';

// Megfigyelhetőség + konfiguráció
export * from './lib/trace.js';
export * from './lib/config.js';

export * from './lib/echo.js';
