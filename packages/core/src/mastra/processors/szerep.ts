import type { RequestContext } from '@mastra/core/request-context';

// szerep.ts — KI beszél az agenttel. Ez váltja ki a régi `user-role.ts` fájlban élő
// CURRENT_ROLE konstanst: a szerepet többé nem a kódban írjuk át, hanem a HÍVÓ teszi be a
// Mastra RequestContext-be (élesben: a bejelentkezett munkamenetből, session vagy JWT alapján).
//
// Miért nem a felhasználó mondja meg? Mert akkor bármelyik vásárló „adminnak” vallhatná magát
// egy jól megfogalmazott mondattal. A szerep a RENDSZER állítása, nem a beszélgetés tartalma.

export const SZEREPEK = ['customer', 'admin'] as const;
export type Szerep = (typeof SZEREPEK)[number];

/** A RequestContext kulcs, amin a hívó a szerepet átadja. */
export const SZEREP_KULCS = 'szerep';

/**
 * A kérés szerepe. Ha a hívó nem ad meg semmit, a LEGSZŰKEBB jogosultságot feltételezzük —
 * biztonsági beállításnál mindig a szigorúbb legyen az alapértelmezés.
 */
export function olvasSzerep(requestContext?: RequestContext): Szerep {
  const nyers = requestContext?.get(SZEREP_KULCS);
  return nyers === 'admin' ? 'admin' : 'customer';
}

/** Igaz, ha belső munkatárs — csak ő szerkesztheti a katalógust. */
export function belsoMunkatars(szerep: Szerep): boolean {
  return szerep === 'admin';
}
