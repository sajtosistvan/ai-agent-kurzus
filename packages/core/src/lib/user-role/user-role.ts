// user-role.ts — KI beszél az agenttel: vásárló (customer) vagy belső munkatárs (admin).
// A szerep KÉPESSÉGET kapcsol: adminként a query-agent megkapja a delegateToIngest toolt,
// amellyel átadhat egy katalógus-módosítást az ingest-agentnek (ez a multi-agent kapocs).
// Vásárlóként ez a tool nincs a kezében — csak olvasni tud a katalógusból.
//
// DEMO: élőben ezt a CURRENT_ROLE konstanst írod át (customer ↔ admin), és újrafuttatod a CLI-t.
// A `pnpm cli` a TypeScript forrást futtatja (source condition), így a módosítás azonnal hat,
// build nélkül — a trace `tools: [...]` sorában rögtön látszik, hogy admin esetén megjelenik a
// delegateToIngest tool.

export const USER_ROLES = ['customer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Az aktuális szerep. Élőben EZT írod át demózáshoz. */
export const CURRENT_ROLE: UserRole = 'customer';

/** Igaz, ha a szerep belső munkatárs — adminként több toolt (delegateToIngest) kap az agent. */
export function isAdmin(role: UserRole = CURRENT_ROLE): boolean {
  return role === 'admin';
}
