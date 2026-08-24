# ADR-0002: Index minden relációs kapcsolaton

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-03
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma), CLAUDE.md („Read/write separation")

## Kontextus

A Postgres a primary key-t és a `@unique` mezőket automatikusan indexeli, a **foreign
key oszlopokat viszont nem**. A sémában ez ma vegyes: a `Message.threadId` és a
`PackageItem.packageId` kapott `@@index`-et, de a `Thread.customerId`, a
`Package.customerId` és a `PackageItem.productId` nem. Egy index nélküli FK minden
join-t és szűrést sequential scanre kényszerít, és a szülő sor törlésekor/módosításakor
a FK-ellenőrzés is teljes táblát olvas. A query agent szabadon generál SQL-t a séma
fölött, így nem tudjuk előre, mely join-utak lesznek forróak — a séma szintjén kell
garantálni, hogy a relációk gyorsak.

## Döntés

Relációs (FK-t hordozó) tábláknál **mindig indexet teszünk a kapcsolatra**:

- Minden `@relation` FK-oszlop kap `@@index`-et a Prisma sémában (kivéve, ha már
  `@id` vagy `@unique` fedi).
- Ez a konvenció minden új táblára és migrációra kötelező; a meglévő hiányokat
  (`Thread.customerId`, `Package.customerId`, `PackageItem.productId`) külön
  migrációban pótoljuk.
- További (nem-FK) oszlopok indexelése — pl. gyakori szűrőmezők — eseti döntés
  marad, mérés alapján; azokra ez az ADR nem mond ki automatizmust.

## Megfontolt alternatívák

- **Csak mérés után indexelni (YAGNI)** — kis adatnál nem fáj, de az agent-generálta
  SQL miatt a hot path nem jósolható, és a hiány csak éles lassulásként derül ki.
  Elvetve a FK-kra; a nem-FK oszlopokra viszont pont ezt tartjuk meg.
- **Minden oszlopot indexelni** — az írásokat lassítja és tárhelyet visz, a legtöbb
  index halott súly lenne. Elvetve.
- **Adatbázis-oldali automatika (pl. lint-szabály, extension)** — plusz függőség;
  a séma kicsi, a konvenció + review elég. Elvetve, később újranyitható.

## Következmények

- **Pozitív:** a join-ok és FK-ellenőrzések index scant használnak; a query agent
  tetszőleges join-útja is kiszámíthatóan gyors; a konvenció review-n számonkérhető.
- **Negatív / ár:** minden FK-index lassítja kicsit az írást és tárhelyet foglal;
  új reláció felvételekor egy plusz `@@index` sor és migráció kötelező.
- **Semleges:** a meglévő hiányok pótlása egy egyszeri migrációt igényel; a seed és
  a tesztek változatlanok.
