# ADR-0006: A Mastra tárolása Postgresen marad (PostgresStore + PgVector)

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-05
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [ADR-0003](./0003-mastra-keretrendszer-bevezetese.md),
  [ADR-0004](./0004-sajat-trace-helyett-mastra-observability.md),
  [ADR-0002](./0002-index-minden-relacios-tablan.md), `docker-compose.yml`, `packages/db/**`

## Kontextus

A Mastra dokumentációja és a legtöbb minta (köztük a saját `mastra-demo` referenciaprojektünk)
**LibSQL/SQLite**-tal indul: nulla konfiguráció, fájl-alapú, azonnal fut. A Mastra bevezetésével
(ADR-0003) el kellett dönteni, hol éljen a keretrendszer állapota: a memória (thread-ek, üzenetek),
a trace-ek, a scorer-eredmények és a RAG vektorai.

A Plantbase ugyanakkor **már ma Postgresen fut** (Docker, host 5433-as port, Prisma
migrációk/seed, két DB-URL és két szerepkör az NFR1 miatt), és a katalógus is ott van. A
pgvector kiterjesztés elérhető ugyanabban a példányban.

## Döntés

A Mastra állapota **Postgresen marad**:

- **`PostgresStore`** (`@mastra/pg`) a memóriának, a trace-eknek és a scorer-eredményeknek,
- **`PgVector`** (`@mastra/pg`) a RAG-embeddingeknek — **ugyanabban** a Postgres-példányban,
  ahol a katalógus van,
- **semmilyen LibSQL / SQLite / DuckDB** nem kerül a projektbe, akkor sem, ha a Mastra-példák azzal
  indulnak.

A meglévő env-szerződés változatlan: `DATABASE_URL` (read-write) és `DATABASE_URL_READONLY`
(a katalógus-SQL tool ezen fut, NFR1).

## Megfontolt alternatívák

- **LibSQL/SQLite (a Mastra alapértelmezése, a mintaprojekt választása)** — a legkisebb belépési
  küszöb, nem kell Docker. Elvetve: két adatbázis-technológia lenne egy projektben, az agent
  állapota és a domain-adat elválna, a vektorokhoz külön megoldás kellene, és a tananyag egy
  olyan mintát tanítana, amit éles környezetben úgyis le kell cserélni.
- **Külön Postgres-példány a Mastrának** — tisztább izoláció, de még egy konténer, még egy migrációs
  út és még egy backup a kurzus-környezetben. Elvetve; sémaszintű elválasztás elég.
- **Dedikált vektor-adatbázis (Qdrant / Pinecone)** — jobb skálázás nagy korpuszra, de új
  szolgáltatás (és felhős esetben fiók + kulcs) a néhány ezer chunkos tudásbázishoz.
  Elvetve — pgvector bőven elég ekkora adatra.

## Következmények

- **Pozitív:** egy adatbázis, egy `docker compose up -d`, egy backup; a trace, a memória és a
  katalógus SQL-lel együtt kérdezhető; a stack ugyanaz marad, mint ami éles környezetben is
  vállalható; a pgvector nem hoz be új szolgáltatást.
- **Ár:** a Mastra-minták copy-paste-elhetősége romlik — a dokumentáció LibSQL-es kódrészleteit
  minden esetben át kell írni Postgresre (a hallgatónak ezt külön el kell mondani).
- **Ár:** a projekt indításához továbbra is kell futó Docker + Postgres; nincs „nulla setup"
  belépési pont.
- **Semleges:** a Mastra saját táblákat hoz létre a DB-ben, a Prisma-séma mellett. Ezek nem
  Prisma-migrációval keletkeznek — a `db:reset` viselkedését ennek megfelelően dokumentálni kell.
