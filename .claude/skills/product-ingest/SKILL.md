---
name: product-ingest
description: A plantbase `products` katalógus feltöltése/frissítése a thesill.com és tropicalhome.hu Shopify `products.json` feedjeiből. Használd, amikor termékeket kell importálni, szinkronizálni, feltölteni vagy frissíteni ezekből a webshopokból — akkor is, ha a felhasználó csak annyit mond, hogy „töltsd fel a termékeket”, „frissítsd a katalógust”, „hozd be a növényeket a thesillről / tropicalhome-ról”, vagy „szinkronizáld a boltot”. Magyarra fordítja a neveket, magyar leírást ír a termék-adatlap alapján, nem-forint árat fix árfolyamon (USD 310, EUR 350) HUF-ra vált, és minden terméket egyszer szerepeltet (dedup latin név szerint).
---

# Termék-ingest (thesill.com + tropicalhome.hu → plantbase `products`)

## Mit csinál

A két Shopify-feedből növény-termékeket tölt a `products` táblába (`packages/db`). Három fázis:

1. **Fetch/normalize (determinisztikus, script):** letölti és lapozza mindkét feedet, kiszűri a
   nem-növényeket, kinyeri a biztonságosan kinyerhető mezőket, **HUF-ra vált**, és **dedupál** latin név
   szerint (1 termék csak egyszer). → `scripts/fetch-feeds.mjs`
2. **Enrichment (LLM, ez a te dolgod):** minden candidate-hez **magyar név** + **magyar leírás** a
   termék-adatlapból, és a hiányzó **gondozási mezők** kikövetkeztetése. **Skip**, ha a core mezők nem
   meghatározhatók.
3. **Upsert (determinisztikus, script):** szigorú validáció a rendszer-határon (fail-fast), majd latin
   név szerinti upsert a **read-write** Prisma kliensen. → `scripts/upsert-products.mjs`

A forrás-specifikus részletek (pénznem, hol a latin név, product_type-szűrő, tag-konvenciók):
lásd **`references/sources.md`** — olvasd el, mielőtt az enrichmentet elkezded.

## Workflow

### 1. lépés — Fetch

```bash
node .claude/skills/product-ingest/scripts/fetch-feeds.mjs > /tmp/candidates.json
# teszt/dry-run kisebb mintán:
node .claude/skills/product-ingest/scripts/fetch-feeds.mjs --limit 20 > /tmp/candidates.json
```

A kimenet: `{ candidates: [...], skippedNoLatin: [...], stats: {...} }`. Minden candidate már HUF-ban
kapja az árat (`priceHuf`, `salePriceHuf`), a latin nevet (`latinName`), a cserépméretet/magasságot ahol
kinyerhető, a `tags`-et és a `bodyHtml`-t (ezekből dolgozol), és a forrás(oka)t (`sources`).

### 2. lépés — Enrichment (minden candidate-re)

A cél a `products` séma egy-egy rekordja. A séma mezői és honnan jönnek:

| Séma mező | Forrás / szabály |
|---|---|
| `latinName` | `candidate.latinName` (változatlanul). **Ha üres → skip.** |
| `name` | **Magyar** köznév. thesill: az angol névből fordítsd; tropicalhome: a latin címből képezz magyar nevet, vagy a `bodyHtml`-ből vedd. |
| `category` | Enum: `szobanövény\|kerti\|pozsgás\|kaktusz\|fűszer\|fa-cserje\|lógó\|virágzó`. Következtesd a `productType` + `tags` + botanikai tudás alapján. **Ha nem meghatározható → skip.** |
| `location` | `beltéri\|kültéri\|mindkettő`. thesill `Indoor/Outdoor Plant` egyértelmű; egyébként becsüld. |
| `price` | `candidate.priceHuf` (már HUF, NE válts újra). **Ha null → skip.** |
| `salePrice` | `candidate.salePriceHuf` (null, ha nincs akció). Mindig `< price`. |
| `stock` | `candidate.available ? 5 : 0` (nominális — a feed nem ad valós készletet). |
| `light` | `árnyék\|alacsony\|közepes\|erős\|direkt nap`. tag (`Világos helyre`) + botanikai tudás. |
| `watering` | `ritka\|közepes\|gyakori\|állandóan nedves`. Botanikai tudás (pozsgás→ritka, páfrány→gyakori). |
| `difficulty` | `kezdő\|haladó\|profi`. tag (`Kezdőknek`) + faj ismerete. |
| `currentHeightCm` | Boltba szállítható méret; becsüld a típus/cserépméret alapján (nem a max!). |
| `maxHeightCm` | `candidate.maxHeightCm` ha van, egyébként a faj kifejlett magassága. |
| `currentPotCm` | `candidate.currentPotCm` ha van, egyébként becsüld a magasságból. |
| `petSafe` | Botanikai tudás (pl. sok Araceae mérgező → false). Bizonytalanságnál óvatosan `false`. |
| `kidSafe` | Ugyanígy; a tüskés/mérgező fajok `false`. |
| `airPurifying` | Ismert légtisztítók (pothos, sansevieria, spathiphyllum…) → true, egyébként false. |
| `rating` | **`0`** (frissen ingesztelt, még nincs értékelés — ne találj ki számot). |
| `reviewsCount` | **`0`** (ugyanezért). |
| `description` | **Magyar**, 1-2 mondat a `bodyHtml` + `tags` **adatlap** alapján. Ne másold az angolt; a lényeget (megjelenés, gondozás, hova való) foglald össze magyarul. Ne írj olyat, ami nincs az adatlapon. |

**Skip-szabály (fontos):** ha `latinName`, `category`, vagy `price` nem határozható meg megbízhatóan,
**hagyd ki** a terméket, és jegyezd fel a riportba (miért). Inkább kevesebb, tiszta rekord, mint kitalált
adat. A gondozási mezőket (fény, öntözés stb.) botanikai tudásból becsülheted — ezek nem „skip” okok, de
ha egy fajról semmit nem tudsz, az is skip-ok lehet.

**Immutabilitás / determinizmus:** ne mutálj bemenetet; építs új rekord-objektumokat. Ne találj ki
árat, készletet, értékelést — amit a feed/adatlap nem ad és a botanika nem indokol, azt hagyd a fenti
default-on vagy skip-eld.

A feldúsított rekordokat írd egy JSON tömbbe (a séma-mezőnevekkel, camelCase): `/tmp/enriched.json`.

### 3. lépés — Upsert

Előbb **mindig dry-run** (validál, de nem ír DB-be):

```bash
node .claude/skills/product-ingest/scripts/upsert-products.mjs /tmp/enriched.json --dry-run
```

Ha zöld, éles upsert (read-write `DATABASE_URL` szükséges a környezetben):

```bash
node .claude/skills/product-ingest/scripts/upsert-products.mjs /tmp/enriched.json
```

A script latin név szerint (case-insensitive) upsert-el: meglévőt frissít, újat létrehoz — így
**idempotens**, újrafuttatható. Validációs hibánál **semmit nem ír** DB-be, és kiírja a hibás
rekordokat — javítsd az enrichmentet és futtasd újra.

## Záró riport

A futás végén foglald össze a felhasználónak:

- hány termék lett **létrehozva / frissítve**,
- hány **kihagyva** és miért (nincs latin név / nem-növény / nincs ár / ismeretlen faj),
- hány termék szerepelt **mindkét boltban** (dedupálva),
- az árfolyam-váltás tényét (USD×310, EUR×350).

## Megjegyzések / hardening

- A `products` táblán jelenleg nincs `@unique` a `latin_name`-en; ezért a script „find-then-update/create”
  mintát használ. Robusztusabb változat: `@unique` a `latinName`-en + `prisma.upsert` (egy migrációval).
- Mindkét script függőség-mentes a `node_modules` szempontjából, kivéve az `upsert-products.mjs`
  Prisma-kliensét (`packages/db/generated/client`, `createRequire`-rel töltve). A validáció kézi
  (a bundolt script bárhonnan fusson); az alkalmazáson BELÜLI ingest a konvenció szerint Zod-ot használna.
- Nagy katalógus (több száz termék): először `--limit`-tel próbáld, nézd át pár rekord minőségét, és csak
  utána futtasd teljesen.
