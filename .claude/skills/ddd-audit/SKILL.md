---
name: ddd-audit
description: A git history / kód-változások alapján megnézi, hogy a docs/ddd/ dokumentáció naprakész-e, és frissíti vagy javaslatot tesz. Akkor használd, amikor a domain-modell változott és a DDD doksit auditálni kell.
argument-hint: "[opcionális: honnan nézzük, pl. HEAD~10]"
---

## Mit csinál

1. Megnézi a git historyt / a legutóbbi változásokat (érintett entitások, mezők, fogalmak).
2. Összeveti a `docs/ddd/glossary.md` (ubiquitous language) és `docs/ddd/model.md` (entitások, value objectek) tartalmával.
3. Ahol eltérés van (új vagy megszűnt entitás, mező, fogalom), frissíti a `docs/ddd/`-t, vagy konkrét javaslatot tesz.

## Szabályok

- Csak a DOMAIN-modellt dokumentálja (entitások, value objectek, ubiquitous language), nem a kód-részleteket.
- Üzleti döntést ne írj felül; ha bizonytalan, javasolj, ne erőltess.
