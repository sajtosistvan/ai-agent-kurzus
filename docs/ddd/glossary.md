# Plantbase — Glossary (ubiquitous language)

> A domain közös szótára. Forrás: `docs/brs-plantbase.md`, `packages/db/prisma/schema.prisma`,
> `packages/core/src/lib/tools/client-preferences.ts`. Karbantartja: `ddd-audit` skill.

| Fogalom | Kódban | Jelentés |
| --- | --- | --- |
| **Lakberendező** | (persona, nincs kódban) | A rendszer felhasználója; ügyfeleknek állít össze növénycsomagot. |
| **Ügyfél** | `ClientCode` | A lakberendező megrendelője. Jelenleg csak ügyfélkóddal és preferenciákkal létezik (ACME, GLOBEX, INITECH). |
| **Ügyfélkód** | `ClientCode` | Az ügyfél rövid azonosítója; a `getClientPreferences` tool bemenete. |
| **Preferencia** | `ClientPreference` | Az ügyfél két igénye: büdzsé + gondozási igényesség. |
| **Büdzsé** | `ClientPreference.budget` | Az ügyfél rendelkezésre álló kerete forintban. |
| **Gondozási igényesség** | `CareLevel` | Mennyire gondozásigényes növényt preferál az ügyfél: ALACSONY \| KÖZEPES \| MAGAS. |
| **Növény / termék** | `Product` | A katalógus egy tétele; a lakberendező ajánlatainak építőköve. |
| **Katalógus** | `products` tábla | Az összes megvásárolható növény; az agent read-only kérdez rá. |
| **Nehézség** | `Product.difficulty` | Milyen szintű gazdinak való a növény: kezdő \| haladó \| profi. ⚠️ Nem azonos skála a gondozási igényességgel — lásd a nyitott kérdést a `model.md`-ben. |
| **Akció / akciós ár** | `Product.salePrice` | Kedvezményes ár; `null`, ha a termék nincs akcióban. |
| **Raktárkészlet** | `Product.stock` | Elérhető darabszám. |
| **Növénycsomag** | (nincs kódban) | Egy szobához/ügyfélhez összeállított növény-válogatás; v1-ben csak fogalom, nem tárolt entitás. |
