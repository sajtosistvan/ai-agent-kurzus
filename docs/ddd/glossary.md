# Plantbase — Glossary (ubiquitous language)

> A domain közös szótára. Forrás: `docs/brs-plantbase.md`, `packages/db/prisma/schema.prisma`,
> `packages/core/src/lib/tools/query-customers/query-customers-tool.ts`,
> `packages/core/src/lib/agents/orchestrator-agent/`,
> `packages/core/src/lib/tools/validate-package/package-plan.ts`. Karbantartja: `ddd-audit` skill.

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
| **Növénycsomag** | `Package` (`packages` tábla) | Egy ügyfélhez összeállított, validált és elmentett növény-válogatás; a `package-agent` írja `savePackage`-dzsel. |
| **Csomagtétel** | `PackageItem` (`package_items` tábla) | Egy csomagban szereplő termék és mennyiség (`productId`, `qty`). |
| **Csomagterv** | `PackagePlan` (típus, nem tábla) | A `validatePackage` determinisztikus kimenete: tételek, `totalPrice`, `remaining` (= budget − totalPrice); ebből lesz az összesítő kártya és a mentés alapja. |
| **Beszélgetés-szál** | `Thread` (`threads` tábla) | A web-chat egy beszélgetése; a DB az igazságforrás, a kliens csak az új üzenetet küldi. |
| **Üzenet** | `Message` (`messages` tábla) | Egy `Thread` egy sora: szerep (user/assistant) + a teljes válasz-szerkezet (`parts`), tool-hívásokkal együtt. |
| **Orchestrator** | `runOrchestrated` | A multi-agent belépési pont: minden üzenetnél eldönti, ki válaszol (info- vagy package-agent), és tartja a flow-lockot. |
| **Routing-döntés** | `routeTo` tool | Az orchestrator jelzése, hová megy a következő üzenet (`info-agent` \| `package-agent`) — mindig strukturált tool-hívás, sosem szöveg-parse. |
| **Flow-lock** | `findLastFlowSignal` | Amíg a csomag-flow nyitva van (routing `package-agent`-re esett, még nincs `savePackage`/`cancelPackage`), a következő üzenetek is oda mennek — kódból, LLM-döntés nélkül. |
| **Orchestráció-mód** | `ORCHESTRATION_MODE` env (`off` \| `router` \| `delegate`) | `off`: eredeti egy-agent útvonal. `router`/`delegate`: orchestrátorral fut, lásd „Handover-mód". |
| **Handover-mód** | `router-handover.ts` / `delegate-handover.ts` | Hogyan jut adathoz a package-agent az info-agenttől: **router** — az orchestrator közvetíti (látható for-ciklus, max 3 ugrás); **delegate** — a package-agent maga hívja az info-agentet beágyazott toolként (`askInfoAgent`). |
| **Info-agent** | `askAgent` (query-agent) orchestrált módban | A query-agent szerepe orchestrált módokban: kérdés-válasz a katalógusról/ügyfélről, adatszolgáltató a package-agent felé. |
| **Package-agent** | `askPackageAgent` | A csomag-összeállítást vezető agent: irányított kérdések, `validatePackage` → összesítő kártya → megerősítés → `savePackage`, vagy `cancelPackage`. |
