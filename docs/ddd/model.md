# Plantbase — Domain-modell (entitások, value objectek)

> Csak a DOMAIN-modell: entitások, value objectek, kapcsolatok. Kód-részletek (tool-implementáció,
> trace, SQL-guard) nem tartoznak ide. Karbantartja: `ddd-audit` skill.

## Entitások

### Product (növény / termék)

A katalógus egy tétele, azonosítója az `id`. Attribútum-csoportok:

- **Azonosítás:** `name`, `latinName`
- **Besorolás:** `category` (szobanövény | kerti | pozsgás | kaktusz | fűszer | fa-cserje | lógó | virágzó), `location` (beltéri | kültéri | mindkettő)
- **Ár és készlet:** `price` (HUF), `salePrice` (akciós ár, opcionális), `stock` (db)
- **Gondozás:** `light` (árnyék | alacsony | közepes | erős | direkt nap), `watering` (ritka | közepes | gyakori | állandóan nedves), `difficulty` (kezdő | haladó | profi)
- **Méretek:** `currentHeightCm`, `maxHeightCm`, `currentPotCm`
- **Biztonság és extra:** `petSafe`, `kidSafe`, `airPurifying`
- **Társadalmi bizonyíték:** `rating` (0–5), `reviewsCount`
- **Leírás:** `description`

### Customer (ügyfél)

A lakberendező megrendelője, a `customers` táblában, azonosítója az `id` (az agent a `code`-dal
hivatkozik rá, pl. ACME). Attribútum-csoportok:

- **Azonosítás:** `code`, `name`, `contactName`, `email`, `city`
- **Besorolás:** `customerType` (magánszemély | iroda | étterem | hotel | üzlet)
- **Igények:** `budget` (HUF, kemény korlát), `expertiseLevel` (kezdő | haladó | profi — a
  `Product.difficulty` skálája), `petSafeRequired`, `kidSafeRequired`
- **Kontextus:** `notes` (fény, stílus, öntözési hajlandóság)

### Package (növénycsomag) + PackageItem — aggregátum

Egy ügyfélhez összeállított, **perzisztált** növény-válogatás (a `packages` tábla; korábban csak
fogalom volt). A `Package` az aggregátum-gyökér, a `PackageItem`-ek a részei (cascade törléssel).

- **Package:** `id`, `customerId` (FK → `Customer`), `totalPrice` (HUF), `createdAt`, `items`
- **PackageItem:** `id`, `packageId` (FK → `Package`), `productId` (FK → `Product`), `qty`
- **Írási út:** kizárólag a package-agent `savePackage` toolja (újra-validálás + tranzakció);
  a `validatePackage` a determinisztikus ellenőrzés (kemény keret-korlát), a mentés előtt.

### KnowledgeChunk (tudásbázis-darab) — a RAG „R"-je

A gondozási tudásbázis egy darabja (a `knowledge_chunks` tábla, `pgvector`). A lakberendezői
kérdéseket a katalógus mellett ez a szövegkorpusz is táplálja.

- **Attribútumok:** `id`, `source` (forrás-URL/cikk), `title`, `category`, `chunkIndex`,
  `content` (a szöveg-darab), `embedding` (`vector(1536)`)
- **Keresés:** koszinusz-távolság (`embedding <=> query`), top-K; a folyamat: kérdés → (HyDE) →
  embedding → pgvector → (rerank) → kontextus. A `search-knowledge` tool a modell-felület.

## Kapcsolatok

- Lakberendező → Ügyfél (`Customer`, a `customers` táblából a `queryCustomers` toollal) +
  Katalógus (`Product`) → **Növénycsomag** (`Package` + `PackageItem`, perzisztált; `savePackage`).
- Kérdés → **KnowledgeChunk** korpusz (RAG-keresés) + Katalógus (`Product`, `runSql`) → válasz.

## Nyitott kérdések (javaslat, nem döntés)

1. **Ajánlás-történet.** A BRS bővítési iránya (korábbi döntések elemzése) új entitást igényel
   majd (pl. `Recommendation`); v1-ben szándékosan nincs.
