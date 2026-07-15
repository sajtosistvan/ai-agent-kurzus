-- Plantbase — read-only (plantbase_ro) jogosultságok MIGRÁCIÓBAN, nem csak a
-- docker/postgres/initdb/01-readonly-role.sql-ben.
--
-- MIÉRT ITT: a 01-readonly-role.sql csak a Postgres CONTAINER első indulásakor fut
-- (üres adatkönyvtárnál, docker-entrypoint-initdb.d). A `pnpm db:reset` (prisma migrate
-- reset) viszont DROP SCHEMA public + CREATE SCHEMA public-ot csinál, ami törli a séma
-- szintű GRANT-okat (USAGE a sémán, SELECT a táblákon, DEFAULT PRIVILEGES) — a container
-- init script ekkor már nem fut le újra. Emiatt reset után az agent runSql-je
-- "permission denied for schema public" / "relation ... does not exist" hibával elszáll.
--
-- Ezért a grantokat EGY MIGRÁCIÓBA is felvesszük: minden `prisma migrate deploy`/`reset`
-- lefuttatja, tehát reset-álló marad. A DO blokk védi azt az esetet, amikor a
-- plantbase_ro szerep nem létezik (pl. friss, nem docker-es fejlesztői DB) — ilyenkor
-- csak egy NOTICE-t ír, nem bukik el a migráció.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantbase_ro') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO plantbase_ro';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO plantbase_ro';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO plantbase_ro';
  ELSE
    RAISE NOTICE 'plantbase_ro szerep nem létezik — read-only grant migráció kihagyva.';
  END IF;
END
$$;
