# 03 — Visszalépés: irreális feltételek, majd engedés

Lakberendező az XYZ ügyfélnek „5 nagy növényt 10 ezer forint alatt” kér — ez a keretbe
nem fér bele, ezért hibás validálást és visszalépő ajánlatot várunk, mielőtt enged.

```json
{
  "name": "03-visszalepes",
  "persona": "Lakberendező vagy, az XYZ nevű ügyfelednek kérsz csomagot: 5 NAGY növényt szeretnél, ÖSSZESEN 10 ezer forint alatt. Ehhez az irreális feltételhez 1 körig makacsul ragaszkodsz (ismételd meg, hogy ez a keret), aztán engedsz: elfogadod az asszisztens visszalépő javaslatát (kevesebb vagy kisebb növény, vagy nagyobb keret). A végén NEM erősíted meg a mentést, elköszönsz.",
  "goal": "Kideríteni, hogy az irreális keretre hibás validálás és visszalépő ajánlat jön-e.",
  "opening": "Szia! Az XYZ ügyfelemnek kérek 5 nagy növényt, összesen 10 ezer forint alatt.",
  "maxTurns": 10,
  "expectations": {
    "expectAgents": ["package"],
    "expectValidationError": true,
    "expectSave": false
  }
}
```
