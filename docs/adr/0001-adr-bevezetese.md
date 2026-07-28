# ADR-0001: Az ADR bevezetése

- **Státusz:** Elfogadva
- **Dátum:** 2026-07-20
- **Döntéshozó(k):** Istvan Sajtos
- **Kapcsolódó:** [`docs/adr/README.md`](./README.md), CLAUDE.md („Architecture Decision Records")

## Kontextus

A projekt tanítási célja, hogy az agent-mechanika rétegről rétegre látható maradjon. A *kód*
megmutatja, mit csinálunk, de a **miért** — miért két agent egy loopban, miért read/write
szétválasztás, miért `ToolOutcome` minden toolnál — eddig szétszórtan élt commit-üzenetekben,
`docs/`-ban és fejekben. A commit-history rossz döntési napló: a diff a *változást* rögzíti,
nem a *megfontolt alternatívákat* és az elvetés indokát.

Külön kiváltó ok: a `autotest` skill teszt-riportokból javaslatokat termel, és el kell
dönteni, melyiket ültetjük át. Ezt a döntést — az elfogadottat **és az elvetettet** — logolni
akarjuk, nem csak a commitban elrejteni.

## Döntés

Bevezetjük az **Architecture Decision Record (ADR)** konvenciót:

- Az ADR-ek a [`docs/adr/`](./) mappában élnek, `NNNN-rovid-cim.md` néven, a
  [`_template.md`](./_template.md) sablon alapján.
- A folyamat, számozás és státusz-életciklus a [`README.md`](./README.md)-ben van rögzítve.
- A CLAUDE.md tartalmaz egy ADR-szekciót, ami az agenst (Claude) is kötelezi: architektúrálisan
  jelentős vagy nehezen visszafordítható döntésnél ADR-t kell írni.

## Megfontolt alternatívák

- **Csak commit-üzenetek** — nincs külön karbantartandó fájl, de a „miért" és az elvetett
  alternatívák elvesznek; nem kereshető, nem hivatkozható. Elvetve.
- **Egy nagy `DECISIONS.md`** — egyszerű, de gyorsan összenő, nehéz review-zni és linkelni.
  Elvetve a fájl-per-döntés javára (illik a repó „sok kis fájl" konvenciójához).
- **Nehézsúlyú ADR-eszköz (adr-tools CLI)** — felesleges függőség; a konvenció sima
  markdownnal is működik. Elvetve.

## Következmények

- **Pozitív:** a döntések indoklása kereshető, hivatkozható, review-zható; az elvetett
  alternatívák megmaradnak; a `autotest` döntési naplója strukturált helyet kap.
- **Ár:** minden jelentős döntésnél plusz egy fájl megírása; fegyelmet igényel (ezt a CLAUDE.md
  rule tartatja be).
- **Semleges:** a `docs/` bővül egy `adr/` alkönyvtárral.
