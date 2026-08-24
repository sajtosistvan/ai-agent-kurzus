// A Mastra tool-réteg gyűjtő-fájlja. EGY TOOL = EGY FÁJL (`*-tool.ts`), a hozzá tartozó
// logika (guard, DB-kapcsolat, séma, feed-kliens, validáció) a tool nevét viselő
// alkönyvtárban van mellette — így egy tool minden hozzávalója egy helyen látszik.
//
// A modell felé látszó nevek (a `id` mező) magyar snake_case-ek:
//   katalogus_sql · ugyfel_lekerdezes · webshop_feed · termek_mentes
//   csomag_ellenorzes · csomag_mentes · csomag_elvetes

export * from './katalogus-sql-tool.js';
export * from './katalogus-sql/sql-guard.js';
export * from './katalogus-sql/db-readonly.js';

export * from './ugyfel-lekerdezes-tool.js';
export * from './prisma-client.js';

export * from './webshop-feed-tool.js';
export * from './webshop-feed/shopify-feed.js';

export * from './termek-mentes-tool.js';
export * from './termek-mentes/product-schema.js';
export * from './termek-mentes/db-readwrite.js';

export * from './csomag-ellenorzes-tool.js';
export * from './csomag-mentes-tool.js';
export * from './csomag-elvetes-tool.js';
export * from './csomag/package-plan.js';
export * from './csomag/package-validation.js';
