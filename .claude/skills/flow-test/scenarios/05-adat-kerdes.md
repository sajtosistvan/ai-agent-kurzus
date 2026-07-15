# 05 — Adat-kérdés: csak információt kér, csomagot nem

A felhasználó csak adatot kérdez a katalógusból („milyen pet-safe növények vannak
raktáron?”), csomagot NEM kér — a labdát az info-agentnek kell kapnia.

```json
{
  "name": "05-adat-kerdes",
  "persona": "Növénykedvelő vagy, akinek macskája van. CSAK azt akarod megtudni, milyen pet-safe (állatbarát) növények vannak raktáron. Csomagot NEM kérsz, és ha felajánlják, udvariasan elhárítod. Amint megkaptad a listát, megköszönöd és befejezed.",
  "goal": "Pet-safe, raktáron lévő növények listája — csomag-flow NÉLKÜL.",
  "opening": "Szia! Milyen pet-safe növények vannak most raktáron?",
  "maxTurns": 3,
  "expectations": {
    "expectAgents": ["info"],
    "expectSave": false,
    "expectCancel": false,
    "maxTurns": 3
  }
}
```
