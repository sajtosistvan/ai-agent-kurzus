import type { InputProcessorOrWorkflow } from '@mastra/core/processors';

import { piiSzuro } from './pii-szuro.js';
import { rbacProcesszor } from './rbac-processzor.js';
import { temakorGuardrail } from './temakor-guardrail.js';

export { piiSzuro } from './pii-szuro.js';
export { rbacProcesszor } from './rbac-processzor.js';
export { temakorGuardrail } from './temakor-guardrail.js';
export { SZEREPEK, SZEREP_KULCS, belsoMunkatars, olvasSzerep } from './szerep.js';
export type { Szerep } from './szerep.js';

// A KÖZÖS input-processzor lánc. A SORREND SZÁMÍT, és felülről lefelé fut:
//
//   1. PII-szűrő   — a személyes adat KI SE MENJEN a modellhez. Elöl van, mert így egy
//                    később elutasított kérésből sem marad PII a trace-ben és a memóriában.
//   2. RBAC        — jogosulatlan műveletet meg se nézzünk. Olcsó, determinisztikus tiltás.
//   3. Témakör     — ami eddig eljutott, az legyen növény/webshop téma.
//
// Az olcsó, biztos szűrők elöl; a tiltás ELŐTT maszkolunk. Ha a sorrendet megfordítanád
// (előbb tiltás, utána maszkolás), az elutasított kérések PII-je bekerülne a naplóba.
export const PLANTBASE_INPUT_PROCESSZOROK: InputProcessorOrWorkflow[] = [
  piiSzuro,
  rbacProcesszor,
  temakorGuardrail,
];
