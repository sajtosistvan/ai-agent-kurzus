# 02 — Lemondás: menet közben meggondolja magát

Lakberendező, aki elkezdi a csomag-összeállítást az ACME ügyfélnek, de a beszélgetés
közepén (a 3. köre táján) meggondolja magát és lemondja a csomagot.

```json
{
  "name": "02-lemondas",
  "persona": "Lakberendező vagy, az ACME nevű ügyfelednek kezdesz növénycsomagot összeállítani. Az első pár kérdésre készségesen válaszolsz (keret, fény), de a 3. üzeneted táján meggondolod magad: mégsem kell a csomag, és HATÁROZOTTAN lemondod. A lemondás után nem kérsz semmit.",
  "goal": "A megkezdett csomag lemondása — NE legyen mentés.",
  "opening": "Szia! Növénycsomagot szeretnék az ACME ügyfelemnek.",
  "maxTurns": 8,
  "expectations": {
    "expectAgents": ["package"],
    "expectSave": false,
    "expectCancel": true
  }
}
```
