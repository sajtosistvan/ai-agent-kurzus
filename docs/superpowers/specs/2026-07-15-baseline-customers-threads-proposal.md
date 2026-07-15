# Implementation proposal — Customers, thread-perzisztencia, higiéniai kör

**Dátum:** 2026-07-15 · **Alap:** main @ 628bc43 · **Jelleg:** ALAPRÉTEG — nem kerül
lépésenkénti demózásra, az órán késznek vesszük. Az orchestrator-demó
(`2026-07-15-orchestrator-demo-design.md`) erre épül.

## Sorrend — az óra dramaturgiája szerint (KÖTÖTT)

1. **Javítási kör** (1. munkacsomag): előbb rendbe tesszük, ami van — higiénia + az
   `admin=false` holtág feloldása.
2. **Új alapfunkciók** (2–6. munkacsomag): customers, queryCustomers, threads, perzisztencia,
   thread-UI.
3. **Új agent-funkciók** (külön spec: `2026-07-15-orchestrator-demo-design.md`): orchestrator,
   package-agent, handover-módok, flow-teszt skill. Csak a fenti kettő UTÁN kezdődik.

## Kapcsolat az orchestrator-spec-kel

- Az ott tervezett `clients` táblát **ez a proposal váltja ki `customers` néven** (bővebb,
  életszerűbb adatokkal). Az orchestrator-spec 5. fejezete ehhez igazítandó.
- A mainen már UI message stream + typed tool-partok futnak (`pipeUIMessageStreamToResponse`,
  tool-chipek a UI-ban) — az orchestrator-spec 6. fejezetének protokoll-váltása részben kész;
  a thread-perzisztencia erre a protokollra épül.
- Az `admin=false` holtág feloldása ide került át (J0) — az orchestrator-branch már működő
  multi-agent kapoccsal indul.

---

## 1. munkacsomag — javítási kör a meglévő kódon

A 2026-07-15-ös main-review alapján. A J0 kivételével minden tétel viselkedés-semleges —
az appra rá kell ismerni.

| # | Mit | Honnan (review) |
|---|---|---|
| **J0** | **`query-agent.ts:42` `admin=false` holtág feloldása:** vissza `isAdmin(role)`-ra, ahogy a fájl kommentje ígéri — adminként bekerül a `delegateToIngest` a toolsetbe (`maxSteps` is role-függő). Egyben: a prompt ÉS a toolset ugyanabból a role-értékből épüljön (egy forrás), hogy ne csúszhassanak el. A fájl-kommentek a valósághoz igazítva. | M3 |
| J1 | `apps/server/src/main.ts:24-31` fejléckomment átírása a tool-stream valóságra | M4 |
| J2 | `chunk.ts:55` nem létező fájlra hivatkozó komment javítása | K1 |
| J3 | Közös ANSI szín-helper: a `retrieve.ts` nyers escape-jei a `trace.ts` `c` helperére állnak | K2 |
| J4 | `echo.ts` törlése (index-exporttal együtt) — halott kód elavult kommenttel | K4 |
| J5 | `ingest-knowledge.ts:113` súgó-port 3000 → 3001 | K5 |
| J6 | `App.tsx` render-blokk: `splitAssistantParts()` segéd + szűk `ToolUIPart` típus, `console.log` jelölése/kivétele | K6 |
| J7 | Gyökér-takarítás: `git rm -r --cached .playwright-mcp/ embed-demo.json postman/ railpack.*.json` + az összeragadt `.gitignore`-sor kettébontása | M5 |
| J8 | Doksi-szinkron: README/architektura/stack — Vercel AI SDK 6 a valóság; RAG-réteg + server/web átvezetése; scripts-tábla pótlása | M1, M2, K9 |
| J9 | `seed/` gyökér-mappa: explicit „starter-kit, az élő forrás a packages/db" jelölés a README-jében (törlés helyett — kurzus-történeti érték) | K7 |
| J10 | Tool-leírások átolvasása és életszerűsítés — szövegváltozás, nem logika | — |

**Tudatosan NEM része:** a `trace.ts` szétbontása (K3) — kockázatosabb refaktor, külön kör.

## 2. munkacsomag — `customers` tábla + seed (20 értelmes sor)

**Prisma model** (`packages/db/prisma/schema.prisma`):

```prisma
model Customer {
  id              Int      @id @default(autoincrement())
  code            String   @unique            // pl. "ACME" — az agent ezzel hivatkozik
  name            String                      // cégnév vagy magánszemély neve
  contactName     String?  @map("contact_name")
  email           String
  city            String
  customerType    String   @map("customer_type") // magánszemély | iroda | étterem | hotel | üzlet
  budget          Decimal  @db.Decimal(12, 2) // keret (HUF)
  expertiseLevel  String   @map("expertise_level") // kezdő | haladó | profi (= products.difficulty skála)
  petSafeRequired Boolean  @map("pet_safe_required")
  kidSafeRequired Boolean  @map("kid_safe_required")
  notes           String                      // szabad szöveg: "sötét iroda, észak fekvés"
  createdAt       DateTime @default(now()) @map("created_at")
  threads         Thread[]
  @@map("customers")
}
```

**Seed** (`packages/db/prisma/customers.ts` + bekötés a `seed.ts`-be, idempotens `code` kulcson):
20 kézzel írt, életszerű magyar rekord — vegyesen magánszemélyek, irodák, éttermek, hotelek;
a mai három kód (ACME, GLOBEX, INITECH) megmarad kompatibilitásból. Változatos büdzsék
(15 000 – 800 000 Ft), legyen szűk keretű és allergiás/kisgyerekes profil is, a `notes` mindig
mondjon valami döntés-befolyásolót (fényviszony, stílus, öntözési hajlandóság).

## 3. munkacsomag — `queryCustomers` tool

`packages/core/src/lib/tools/query-customers/query-customers-tool.ts` (+ spec):

- **Prisma-olvasás** (a döntésünk szerint a nem-SQL toolok Prismát használnak).
- Input: `{ code?, search?, customerType? }` — kód szerinti pontos találat, név/város szerinti
  keresés, vagy típus-szűrés; üres input = első 20 ügyfél listázása.
- Output `content`: kompakt JSON (kód, név, típus, keret, preferenciák, notes);
  `summary`: pl. `"3 ügyfél · keresés: »iroda«"`, `rowCount` kitöltve.
- Konvenciók: never-throw, magyar hibák, permissive tool-séma + szigorú belső Zod.
- **A `getClientPreferences` tool megszűnik, ez váltja ki**: a query agent toolsetében csere,
  a promptban a hivatkozás átírása. (A fix CLIENT_PREFERENCES térkép törlődik — az adat a
  DB-ben él.)

## 4. munkacsomag — `threads` + `messages` táblák

```prisma
model Thread {
  id         String    @id @default(cuid())
  title      String                       // az első user-üzenet első ~60 karaktere
  customerId Int?      @map("customer_id") // opcionális: melyik ügyfélről szólt (későbbi csomag-flow tölti)
  customer   Customer? @relation(fields: [customerId], references: [id])
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  messages   Message[]
  @@map("threads")
}

model Message {
  id        Int      @id @default(autoincrement())
  threadId  String   @map("thread_id")
  thread    Thread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role      String                       // user | assistant
  parts     Json                         // a teljes UIMessage.parts — szöveg + tool-partok
  createdAt DateTime @default(now()) @map("created_at")
  @@index([threadId])
  @@map("messages")
}
```

**Miért a `parts` JSON:** így újratöltéskor a tool-chipek is visszarajzolódnak (nem csak a
szöveg), és a szerver ebből állítja vissza a modell-előzményt is (`convertToModelMessages` a
data/tool-partok szűrésével). Egy oszlop, nincs külön tool-call tábla — demóhoz ennyi kell.

## 5. munkacsomag — szerver: perzisztencia + thread API

A szerver eddig stateless volt (a kliens küldte a teljes előzményt). Mostantól **a DB az
igazságforrás**, a kliens csak az új üzenetet küldi:

- `POST /api/chat` — body: `{ threadId?: string, message: UIMessage }`.
  1. ha nincs `threadId`: új Thread (title = user-üzenet első 60 karaktere), az id-t egy
     `data-thread` parttal azonnal kistreameli (a kliens ebből frissíti az URL-t);
  2. user-üzenet mentése; előzmény betöltése DB-ből; agent futtatása a meglévő úton;
  3. a kész asszisztens-UIMessage mentése (`onFinish`) a `parts`-szal együtt.
- `GET /api/threads` — lista: `{ id, title, updatedAt }[]`, frissesség szerint, LIMIT 50.
- `GET /api/threads/:id` — a thread üzenetei `UIMessage[]`-ként (a `parts` oszlopból).
- Új fájl: `apps/server/src/threads.ts` (Prisma-elérés + a 3 handler) — a `main.ts` vékony marad.
- Hiba-ág: ismeretlen `threadId` → 404 magyar üzenettel; a chat-handler soha nem hagy
  válasz nélküli user-üzenetet az adatbázisban (agent-hiba esetén hibaszöveg-üzenet mentődik).

## 6. munkacsomag — web: thread-lista + URL-betöltés

- **URL-séma:** `?thread=<id>` (nincs router-lib — `URLSearchParams` + `history.replaceState`).
  Betöltéskor ha van `thread` param: `GET /api/threads/:id` → a useChat `messages` induló
  állapota. Új beszélgetésnél az első válasz `data-thread` partjából kerül be az id az URL-be.
- **Thread-lista a chat alatt:** új komponens `apps/web/src/components/thread-list.tsx` —
  cím + relatív dátum, kattintásra `?thread=<id>` navigáció; tetején „Új beszélgetés" gomb
  (URL-param törlés + üres chat). Egyszerű lista, nincs keresés/törlés (YAGNI).
- A transport körül egy kis módosítás: a `prepareSendMessagesRequest`-tel csak az utolsó
  üzenet + `threadId` megy fel (a teljes history küldése megszűnik).

## Sorrend és tesztek

1. **Javítási kör (J0–J10)** — apró, független commitok; J0 után a `delegate-to-ingest`
   spec-jei és a role-os ág Vitest-tel lefedve; `pnpm test` + `pnpm typecheck` zölden.
2. Prisma migráció (customers + threads + messages) + seed → `pnpm db:reset` zölden.
3. `queryCustomers` tool + spec; `getClientPreferences` kivezetése (spec-ek frissítése).
4. Szerver: `threads.ts` + chat-handler átállás DB-előzményre (Vitest a thread-CRUD-ra és a
   title-vágásra; a chat-handler agent-hívása mockolva).
5. Web: URL-betöltés + thread-lista.
6. Kézi füstteszt: új beszélgetés → URL-be kerül az id → reload → chipekkel együtt visszajön →
   thread-listából másik beszélgetés betölt.
7. Ezután indulhat az orchestrator-spec implementációja (külön branch, erről ágazva).

**Branch:** `feat/baseline-threads-customers` (push külön jelzésre). Az orchestrator-demó
branch erről ágazik majd.

## Nem cél (YAGNI)

- Auth / felhasználó-kezelés (a threadek globálisak).
- Thread törlés/átnevezés/keresés.
- Üzenet-szintű lapozás (LIMIT 50 thread, thread-en belül minden üzenet betöltődik).
- A CLI thread-támogatása (a perzisztencia web-only; a CLI marad ahogy van).
