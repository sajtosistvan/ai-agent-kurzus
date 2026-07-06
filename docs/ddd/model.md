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

## Value objectek

### ClientPreference (ügyfél-preferencia)

Ügyfélkódhoz (`ClientCode`) rendelt, változatlan érték-pár:

- `budget` — büdzsé forintban
- `careLevel` — preferált gondozási igényesség (`CareLevel`: ALACSONY | KÖZEPES | MAGAS)

Jelenleg fix táblából jön (ACME, GLOBEX, INITECH); később mögé kerülhet config vagy DB.
Az **Ügyfél** még nem önálló entitás — csak kód + preferencia.

## Kapcsolatok

- Lakberendező → Ügyfél preferenciái (`getClientPreferences`) + Katalógus (`Product`) → ajánlat (növénycsomag, v1-ben nem tárolt).

## Nyitott kérdések (javaslat, nem döntés)

1. **`CareLevel` ↔ `Product.difficulty` leképezés.** Az ügyfél-preferencia skálája
   (ALACSONY | KÖZEPES | MAGAS) nem azonos a termék nehézség-skálájával (kezdő | haladó | profi).
   Ha a szándék az 1:1 megfeleltetés (ALACSONY≈kezdő, KÖZEPES≈haladó, MAGAS≈profi), érdemes ezt
   explicitté tenni (közös enum vagy dokumentált mapping); ha nem, tisztázni kell, hogyan
   szűrjön az agent. Üzleti döntés — a doksi nem dönti el.
2. **Ajánlás-történet.** A BRS bővítési iránya (korábbi döntések elemzése) új entitást igényel
   majd (pl. `Recommendation`); v1-ben szándékosan nincs.
