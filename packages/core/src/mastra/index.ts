import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import {
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';

import { csomagAgent } from './agents/csomag-agent.js';
import { katalogusAgent } from './agents/katalogus-agent.js';
import { plantbaseQueryAgent } from './agents/plantbase-query-agent.js';
import { plantbaseSupervisor } from './agents/plantbase-supervisor.js';
import { katalogusSqlTool } from './tools/katalogus-sql-tool.js';
import { ugyfelLekerdezesTool } from './tools/ugyfel-lekerdezes-tool.js';
import { webshopFeedTool } from './tools/webshop-feed-tool.js';
import { termekMentesTool } from './tools/termek-mentes-tool.js';
import { csomagEllenorzesTool } from './tools/csomag-ellenorzes-tool.js';
import { csomagMentesTool } from './tools/csomag-mentes-tool.js';
import { csomagElvetesTool } from './tools/csomag-elvetes-tool.js';
import { tudasbazisTool } from './rag/tudasbazis-tool.js';
import { csomagWorkflow } from './workflows/csomag-workflow.js';
import {
  csakOlvasoUtScorer,
  hasznossagJudgeScorer,
  katalogusFedettsegScorer,
  magyarValaszScorer,
  ragHivatkozasScorer,
} from './scorers/index.js';
import { plantbaseTarolo, plantbaseVektortar } from './tarolas.js';

// index.ts — A MASTRA PÉLDÁNY, egy helyen. Ez a keretrendszer „gyökere”: ide van bekötve
// minden agent, tool és workflow, a tárolás (mit jegyez meg), a vektortár (mit talál meg),
// a megfigyelhetőség (mit lehet visszanézni) és a logger.
//
// MIÉRT EGY PÉLDÁNY: a Mastra-ban minden agent- és toolfutás EHHEZ tartozik. Innen kapja a
// tool a loggerét (`mastra?.getLogger()`), ide íródnak a trace-ek, és a Studio (`mastra dev`)
// is ezt olvassa. Amit itt nem regisztrálsz, az a Studio-ban sem jelenik meg.
//
// A STACK VÁLTOZATLAN: Postgres + pgvector. A Mastra a saját `mastra_*` tábláit az első
// futáskor maga hozza létre ugyanabban az adatbázisban. Ha nincs DATABASE_URL, a futás megy,
// csak nincs mit visszanézni és nincs memória (lásd tarolas.ts).

const SZOLGALTATAS = 'plantbase';

export const mastra = new Mastra({
  agents: {
    // A belépési pont multi-agent üzemmódban — ő dönti el, ki válaszol.
    plantbaseSupervisor,
    // A három szakértő. Önállóan is futtathatók (Studio, CLI, MCP).
    plantbaseQueryAgent,
    csomagAgent,
    katalogusAgent,
  },

  // A toolok itt is regisztrálva a Studio „Tools” fülén agent nélkül, önmagukban futtathatók.
  tools: {
    katalogusSqlTool,
    tudasbazisTool,
    ugyfelLekerdezesTool,
    webshopFeedTool,
    termekMentesTool,
    csomagEllenorzesTool,
    csomagMentesTool,
    csomagElvetesTool,
  },

  // Nulla modellhívás, viszont emberi jóváhagyási pont (suspend/resume).
  workflows: { csomagWorkflow },

  // Itt regisztrálva a scorerek a Studio „Scorers” fülén is megjelennek. Hogy MELYIK agent
  // MIT mér, az az agent `scorers` mezőjében dől el (query: teljes készlet, írók: NFR1 nélkül).
  scorers: {
    magyarValasz: magyarValaszScorer,
    katalogusFedettseg: katalogusFedettsegScorer,
    ragHivatkozas: ragHivatkozasScorer,
    csakOlvasoUt: csakOlvasoUtScorer,
    hasznossagJudge: hasznossagJudgeScorer,
  },

  // A szálak, üzenetek, working memory, trace-ek és pontszámok tárolója.
  ...(plantbaseTarolo ? { storage: plantbaseTarolo } : {}),

  // A vektortár: a tudásbázis ÉS a memória szemantikus felidézése ugyanazon a pgvectoron.
  ...(plantbaseVektortar ? { vectors: { plantbase: plantbaseVektortar } } : {}),

  // Enélkül a Studio „Traces” füle üres marad. Tároló nélkül nincs hova exportálni, ezért
  // akkor kihagyjuk. A SensitiveDataFilter azért kell, hogy PII ne kerüljön a trace-be —
  // ez a PII-szűrő processzor párja a kimeneti oldalon.
  ...(plantbaseTarolo
    ? {
        observability: new Observability({
          configs: {
            default: {
              serviceName: SZOLGALTATAS,
              exporters: [new MastraStorageExporter()],
              spanOutputProcessors: [new SensitiveDataFilter()],
            },
          },
        }),
      }
    : {}),

  logger: new PinoLogger({ name: SZOLGALTATAS, level: 'info' }),
});
