# Plantbase — Glossary (ubiquitous language)

> A domain közös szótára. Forrás: `docs/brs-plantbase.md`, `packages/db/prisma/schema.prisma`,
> `packages/core/src/lib/tools/query-customers/query-customers-tool.ts`. Karbantartja: `ddd-audit` skill.

| Fogalom | Kódban | Jelentés |
| --- | --- | --- |
| **Lakberendező** | (persona, nincs kódban) | A rendszer felhasználója; ügyfeleknek állít össze növénycsomagot. |
| **Ügyfél** | `Customer` (`customers` tábla) | A lakberendező megrendelője; a `queryCustomers` tool kérdezi le a DB-ből. |
| **Ügyfélkód** | `Customer.code` | Az ügyfél rövid azonosítója (pl. ACME); az agent ezzel hivatkozik rá. |
| **Preferencia** | `Customer` mezői | Az ügyfél igényei: büdzsé, szakértelmi szint, pet/kid-safe elvárás, megjegyzések. |
| **Büdzsé** | `Customer.budget` | Az ügyfél rendelkezésre álló kerete forintban. |
| **Szakértelmi szint** | `Customer.expertiseLevel` | Milyen gondozási szintet bír el az ügyfél: kezdő \| haladó \| profi (= `Product.difficulty` skálája). |
| **Növény / termék** | `Product` | A katalógus egy tétele; a lakberendező ajánlatainak építőköve. |
| **Katalógus** | `products` tábla | Az összes megvásárolható növény; az agent read-only kérdez rá. |
| **Nehézség** | `Product.difficulty` | Milyen szintű gazdinak való a növény: kezdő \| haladó \| profi. Ugyanez a skála, mint a `Customer.expertiseLevel`. |
| **Akció / akciós ár** | `Product.salePrice` | Kedvezményes ár; `null`, ha a termék nincs akcióban. |
| **Raktárkészlet** | `Product.stock` | Elérhető darabszám. |
| **Növénycsomag** | `Package` (`packages` tábla) | Egy ügyfélhez összeállított, **perzisztált** növény-válogatás (aggregátum-gyökér); a `savePackage` tool írja, FK az ügyfélre. |
| **Csomag-tétel** | `PackageItem` (`package_items` tábla) | A növénycsomag egy sora: melyik termékből (`productId`) mennyi (`qty`); a csomag törlésével kaszkádolva törlődik. |
| **Csomag-validálás** | `validatePackage` tool | Determinisztikus ellenőrzés mentés előtt (kemény keret-korlát, készlet, pet/kid-safe); a `savePackage` újra lefuttatja tranzakcióban. |
| **Tudásbázis** | `knowledge_chunks` tábla (`pgvector`) | Gondozási szövegkorpusz darabokra (chunk) bontva, embeddinggel; a RAG-keresés forrása. |
| **Chunk** | `KnowledgeChunk` (`knowledge_chunks` sor) | A tudásbázis egy szöveg-darabja (`content`) forrással (`source`) és embeddinggel (`vector(1536)`). |
| **RAG / tudásbázis-keresés** | `retrieveKnowledge`, `search-knowledge` tool | Kérdés → (HyDE) → embedding → pgvector koszinusz-keresés → (rerank) → kontextus; a válasz forrásokra támaszkodik. |
