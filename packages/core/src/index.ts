// A @plantbase/core publikus felülete. A szerkezet a tananyag térképe:
//   agents/ — KI mit csinál: minden agent saját könyvtárban (agent + promptja);
//             a KÖZÖS agent-loop eggyel kintebb (agents/agent-loop.ts)
//   tools/  — MIVEL: minden tool saját könyvtárban, MINDEN hozzávalójával
//             (séma, guard, DB-kapcsolat, kliens); a KÖZÖS ToolOutcome eggyel kintebb
//   trace   — MEGFIGYELHETŐSÉG: az élő színes nyom + JSON log
//   config  — a környezet validálása (fail-fast)

// A közös agent-loop (egy agent = prompt + toolok + loop)
export * from './lib/agents/agent-loop.js';

// Agentek — saját könyvtárban
export * from './lib/agents/query-agent/query-agent.js';
export * from './lib/agents/query-agent/query-prompt.js';
export * from './lib/agents/ingest-agent/ingest-agent.js';
export * from './lib/agents/ingest-agent/ingest-prompt.js';

// A közös tool-eredmény alak
export * from './lib/tools/tool-outcome.js';

// Toolok — saját könyvtárban, minden hozzávalóval
export * from './lib/tools/run-sql/run-sql-tool.js';
export * from './lib/tools/run-sql/sql-guard.js';
export * from './lib/tools/run-sql/db-readonly.js';
export * from './lib/tools/get-client-preferences/get-client-preferences-tool.js';
export * from './lib/tools/fetch-feed/fetch-feed-tool.js';
export * from './lib/tools/fetch-feed/shopify-feed.js';
export * from './lib/tools/upsert-product/upsert-product-tool.js';
export * from './lib/tools/upsert-product/product-schema.js';
export * from './lib/tools/upsert-product/db-readwrite.js';

// Ki beszél az agenttel: szerep-alapú képesség-kapcsolás (customer / admin)
export * from './lib/user-role/user-role.js';

// Megfigyelhetőség + konfiguráció
export * from './lib/trace.js';
export * from './lib/config.js';

export * from './lib/echo.js';
