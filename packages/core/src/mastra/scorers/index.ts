import type { MastraScorers } from '@mastra/core/evals';

import { csakOlvasoUtScorer } from './csak-olvaso-ut-scorer.js';
import { hasznossagJudgeScorer } from './hasznossag-judge-scorer.js';
import { katalogusFedettsegScorer } from './katalogus-fedettseg-scorer.js';
import { magyarValaszScorer } from './magyar-valasz-scorer.js';
import { ragHivatkozasScorer } from './rag-hivatkozas-scorer.js';

// A Plantbase scorer-készlete (evals). Négy determinisztikus + egy LLM-judge scorer.
//
// A determinisztikusak minden futásra lefutnak (rate: 1) — nincs modellhívásuk, ingyen vannak.
// A judge csak minden ötödik futásra (rate: 0.2), mert az EXTRA modellhívás minden válasznál.
// Az eredmény a Mastra Studio „Scores” fülén és a PostgresStore-ban látszik.

export {
  csakOlvasoUtScorer,
  hasznossagJudgeScorer,
  katalogusFedettsegScorer,
  magyarValaszScorer,
  ragHivatkozasScorer,
};

/** A kérdés-válasz (query / info) agent teljes mércéje — beleértve az NFR1-ellenőrzést. */
export const PLANTBASE_SCORERS: MastraScorers = {
  magyarValasz: { scorer: magyarValaszScorer, sampling: { type: 'ratio', rate: 1 } },
  katalogusFedettseg: { scorer: katalogusFedettsegScorer, sampling: { type: 'ratio', rate: 1 } },
  ragHivatkozas: { scorer: ragHivatkozasScorer, sampling: { type: 'ratio', rate: 1 } },
  csakOlvasoUt: { scorer: csakOlvasoUtScorer, sampling: { type: 'ratio', rate: 1 } },
  hasznossagJudge: { scorer: hasznossagJudgeScorer, sampling: { type: 'ratio', rate: 0.2 } },
};

/**
 * Író agenteknek (katalógus-szerkesztő, csomag-agent): ugyanaz, de az NFR1-scorer NÉLKÜL —
 * ott az írás a feladat, a `csak-olvaso-ut` scorer értelmetlenül 0-t adna.
 */
export const PLANTBASE_IRO_SCORERS: MastraScorers = {
  magyarValasz: { scorer: magyarValaszScorer, sampling: { type: 'ratio', rate: 1 } },
  katalogusFedettseg: { scorer: katalogusFedettsegScorer, sampling: { type: 'ratio', rate: 1 } },
  hasznossagJudge: { scorer: hasznossagJudgeScorer, sampling: { type: 'ratio', rate: 0.2 } },
};
