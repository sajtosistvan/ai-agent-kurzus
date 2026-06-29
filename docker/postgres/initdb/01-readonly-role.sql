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
