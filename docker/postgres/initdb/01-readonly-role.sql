-- Plantbase — READ-ONLY szerepkör az agent runSql-jéhez (NFR1).
-- A docker-entrypoint ezt a POSTGRES_USER (plantbase) néven, a POSTGRES_DB-n futtatja,
-- a Postgres első indulásakor (üres adatkönyvtár). A products tábla ekkor még NEM létezik,
-- azt a Prisma migráció hozza létre később — ezért az ALTER DEFAULT PRIVILEGES a kulcs.

CREATE ROLE plantbase_ro WITH LOGIN PASSWORD 'plantbase_ro';

-- Csatlakozás + olvasás a public sémában.
GRANT CONNECT ON DATABASE plantbase TO plantbase_ro;
GRANT USAGE ON SCHEMA public TO plantbase_ro;

-- A már létező táblákra (induláskor nincs még) SELECT.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO plantbase_ro;

-- A jövőben a plantbase (RW) által létrehozott táblákra (Prisma migráció) automatikus SELECT,
-- de SEMMI más (nincs INSERT/UPDATE/DELETE/DDL) — így a kapcsolat valóban csak olvas.
ALTER DEFAULT PRIVILEGES FOR ROLE plantbase IN SCHEMA public
  GRANT SELECT ON TABLES TO plantbase_ro;

-- FONTOS: `pnpm db:reset` (prisma migrate reset) DROP+CREATE SCHEMA public-ot csinál,
-- ami törli a fenti grantokat — ez a script csak a container ELSŐ indulásakor fut le
-- újra, resetkor nem. Ha reset után "permission denied for schema public" hibát látsz
-- a runSql-nél, ne itt keresd az "eltűnt" jogosultságokat: azokat a
-- packages/db/prisma/migrations/20260715120000_ro_grants/migration.sql migráció
-- állítja helyre minden migrate deploy/reset után.
