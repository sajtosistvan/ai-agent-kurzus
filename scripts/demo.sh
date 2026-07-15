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

echo "→ 1/7 Portok felszabadítása (3001, 4200)…"
lsof -ti :3001 -ti :4200 | xargs kill 2>/dev/null || true

echo "→ 2/7 Cache tisztítása (nx reset + dist mappák)…"
pnpm nx reset
rm -rf apps/cli/dist apps/server/dist apps/web/dist packages/core/dist node_modules/.vite

echo "→ 3/7 Függőségek telepítése (lockfile branch-váltásnál változhatott)…"
CI=true pnpm install

echo "→ 4/7 Prisma kliens generálása…"
pnpm prisma generate --schema="$SCHEMA"

echo "→ 5/7 Adatbázis: konténer indítása, migráció, seed…"
docker compose up -d 2>/dev/null || echo "→ DB már fut"
pnpm prisma migrate deploy --schema="$SCHEMA"
pnpm db:seed

echo "→ 6/7 Friss build…"
pnpm build

echo "→ 7/7 szerver (3001) + web (4200) indul — Ctrl+C mindkettőt leállítja"
trap 'kill 0' EXIT INT TERM
pnpm server & pnpm web & wait
