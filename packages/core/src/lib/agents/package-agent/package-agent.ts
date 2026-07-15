import type { ToolSet } from 'ai';
import {
  runAgentLoop,
  type AskOptions,
  type AskResult,
} from '../agent-loop.js';
import type { ToolReporter } from '../../tools/tool-outcome.js';
import type { PackagePlan } from '../../tools/validate-package/package-plan.js';
import { buildPackagePrompt } from './package-prompt.js';
import { queryCustomersTool } from '../../tools/query-customers/query-customers-tool.js';
import { validatePackageTool } from '../../tools/validate-package/validate-package-tool.js';
import { savePackageTool } from '../../tools/save-package/save-package-tool.js';
import { cancelPackageTool } from '../../tools/cancel-package/cancel-package-tool.js';
import { requestInfoTool } from '../../tools/request-info/request-info-tool.js';
import { askInfoAgentTool } from '../../tools/ask-info-agent/ask-info-agent-tool.js';

// package-agent.ts — a CSOMAG-ÖSSZEÁLLÍTÓ agent. Egy agent = prompt + toolok + loop.
// NINCS saját runSql-je: adatot az info-agenttől kér — a MÓD dönti el, hogyan:
//   router   → requestInfo  (üres execute; az orchestrator közvetíti a kérdést)
//   delegate → askInfoAgent (az execute MAGA futtatja az info-agent loopját)
// Ugyanaz a tool-felület, csak az execute más — ez a két orchestration-mód kontrasztja.

export type PackageHandoverMode = 'router' | 'delegate';

export interface PackageAskOptions extends AskOptions {
  mode: PackageHandoverMode;
  /** Router mód: a requestInfo toollal rögzített adat-kérdés ide érkezik. */
  onRequestInfo?: (question: string) => void;
  /** Sikeres validatePackage → a strukturált csomagterv (data-package part lesz belőle). */
  onPlan?: (plan: PackagePlan) => void;
  /** Delegate mód: a beágyazott info-agent tool-eseményei (a UI behúzva rajzolja). */
  onNestedToolEvent?: ToolReporter;
}

export function buildPackageToolset(
  options: PackageAskOptions,
  report?: ToolReporter,
): ToolSet {
  return {
    queryCustomers: queryCustomersTool(report),
    validatePackage: validatePackageTool(report, { onPlan: options.onPlan }),
    savePackage: savePackageTool(report),
    cancelPackage: cancelPackageTool(report),
    // A MÓDFÜGGŐ kapocs — a toolset többi része azonos.
    ...(options.mode === 'router'
      ? { requestInfo: requestInfoTool(report, { onRequestInfo: options.onRequestInfo }) }
      : {
          askInfoAgent: askInfoAgentTool(report, {
            print: options.print,
            onToolEvent: options.onNestedToolEvent,
          }),
        }),
  };
}

export async function askPackageAgent(
  question: string,
  options: PackageAskOptions,
): Promise<AskResult> {
  const trimmed = question.trim();
  if (trimmed === '') {
    throw new Error('Üres üzenettel nem lehet csomagot összeállítani.');
  }
  return runAgentLoop(
    trimmed,
    {
      systemPrompt: buildPackagePrompt(options.mode),
      buildTools: (report): ToolSet => buildPackageToolset(options, report),
      // A flow hosszú lehet: ügyfél-lekérdezés + adat-kérés + validálás + mentés egy körben is.
      maxSteps: 10,
      maxOutputTokens: 2500,
      emptyAnswer:
        'Nem sikerült befejezni a lépést a megengedett körszámon belül. Folytassuk: melyik feltételnél tartottunk?',
    },
    options,
  );
}
