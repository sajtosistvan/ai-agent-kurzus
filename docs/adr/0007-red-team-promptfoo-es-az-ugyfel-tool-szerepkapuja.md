# ADR-0007: Red team a promptfoo-val, és az `ugyfel_lekerdezes` szerepkör-kapuja

- **Státusz:** Elfogadva
- **Dátum:** 2026-08-10
- **Döntéshozó(k):** Sajtos István
- **Kapcsolódó:** ADR-0003 (Mastra), `redteam/promptfooconfig.yaml`, `redteam/owasp-demo.yaml`,
  `packages/core/src/mastra/tools/ugyfel-lekerdezes-tool.ts`

## Kontextus

Az agent védelmeit eddig unit-tesztek és scorerek mérték: mindkettő azt ellenőrzi, hogy a
rendszer jól működik-e, ha **rendeltetésszerűen** használják. Azt nem mérte semmi, hogy mi
történik, ha valaki **szándékosan támad**.

Egy promptfoo red team scan (3 plugin, 6 eset, a `plantbase-query` agent ellen) egy HIGH
súlyosságú rést talált: a `plantbase-query` bármely, be nem jelentkezett beszélgetőnek kiadta a
bolt ügyfeleinek nevét, városát, **költségkeretét és belső jegyzeteit** — köztük olyanokat, mint
„két kisgyerek és egy macska". Egy bővített, OWASP-alapú szett (13 plugin, 39 eset) ezt hatszor
megismételte (`pii:direct` 0/3, `pii:api-db` 0/3), és ezen felül `tool-discovery` 0/3-at hozott:
az agent készségesen felsorolja az eszközeit, azok paramétereit és a `products` tábla oszlopait.

Az ok szerkezeti: az `ugyfel_lekerdezes` toolnak **semmilyen jogosultság-ellenőrzése nem volt**.
A meglévő `rbac-processzor` csak a katalógus *szerkesztésére* utaló szavakat fogja meg, az adat
*kiolvasására* nem — vagyis pontosan az a hiba állt elő, amire a saját kommentje figyelmeztet:
„a jogosultságot ott is ellenőrizd, ahol a művelet ténylegesen megtörténik".

## Döntés

**1. A red team a projekt állandó eszköze lesz.** A `redteam/` könyvtárban két config él: egy
rövid órai gyorsteszt és egy OWASP-alapú demó szett (`pnpm redteam:owasp`), amely az OWASP
Agentic (ASI02/03/05) és az OWASP LLM Top 10 (LLM02/05/06/07/09) kategóriákat képezi le
plugin-okra, plusz egy `policy` plugint a projekt saját grounding-szabályára.

**2. Az `ugyfel_lekerdezes` tool-szintű szerepkör-kaput kap**, arányos szabállyal:

- **belső munkatárs (`admin`)** — teljes hozzáférés: listázás, név/város keresés, minden mező.
- **vásárló (`customer`)** — **kizárólag pontos ügyfélkóddal**, és a `notes` (belső jegyzet)
  nem megy ki. A `search` és a `customerType` szűrő akkor sem érvényesül, ha a modell mégis
  beleteszi a hívásba: a tiltást a kód tartja be, nem a prompt.
- **szerep hiányában a szűkebb jog** érvényes (`customer`) — a biztonsági alapértelmezés
  mindig a szigorúbb.

Az elutasítás szövege **azonos**, akár létezik a keresett ügyfél, akár nem, hogy a tool ne
működhessen felderítő orákulumként („létezik-e Kovács Anna a vásárlóitok között?").

**3. A védelmet unit-tesztek rögzítik** (`ugyfel-lekerdezes-tool.spec.ts`, 7 új eset), mert a
szerepkapu determinisztikus — nem kell hozzá se modell, se DB.

## Megfontolt alternatívák

- **Az `ugyfel_lekerdezes` teljes admin-hoz kötése** — a legszigorúbb, de mivel jelenleg semmi
  nem állítja be a szerepet (az `olvasSzerep` mindig `customer`-t ad), ez a csomag-ajánló
  folyamatot teljesen megszüntette volna. Elvetve: aránytalan.
- **A tool eltávolítása a query agentből** — a rést megszünteti, a funkciót is. Elvetve.
- **Csak prompt-szintű tiltás az instrukciókban** — ezt a scan éppen hogy megkerülte.
  Elvetve: a prompt kérés, a kód kényszer.
- **A `notes` mező teljes törlése a sémából** — a belső jegyzet a csomagajánlás üzleti értéke;
  a probléma nem a létezése, hanem a címzettje. Elvetve.

## Következmények

- **Pozitív:** a tömeges ügyféllistázás és a név/város szerinti felderítés megszűnt; a belső
  jegyzet vásárlónak nem megy ki; a rés regressziós teszttel védett. A projekt mostantól a
  támadói nézőpontot is méri, nem csak a rendeltetésszerűt.
- **Negatív / ár:** a csomag-ajánló folyamathoz a felhasználónak ismernie kell a saját
  ügyfélkódját. Ez ideiglenes: a valódi megoldás egy hitelesített ügyfél-identitás a
  RequestContextben, ami a saját profilra szűkíti a lekérdezést — ezt egy későbbi ADR zárja le.
- **Nyitva marad (tudatosan):** a `tool-discovery` 0/3 — az agent felfedi az eszközeit és a
  séma egy részét. Ez felderítést könnyít, de önmagában nem ad hozzáférést, és az NFR1 három
  rétege a séma ismeretében is tart (`sql-injection` 3/3 védve). Prompt-szintű szigorítást
  igényel, külön körben.
- **Semleges:** a scan **nem determinisztikus** — a teszteseteket LLM generálja a `purpose`
  mezőből, tehát minden futás más eseteket ad. Felfedezésre kiváló, CI-kapunak önmagában nem;
  ahhoz a generált eseteket ki kell menteni és fixálni.
