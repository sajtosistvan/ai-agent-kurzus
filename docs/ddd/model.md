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

## Kapcsolatok

- Lakberendező → Ügyfél (`Customer`, a `customers` táblából a `queryCustomers` toollal) + Katalógus (`Product`) → ajánlat (növénycsomag, v1-ben nem tárolt).

## Nyitott kérdések (javaslat, nem döntés)

1. **Ajánlás-történet.** A BRS bővítési iránya (korábbi döntések elemzése) új entitást igényel
   majd (pl. `Recommendation`); v1-ben szándékosan nincs.
