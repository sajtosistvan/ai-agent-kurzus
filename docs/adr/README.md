# Architecture Decision Records (ADR)

Ez a mappa a projekt **döntési naplója**. Minden ADR egy fájl, egy döntés — miért így
döntöttünk, milyen alternatívák voltak, és mi lett a következménye. Az ADR **nem** a kód;
a kód megmutatja *mit* csinálunk, az ADR megőrzi *miért*.

> „Minden architektúrálisan jelentős döntést rögzítünk." — [Michael Nygard, 2011](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## Mikor írj ADR-t?

Akkor, ha a döntés **nehezen visszafordítható** vagy **másokat is érint**:

- szerkezeti / architektúrális választás (pl. két agent egy loopban, read/write szétválasztás)
- technológia / könyvtár bevezetése vagy elvetése
- konvenció, ami az egész kódra hat (pl. „minden tool `ToolOutcome`-ot ad vissza")
- egy **teszt-review** eredményének kezelése: mely javaslatot ültetjük át, melyiket vetjük el, és miért

Nem kell ADR triviális, könnyen visszavonható változásokhoz (egy elgépelés javítása, egy
lokális refaktor). Ha bizonytalan vagy: ha hat hónap múlva valaki megkérdezné „miért így?",
akkor írj ADR-t.

## Formátum

- Fájlnév: `NNNN-rovid-cim.md`, `NNNN` négyjegyű, nullával feltöltve, monoton növekvő.
- A soron következő szám = a legnagyobb meglévő + 1. A számot **nem** használjuk újra, még
  visszavont ADR-nél sem.
- Sablon: [`_template.md`](./_template.md). Másold, töltsd ki, ne a sablont írd felül.

## Státusz-életciklus

```
Javasolt  →  Elfogadva  →  (később)  Elavult  |  Felváltva: ADR-NNNN
     └─────→  Elvetve
```

- **Javasolt** — megírtuk, még nincs jóváhagyva.
- **Elfogadva** — ez a hatályos döntés.
- **Elvetve** — megfontoltuk, de nem ezt választottuk (az indoklás így is megmarad — ez a lényeg).
- **Elavult** — már nem érvényes, de nincs helyette új.
- **Felváltva: ADR-NNNN** — egy későbbi ADR írta felül; linkeld oda-vissza.

Egy elfogadott ADR-t **nem írunk át** utólag — helyette új ADR-t nyitunk, ami felváltja.
A régi státuszát „Felváltva"-ra állítjuk, hogy a napló idővonala olvasható maradjon.

## Index

| ADR | Cím | Státusz |
|-----|-----|---------|
| [0001](./0001-adr-bevezetese.md) | Az ADR bevezetése | Elfogadva |
