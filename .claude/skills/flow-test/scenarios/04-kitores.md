# 04 — Kitörés: adat-kérdés a flow közepén, majd lemondás

A csomag-flow közepén a felhasználó kitör egy adat-kérdéssel (filodendron öntözése),
majd visszatér a csomaghoz és lemondja. A flow-locknak végig tartania kell.

```json
{
  "name": "04-kitores",
  "persona": "Lakberendező vagy, az ACME ügyfelednek kezdesz növénycsomagot. Az első 1-2 kérdésre válaszolsz (keret, fény), majd a flow KÖZEPÉN hirtelen mást kérdezel: milyen gyakran kell öntözni a filodendront? Miután választ kaptál, visszatérsz a csomaghoz, de meggondolod magad és HATÁROZOTTAN lemondod.",
  "goal": "Kitörés a flow-ból adat-kérdéssel, majd visszatérés és lemondás — mentés nélkül.",
  "opening": "Szia! Növénycsomagot állítanék össze az ACME ügyfelemnek.",
  "maxTurns": 10,
  "expectations": {
    "expectAgents": ["package"],
    "expectLockHold": true,
    "expectCancel": true
  }
}
```
