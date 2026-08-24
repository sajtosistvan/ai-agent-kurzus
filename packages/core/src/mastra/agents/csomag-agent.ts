import { Agent } from '@mastra/core/agent';

import { PLANTBASE_MODELL, PLANTBASE_PROVIDER_OPTIONS } from '../modell.js';

import { PLANTBASE_INPUT_PROCESSZOROK } from '../processors/index.js';
import { PLANTBASE_IRO_SCORERS } from '../scorers/index.js';
import { csomagEllenorzesTool } from '../tools/csomag-ellenorzes-tool.js';
import { csomagMentesTool } from '../tools/csomag-mentes-tool.js';
import { csomagElvetesTool } from '../tools/csomag-elvetes-tool.js';
import { plantbaseQueryAgent } from './plantbase-query-agent.js';

// csomag-agent.ts — a CSOMAG-ÖSSZEÁLLÍTÓ agent: 4-5 irányított kérdéssel állít össze
// növénycsomagot, majd összesítő + KIFEJEZETT megerősítés után ment.
//
// NINCS saját katalógus-hozzáférése (nincs katalogus_sql toolja). Termék-tényt a
// kérdés-válasz agenttől kér — Mastra SUB-AGENT delegálással (`agents` mező). Ez váltja ki a
// régi `askInfoAgent` / `requestInfo` tool-jelzéseket: nem mi írunk kézi handover-kódot, a
// delegálás maga a keretrendszer. A Studio trace-én ez szépen kirajzolódik:
//   supervisor → csomag-agent → plantbase-query → katalogus_sql
//
// A KAPUK a toolokban vannak, nem a promptban: a csomag_ellenorzes determinisztikusan validál
// (készlet, pet/kid-safe, szint, kemény keret-korlát), a csomag_mentes pedig mentés előtt
// ÚJRA validál. A prompt terel, a tool kényszerít.

const INSTRUKCIOK = `
<role>
Te a Plantbase CSOMAG-ÖSSZEÁLLÍTÓ asszisztense vagy: egy lakberendező ügyfeleinek állítasz
össze növénycsomagot 4-5 irányított kérdéssel. Magyarul beszélsz, tömören és barátságosan.
</role>

<flow>
EGYSZERRE EGY kérdést tegyél fel, ebben a sorrendben:
1. ÜGYFÉL: kérd el az ügyfélkódot vagy nevet, és a „plantbase-query” kollégától kérd le a
   profilját (keret, szint, pet/kid-safe, jegyzet).
2-4. MÉRET, FÉNYIGÉNY, PET/KID-SAFE, DARABSZÁM: a betöltött preferenciákból ELŐTÖLTÖTT
   javaslatot adj („a keret 250 000 Ft és kezdő szint — maradjunk ennél?”) — a felhasználó
   felülbírálhat.
5. Ha minden feltétel megvan: kérd le a szóba jöhető termékeket (azonosító, név, ár, készlet,
   fényigény, méret) a „plantbase-query” kollégától, állíts össze csomagtervet, és futtasd a
   csomag_ellenorzes toolt.
</flow>

<data>
NINCS közvetlen adatbázis-hozzáférésed. MINDEN termék- és ügyfél-tényt (azonosítók, árak,
készlet, keret, fényigény) a „plantbase-query” agenttől kérj el, konkrét kérdéssel.
Terméket, árat, készletet, azonosítót KITALÁLNI TILOS.
</data>

<gates>
- csomag_ellenorzes: MINDEN csomagtervet validálj, mielőtt megmutatod. Ha hibát ad (kevés
  találat, keret-túllépés), lépj vissza: ajánlj feltétel-lazítást vagy kevesebb darabot,
  és validálj újra.
- SIKERES validálás után mutasd meg az összesítőt, és tedd fel a záró kérdést:
  „Ez így rendben van?”. A mentés NEM automatikus.
- csomag_mentes: KIZÁRÓLAG a felhasználó kifejezett megerősítése UTÁN. Módosítás-kérésnél
  vissza a kérdezgetésbe (új validálás új összesítőt ad).
- Sikeres mentés után adj VÉGLEGES visszajelzést: csomag-azonosító, összár, tételek egy
  mondatban. Ezzel a folyamat lezárult.
</gates>

<exit>
A folyamatból PONTOSAN két út vezet ki, mindkettő tool-hívás:
- a felhasználó kifejezetten lemond → csomag_elvetes;
- megerősített mentés → csomag_mentes.
Ha a felhasználó menet közben MÁSRÓL kezd beszélni, kedvesen tereld vissza („szívesen
válaszolok utána — előbb fejezzük be a csomagot: …”), és ismételd meg az aktuális kérdést.
NE zárd le a folyamatot jelzés nélkül.
</exit>
`.trim();

export const csomagAgent = new Agent({
  id: 'plantbase-csomag',
  name: 'Plantbase csomag-összeállító',
  description:
    'Növénycsomagot állít össze irányított kérdésekkel: ügyfél-keret, méret, fény, ' +
    'pet/kid-safe, darabszám — majd validálás és megerősítés után menti.',
  instructions: INSTRUKCIOK,
  model: PLANTBASE_MODELL,
  tools: {
    csomag_ellenorzes: csomagEllenorzesTool,
    csomag_mentes: csomagMentesTool,
    csomag_elvetes: csomagElvetesTool,
  },
  // Az adat-oldal: a kérdés-válasz agent TOOLKÉNT. A régi kézi handover helyett egy mező.
  agents: { 'plantbase-query': plantbaseQueryAgent },
  inputProcessors: PLANTBASE_INPUT_PROCESSZOROK,
  // MEMORY SZÁNDÉKOSAN NINCS — lásd plantbase-supervisor.ts, 2. pont. Delegált agentként
  // a hívó üzenetlistáját örökölné, ami asszisztens-üzenettel végződik; az Anthropic API ezt
  // elutasítja („does not support assistant message prefill”). A szálat a supervisor tartja,
  // a szükséges kontextust a delegálás promptja hozza.
  // Az ÍRÓ mérce: a csomag_mentes ír, tehát az NFR1-scorer itt sem értelmes.
  scorers: PLANTBASE_IRO_SCORERS,
  // A folyamat hosszú lehet: ügyfél-lekérdezés + adat-kérés + validálás + mentés egy körben is.
  defaultOptions: { maxSteps: 12, providerOptions: PLANTBASE_PROVIDER_OPTIONS },
});
