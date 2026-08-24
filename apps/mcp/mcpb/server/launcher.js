// launcher.js — az MCPB-csomag belépési pontja.
//
// MI EZ: a Claude Desktop az Extension-öket egy fájlból telepíti, és stdio-n indítja őket.
// Ez a launcher NEM tartalmazza a szervert — a repóban lévő, ÉLŐ forrást indítja el tsx-szel,
// és összekapcsolja a saját stdin/stdout-jával (`stdio: 'inherit'`), így a JSON-RPC forgalom
// közvetlenül átfolyik rajta.
//
// MIÉRT ÍGY: egy "igazi", terjeszthető MCPB mindent becsomagolna (a szervert, a node_modules-t,
// a Prisma-kliens natív motorját). Nekünk demóra pont az ELLENKEZŐJE kell: a kódot ÉLŐBEN
// szerkesztjük, és a következő tool-hívás már az új kódot futtassa. Ez tehát egy DEV-csomag —
// a repót feltételezi a gépen. Terjesztéshez esbuild-bundle + vendorolt node_modules kellene.
//
// A repo útját a felhasználó a TELEPÍTÉSKOR adja meg (user_config.repoDir → mappaválasztó
// a Desktop felületén), és a manifest ezt adja át PLANTBASE_REPO env-ként.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.env.PLANTBASE_REPO;

if (!repo || repo.trim() === '') {
  process.stderr.write(
    'plantbase-mcpb: nincs megadva a repo útja. Nyisd meg a Beállítások → Extensions → ' +
      'Plantbase panelt, és válaszd ki az ai-agent-kurzus mappát.\n',
  );
  process.exit(1);
}

const tsxCli = join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = join(repo, 'apps', 'mcp', 'src', 'main.ts');

for (const [label, path] of [
  ['a repo mappája', repo],
  ['a tsx (futott már `pnpm install`?)', tsxCli],
  ['az MCP-szerver forrása', entry],
]) {
  if (!existsSync(path)) {
    process.stderr.write(`plantbase-mcpb: nem található ${label}: ${path}\n`);
    process.exit(1);
  }
}

// stdio: 'inherit' — a gyerek KÖZVETLENÜL a mi csatornáinkon beszél a hosttal. Nincs másolás,
// nincs pufferelés, és nem tudunk véletlenül beleírni a protokollba.
const child = spawn(
  process.execPath,
  [tsxCli, '--conditions=@plantbase/source', entry],
  { cwd: repo, stdio: 'inherit' },
);

child.on('error', (error) => {
  process.stderr.write(`plantbase-mcpb: nem indult el a szerver — ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});

// A host SIGTERM-mel állít le minket — adjuk tovább, hogy a DB-kapcsolatok is záruljanak.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => child.kill(sig));
}
