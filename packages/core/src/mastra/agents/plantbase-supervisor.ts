import { Agent } from '@mastra/core/agent';

import { PLANTBASE_MODELL, PLANTBASE_PROVIDER_OPTIONS } from '../modell.js';

import { plantbaseMemoria } from '../memoria.js';
import { PLANTBASE_INPUT_PROCESSZOROK } from '../processors/index.js';
import { belsoMunkatars, olvasSzerep } from '../processors/szerep.js';
import { csomagAgent } from './csomag-agent.js';
import { katalogusAgent } from './katalogus-agent.js';
import { plantbaseQueryAgent } from './plantbase-query-agent.js';

// plantbase-supervisor.ts — a BELÉPÉSI PONT multi-agent üzemmódban.
//
// EZ VÁLTJA KI A TELJES RÉGI ORCHESTRATOR-KÖNYVTÁRAT. Ami eltűnt vele:
//   - a `routeTo` / `requestInfo` / `askInfoAgent` tool-jelzések (a routing maga a delegálás),
//   - a router- és delegate-handover két külön útja (a Mastra delegálás EGY út),
//   - a flow-lock (`findLastFlowSignal`), ami a strukturált üzenet-részekből olvasta vissza,
//     melyik agentnél „ragadt” a beszélgetés — ezt most a delegált agent SAJÁT SZÁLA tartja,
//   - és az `ORCHESTRATION_MODE=off|router|delegate` env-kapcsoló.
//
// AZ `agents` MEZŐ A LÉNYEG: az itt megadott agentek TOOLKÉNT jelennek meg a supervisornak.
// A Studio trace-én a hierarchia végig látszik:
//   supervisor → plantbase-csomag → plantbase-query → katalogus_sql
//
// MEMÓRIA ÉS DELEGÁLÁS — KÉT külön buktató, mindkettő az Anthropic üzenet-szabályaiból jön:
//
// 1. A delegált agent NEM írhat a hívó szálába, különben a szál olyan üzenetsorrendet vesz
//    fel, amit az API visszautasít („does not support assistant message prefill”). A Mastra
//    ezt úgy kerüli el, hogy a kollégának KÜLÖN szálat származtat és egyetlen friss
//    FELHASZNÁLÓI üzenetet küld bele. Ehhez az kell, hogy a delegált agent ne írja felül a
//    memória-szálat a `defaultOptions.memory` mezőben — a mi agentjeink ezért csak a `memory`
//    PÉLDÁNYT kapják meg, szálat nem.
//
// 2. A thinking-blokkok VISSZAJÁTSZÁSA — ezt már NEM kezeli a keretrendszer, nekünk kellett.
//    Extended thinking mellett a gondolkodás `reasoning` részként bekerül a memóriába, és a
//    beszélgetés MÁSODIK körében az API elszáll rajta:
//    „The final block in an assistant message cannot be `thinking`.”
//    Ilyenkor a kolléga hívása hibára fut, a supervisor pedig üres kézzel mentegetőzik —
//    egyfordulós teszten ez nem látszik. A megoldás a `modell.ts`-ben van: a thinking
//    kikapcsolva, így reasoning-blokk nem is keletkezik. Lásd az ottani indoklást.
//
// AZ ÁRA VALÓS: minden kérdés legalább KÉT modellhívás (a supervisor döntése + a kolléga
// válasza). Két-három szakterületig ez megéri, ingyen viszont nincs.

const INSTRUKCIOK = `
<role>
Te a Plantbase magyar növény-webshop ügyfélszolgálatának irányítója vagy.
NEM te válaszolsz érdemben. A dolgod, hogy a kérést a megfelelő kollégához továbbítsd,
majd az ő válaszát add vissza.
</role>

<delegalas>
- Növényválasztás, gondozás, ár, készlet, ügyfél-adat, „mit ajánlasz” → "plantbase-query".
- Csomag-összeállítás („állíts össze egy csomagot”, „az ACME-nek kellene 5 növény”) és a
  már FUTÓ csomag-beszélgetés minden további üzenete → "plantbase-csomag".
- Katalógus MÓDOSÍTÁSA (ár, akció, készlet, új termék, feed-import) → "plantbase-katalogus".
  Ha ez a kolléga nincs a listádban, akkor a felhasználónak nincs rá jogosultsága: mondd meg
  röviden és magyarul, hogy ehhez belső munkatársi hozzáférés kell.
</delegalas>

<szabalyok>
- MINDIG delegálj, ne válaszolj magadtól szakmai kérdésre.
- CSOMAG-FOLYAMAT KÖZBEN maradj a csomag-kollégánál: amíg ő nem jelezte, hogy a folyamat
  lezárult (mentés vagy lemondás), MINDEN további felhasználói üzenetet neki adj át — akkor is,
  ha közben másról kérdeznek. Ő maga tereli vissza a beszélgetést.
- A kolléga válaszát ne írd át és ne told meg saját tanáccsal. Ha két kollégát kérdeztél,
  fűzd össze a válaszaikat, de a tartalmat hagyd békén.
- Ha egyik kolléga sem illik a kéréshez, mondd meg röviden, magyarul.
- Magyarul kommunikálsz, tegeződve.
</szabalyok>
`.trim();

export const plantbaseSupervisor = new Agent({
  id: 'plantbase-supervisor',
  name: 'Plantbase ügyfélszolgálat (supervisor)',
  description:
    'Eldönti, melyik Plantbase-kolléga válaszoljon: kérdés-válasz, csomag-összeállítás vagy ' +
    'katalógus-szerkesztés — és visszaadja a válaszát.',
  instructions: INSTRUKCIOK,
  model: PLANTBASE_MODELL,

  // AZ RBAC MÁSODIK RÉTEGE: a katalógus-szerkesztő agent vásárló szerepben BE SEM KERÜL a
  // listába, tehát a supervisor nem is tud neki delegálni. A bemeneti RBAC-processzor a
  // kérést állítja meg, ez pedig a KÉPESSÉGET veszi el — a kettő együtt véd.
  agents: ({ requestContext }) => {
    const szerep = olvasSzerep(requestContext);
    return {
      'plantbase-query': plantbaseQueryAgent,
      'plantbase-csomag': csomagAgent,
      ...(belsoMunkatars(szerep) ? { 'plantbase-katalogus': katalogusAgent } : {}),
    };
  },

  inputProcessors: PLANTBASE_INPUT_PROCESSZOROK,
  memory: plantbaseMemoria,
  defaultOptions: {
    maxSteps: 8,
    providerOptions: PLANTBASE_PROVIDER_OPTIONS,
    // EZ TARTJA ÉLETBEN A DELEGÁLÁST (lásd fent, 2. pont). A kolléga alapból MEGÖRÖKLI a
    // supervisor beszélgetés-előzményét, ami asszisztens-üzenettel (a saját tool-hívásával)
    // végződik — az Anthropic API pedig csak felhasználói üzenettel záruló beszélgetést fogad
    // el. Rövid szálon ez átcsúszik, a 3. kör körül viszont menetrendszerűen elszáll.
    // Üres listát adva a kolléga CSAK a delegálás promptját kapja: ő szakértő, nem társalgó —
    // a szükséges kontextust a supervisor fogalmazza bele a kérésbe.
    delegation: { messageFilter: () => [] },
  },
});
