# 01 — Happy path: végigmegy és ment

Együttműködő lakberendező, az ACME ügyfélnek kér csomagot, elfogadja a javaslatokat,
és a végén megerősíti a mentést.

```json
{
  "name": "01-happy-path",
  "persona": "Lakberendező vagy, az ACME nevű ügyfelednek kérsz növénycsomagot. Együttműködő vagy: az asszisztens előtöltött javaslatait elfogadod (keret, szint), közepes fényt és 3 darab növényt kérsz. Amikor az összesítő megjelenik és megkérdezik, rendben van-e, IGENNEL erősíted meg.",
  "goal": "Elmentett csomag az ACME ügyfélnek.",
  "opening": "Szia! Szeretnék növénycsomagot összeállítani az ACME ügyfelemnek.",
  "maxTurns": 10,
  "expectations": {
    "expectAgents": ["package"],
    "expectValidateBeforeSave": true,
    "expectSave": true,
    "expectCancel": false
  }
}
```
