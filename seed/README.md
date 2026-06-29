# Seed — előre kész növény-adat

A `plantbase` katalógus indító adata, hogy induláskor ne kelljen generálni (gyorsabb a live build).

- `plants.ts` — ~30 realisztikus növény a `products` séma szerint (kategóriák, fény, öntözés, méret, ár/akció, pet/kid-safe, rating).
- `seed.ts` — Prisma seed script: törli, majd betölti a növényeket (idempotens).

## Használat az induló projektben
1. Másold a `plants.ts` + `seed.ts`-t a Prisma libbe (pl. `packages/db/prisma/`).
2. `package.json`: `"prisma": { "seed": "tsx packages/db/prisma/seed.ts" }`.
3. Migráció után: `pnpm prisma db seed`.

A `@prisma/client` és a node típus-figyelmeztetés itt (a kit mappában) normális — a függőségek az induló projektben települnek.
