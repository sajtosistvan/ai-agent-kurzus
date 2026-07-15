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

### Package (növénycsomag)

Egy ügyfélhez összeállított, VALIDÁLT és elmentett növény-válogatás (`packages` tábla). A
korábbi „v1-ben nem tárolt" nyitott kérdés lezárult: a csomag-agent (`validatePackage` →
`savePackage`) írja, mindig egy `Customer`-hez kötve (`customerId`, FK).

- **Azonosítás:** `id`
- **Kapcsolat:** `customerId` (kötelező — a budget-korlát is az ügyfélé)
- **Összegzés:** `totalPrice` (HUF, a tételek összege, mentéskor újra-validálva)
- **Tételek:** `items` (`PackageItem[]`)

### PackageItem (csomagtétel)

Egy `Package` egy sora: melyik `Product`-ból mennyi kerül a csomagba (`package_items` tábla).

- **Kapcsolat:** `packageId`, `productId`
- **Mennyiség:** `qty` (db, ≥1)

> **PackagePlan** (value object, nem tábla): a `validatePackage` tool determinisztikus
> kimenete — tételek, `totalPrice`, `remaining` (= `budget - totalPrice`). Ez a csomag-agent
> és a UI közös nyelve (a `data-package` stream-part és az összesítő kártya ebből épül), és ez
> megy a `savePackage`-nek is újra-validálásra. Nem önálló entitás, hanem a `Package`
> mentés-előtti, még nem perzisztált alakja.

### Thread (beszélgetés-szál) és Message (üzenet)

A web-chat perzisztenciája (`threads` + `messages` tábla). A DB az igazságforrás: a kliens
csak az új üzenetet küldi, az előzményt a szerver ebből tölti vissza.

- **Thread:** `id` (cuid), `title` (az első user-üzenet eleje), `customerId` (opcionális — melyik
  ügyfélről szól a beszélgetés), `messages`
- **Message:** `id`, `threadId`, `role` (user | assistant), `parts` (a teljes válasz-szerkezet,
  tool-hívásokkal együtt — újratöltéskor ebből rajzolódik vissza minden)

## Kapcsolatok

- Lakberendező → Ügyfél (`Customer`, a `customers` táblából a `queryCustomers` toollal) +
  Katalógus (`Product`) → **`Package`** (elmentett növénycsomag, `PackageItem`-eken keresztül a
  `Product`-okra mutatva).
- Ügyfél → `Thread` (a beszélgetés, amiben a csomag összeáll) → `Message`-ek.

## Orchestráció (folyamat-fogalmak, nem entitások)

Ezek nem táblák/entitások, hanem a multi-agent FOLYAMAT ubiquitous language-e — ide azért
kerülnek, mert a domain-beszélgetés (lakberendező ↔ rendszer) részei.

- **Routing-döntés:** minden felhasználói üzenetnél az orchestrator eldönti, ki válaszol:
  az info-agent (kérdés-válasz a katalógusról/ügyfélről) vagy a package-agent (csomag-flow).
- **Flow-lock:** amíg a csomag-flow nyitva van (a routing egyszer a package-agentre esett, és
  még nem volt sikeres mentés/megszakítás), a KÖVETKEZŐ üzenetek is oda mennek — kódból
  eldöntve (az előzmény strukturált tool-jelzéseiből), nem újra LLM-routing-gal.
- **Handover-mód:** két módon juthat adathoz a package-agent, amikor az info-agent tudására van
  szüksége (pl. „mennyi az ACME budgetje"): **router** (az orchestrator közvetíti a kérdést az
  info-agent felé, látható for-ciklusban, max 3 ugrás) vagy **delegate** (a package-agent maga
  hívja az info-agentet beágyazott toolként). A `ORCHESTRATION_MODE` env (`off|router|delegate`)
  választja ki; `off`-ban nincs orchestráció, az eredeti egy-agent útvonal fut.

## Nyitott kérdések (javaslat, nem döntés)

1. **Ajánlás-történet.** A BRS bővítési iránya (korábbi döntések elemzése) új entitást igényel
   majd (pl. `Recommendation`); v1-ben szándékosan nincs.
2. **Package státusz.** Jelenleg egy `Package` mentéskor már véglegesnek számít (nincs
   piszkozat/megerősített állapot-mező) — ha a flow bővül (pl. módosítható rendelés), érdemes
   lehet egy explicit `status` mezőt bevezetni.
