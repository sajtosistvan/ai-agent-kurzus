#!/usr/bin/env bash
#
# demo.sh — friss-indító script branch-váltás után
#
# Mi ez: branch-váltás vagy órai demózás után előfordulhat, hogy egy másik
# branch-ről ottmaradt dev-szerver fut a fix portokon (3001 szerver, 4200 web),
# vagy stale build/cache miatt a böngésző régi kódot mutat. Ez a script EGY
# paranccsal determinisztikusan az aktuális branch kódját indítja el: leállítja
# az ottmaradt processzeket, kitakarítja a cache-t/build outputot, friss
# függőségeket és Prisma klienst húz, migrál+seedel, buildel, majd elindítja a
# szervert és a webet.
#
# Mikor használd: branch-váltás után, óra közben, amikor "valamiért nem a mostani
# kód fut" a böngészőben.
#
# Ctrl+C mindkét folyamatot (szerver + web) leállítja.

set -euo pipefail
cd "$(dirname "$0")/.."

SCHEMA="packages/db/prisma/schema.prisma"

echo "→ 1/9 Portok felszabadítása (3001, 4200)…"
lsof -ti :3001 -ti :4200 | xargs kill 2>/dev/null || true

echo "→ 2/9 Cache tisztítása (nx reset + dist mappák)…"
pnpm nx reset
rm -rf apps/cli/dist apps/server/dist apps/web/dist packages/core/dist node_modules/.vite

echo "→ 3/9 Függőségek telepítése (lockfile branch-váltásnál változhatott)…"
CI=true pnpm install

echo "→ 4/9 Prisma kliens generálása…"
pnpm prisma generate --schema="$SCHEMA"

echo "→ 5/9 Adatbázis: konténer indítása, migráció, seed…"
docker compose up -d 2>/dev/null || echo "→ DB már fut"
pnpm prisma migrate deploy --schema="$SCHEMA"
pnpm db:seed

# A vektor DB (knowledge_chunks) NEM a seed része: az embeddingek OpenAI-hívásból
# születnek (pénz + idő + kulcs), ezért nem akarjuk minden demónál újraépíteni.
# A perzisztens Postgres-volume miatt a chunkok túlélik a demót — csak akkor kell
# ingestelni, ha a tábla ÜRES (friss volume, db:reset, új gép). Ezt itt ellenőrizzük.
echo "→ 6/9 Tudásbázis (vektor DB): feltöltés, ha üres…"
KNOWLEDGE_COUNT=$(docker compose exec -T postgres \
  psql -U plantbase -d plantbase -tAc \
  'SELECT count(*) FROM knowledge_chunks' 2>/dev/null | tr -d '[:space:]' || echo 0)
if [ "${KNOWLEDGE_COUNT:-0}" -gt 0 ]; then
  echo "→ Tudásbázis már feltöltve ($KNOWLEDGE_COUNT chunk) — kihagyás."
else
  echo "→ Üres tudásbázis — ingest indul (OpenAI-embedding, ez eltarthat egy percig)…"
  pnpm knowledge:ingest
fi

echo "→ 7/9 Friss build…"
pnpm build

# Az MCP-szervert nem MI indítjuk el tartósan: stdio-transporton a HOST (Claude Desktop /
# Claude Code) pörgeti fel, amikor csatlakozik. Amit itt teszünk, az a két dolog, ami demó
# előtt számít: BEMELEGÍTÉS (az első indítás tsx-fordítással megy, a Desktop 60 s-nál
# timeoutol) és ELLENŐRZÉS (ha a DB áll vagy elcsúszott egy tool, itt derüljön ki, ne óra
# közben). Modellt nem hív, tehát nem kerül tokenbe.
echo "→ 8/9 MCP-szerver bemelegítése és ellenőrzése…"
pnpm mcp:smoke

echo "→ 9/9 szerver (3001) + web (4200) indul — Ctrl+C mindkettőt leállítja"
echo "   web: http://localhost:4200 (a web log fájlba megy: logs/web.log)"
echo "   a terminálban CSAK a szerver agent-trace-e látszik — másik terminálban: tail -f logs/agent.log"
trap 'kill 0' EXIT INT TERM
# A web kimenete fájlba megy, hogy a Vite-log ne keveredjen a színes agent-trace-be.
mkdir -p logs
pnpm web > logs/web.log 2>&1 &
pnpm server & wait
