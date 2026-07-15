import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';
import { DONE_MARKER, loadScenario, nextUserMessage, type Turn } from './persona.js';

// run-scenario-browser.ts — Playwright driver a VALÓDI web UI ellen: gépel a chat-inputba,
// DOM-ból olvassa a választ. Órai demó-mód — a futás LÁTHATÓ (headless: false), és mellékesen
// asserteli, hogy a badge / routing-chip / (happy pathnál) a csomag-kártya tényleg megjelent.
// Elvárás: pnpm web fut (4200) és a szerver a tesztelt móddal (3001).

const WEB = process.env['FLOW_TEST_WEB'] ?? 'http://localhost:4200';

async function main(): Promise<void> {
  const [scenarioPath, ...rest] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error('Használat: run-scenario-browser.ts <scenario.md> [--mode router|delegate]');
    process.exit(1);
  }
  const mode = rest[rest.indexOf('--mode') + 1] ?? 'ismeretlen';
  const scenario = loadScenario(scenarioPath);
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  try {
    await page.goto(WEB);
  } catch {
    await browser.close();
    throw new Error(`Nem érem el a web UI-t (${WEB}) — fut a \`pnpm web\`?`);
  }

  const turns: Turn[] = [];
  const uiChecks = { agentBadge: false, routingChip: false, packageSummary: false };

  for (let i = 0; i < scenario.maxTurns; i++) {
    const userText = await nextUserMessage(scenario, turns);
    if (userText.includes(DONE_MARKER)) {
      break;
    }
    console.log(`\n[${i + 1}] FELHASZNÁLÓ: ${userText}`);
    await page.getByPlaceholder('Írd be a kérdésed…').fill(userText);
    await page.keyboard.press('Enter');
    // Válasz-várás: a "gondolkodik…" jelző eltűnéséig (streaming vége).
    await page.getByText('gondolkodik…').waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    await page.getByText('gondolkodik…').waitFor({ state: 'hidden', timeout: 180000 });

    const assistant = (await page.locator('.prose').last().innerText().catch(() => '')) ?? '';
    console.log(`[${i + 1}] ASSZISZTENS: ${assistant.slice(0, 200)}`);
    // UI-render asszertek adatgyűjtése (data-testid-k a 11. feladatból).
    uiChecks.agentBadge ||= (await page.getByTestId('agent-badge').count()) > 0;
    uiChecks.routingChip ||= (await page.getByTestId('routing-chip').count()) > 0;
    uiChecks.packageSummary ||= (await page.getByTestId('package-summary').count()) > 0;
    turns.push({ user: userText, assistant, dataParts: [] });
  }
  await browser.close();

  if (!uiChecks.agentBadge || !uiChecks.routingChip) {
    console.error('UI-ASSERT HIBA: nem jelent meg agent-badge vagy routing-chip — orchestrált módban fut a szerver?');
    process.exitCode = 1;
  }
  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('logs/flow-test', `${stamp}-${basename(scenarioPath, '.md')}-${mode}-browser.json`);
  writeFileSync(file, JSON.stringify({ scenario: scenario.name, mode, expectations: scenario.expectations, turns, uiChecks }, null, 2));
  console.log(`\nTrace mentve: ${file}`);
}

main().catch((error) => {
  console.error(`flow-test (browser) hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
