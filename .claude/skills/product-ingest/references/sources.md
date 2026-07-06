# Források — Shopify `products.json` sajátosságok

Mindkét forrás Shopify-bolt, a `https://<domain>/products.json?limit=250&page=N` végpont lapozható
(a `fetch-feeds.mjs` kezeli). A `products.json` **nem** ad pénznemet és **nem** ad pontos készletet —
csak `variants[].available` boolean van. Ezeket forrás-szinten kell tudni / kikövetkeztetni.

## thesill.com (USD)

- **Pénznem:** USD → HUF **310**-es árfolyamon (fix).
- **Nyelv:** angol termék-nevek és `body_html`. A magyar `name` és `description` az LLM feladata.
- **Latin név:** a `tags` közt, `"Botanical Name: Citrus sinensis 'Hamlin'"` formában. Ha nincs ilyen tag → skip.
- **product_type:** `Indoor Plant`, `Outdoor Plant`, `Plant` → növény (ingest). `Accessory`, `Planter`,
  `Consumable`, `Faux`, üres → **nem-növény, kihagyva** (a script szűri).
- **location:** `Indoor Plant` → `beltéri`; `Outdoor Plant` → `kültéri`; ha bizonytalan → `mindkettő`.
- **Magasság:** `"Mature Height Value: 8 ft."` tag → `maxHeightCm` (ft→cm a script kezeli). Ha csak láb van
  megadva, a `currentHeightCm`-t az LLM becsli (jellemzően a max töredéke, boltba szállítható méret).
- **Akció:** `variants[0].compare_at_price` (magasabb eredeti ár). Ha `compare_at_price > price` → akció:
  a séma `price` = compare_at (eredeti), `sale_price` = price (aktuális). A script ezt előre kiszámolja.
- **Zaj-tagek:** `rs_AK`, `rs_CA` … (szállítási zónák) — a script kiszűri, ne használd őket.
- **Cserépméret:** ritkán van a tagekben; ha nincs, az LLM becsli a magasság/típus alapján.

## tropicalhome.hu (HUF)

- **Pénznem:** HUF → nincs váltás.
- **Nyelv:** a `tags` magyarul (`"Kezdőknek"`, `"Világos helyre"`, `"Futónövény"`, `"Akciós"`), a `body_html`
  jellemzően magyar. A `title` viszont **latin** (botanikai) név, gyakran kultivárral: `Alocasia "Frydek" variegata`.
- **Latin név:** a `title`-ből, a cserépméret-suffix (`- 6cm cserépátmérő`, ` 9cm`) levágva (script kezeli).
- **name (magyar):** a latin címből az LLM képezi a magyar köznevet (pl. `Epipremnum aureum` → „Aranyos pothos”).
  Ha a boltnak van magyar neve a `body_html`-ben, azt preferáld.
- **product_type:** többnyire genusz-nevek (`Hoya`, `Alocasia`, `Monstera`, `Vining plants`,
  `Potted Houseplants`) → mind növény. `Accessories`, `Soil`, üres → **kihagyva**.
- **Gondozási tagek → séma:** `"Kezdőknek"` → `difficulty: kezdő`; `"Világos helyre"` → `light: erős/közepes`;
  `"Futónövény"` → `category: lógó`. Ezek segítik az LLM-kikövetkeztetést, de nem kötelezőek.
- **Cserépméret:** `"12 cm"`, `"6cm"`, `"10.5 cm"` tag → `currentPotCm` (script parse-olja).
- **Akció:** `"Akciós"` tag ÉS `compare_at_price` → akciós ár (mint fent).

## Közös szabályok

- **Készlet (`stock`):** a feed csak `available`-t ad. Konvenció: `available:true` → `stock` egy nominális
  pozitív érték (pl. 5), `available:false` → `stock: 0`. Ezt dokumentáltan becsüljük, nem valós készlet.
- **rating / reviews_count:** a feedben NINCS. Frissen ingesztelt terméknél `rating: 0`, `reviews_count: 0`
  (őszinte „még nincs értékelés”), NEM kitalált szám.
- **Pénznem-váltás:** kizárólag a `fetch-feeds.mjs` végzi (USD=310, EUR=350, HUF=1). Az LLM már HUF-ban
  kapja az árat — ne váltson újra.
