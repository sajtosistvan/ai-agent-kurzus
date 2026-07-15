// orchestration-mode.ts — a demó KAPCSOLÓJA. Három érték:
//   off      → a mai viselkedés, változatlanul (sima query-agent) — ez az alapértelmezés,
//   router   → az orchestrator közvetít a két agent között (router-handover.ts),
//   delegate → az agentek egymást hívják toolként (delegate-handover.ts).
// Runtime flag: a szerver KÉRÉSENKÉNT olvassa (getOrchestrationMode()), így a demón a
// flag átállítása + szerver-újraindítás (pnpm server) azonnal vált. Ismeretlen érték = off.

export type OrchestrationMode = 'off' | 'router' | 'delegate';

export function getOrchestrationMode(
  env: NodeJS.ProcessEnv = process.env,
): OrchestrationMode {
  const raw = env['ORCHESTRATION_MODE'];
  if (raw === 'router' || raw === 'delegate') {
    return raw;
  }
  return 'off';
}
