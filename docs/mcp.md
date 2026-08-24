# MCP — a Plantbase mint eszköz egy IDEGEN agent kezében

Eddig minden belépési pontnál **mi** hívtuk a modellt: a CLI, a HTTP-szerver és a web ugyanazt
az agent-loopot indította el. Az MCP (Model Context Protocol) megfordítja az irányt: itt egy
**idegen host** (Claude Desktop, Claude Code) modellje hívja a **mi** tooljainkat.

```
  eddig:   felhasználó → CLI/web → plantbase agent → toolok → DB
  most:    felhasználó → Claude  → MCP → plantbase toolok → DB
                                   └── ask_plantbase esetén: → plantbase agent → toolok → DB
```

A `@plantbase/core` most sem tud arról, hogy létezik az MCP-réteg — az `apps/mcp` a negyedik
belépési pont a `cli`, `server`, `web` mellett.

## A három tool — három stílus, szándékosan

| | `search_plants` | `search_knowledge` | `ask_plantbase` |
|---|---|---|---|
| Mi fut mögötte | egy paraméterezett `SELECT` | a core RAG-pipeline-ja | a **teljes query-agent loop** |
| Ki gondolkodik | a **hívó** modell (Claude) | a **hívó** modell | a **mi** agentünk |
| Válasz | nyers JSON sorok | chunkok + forrás-URL-ek | kész, magyar szöveg forrásokkal |
| Sebesség | ~10 ms | 1–2 kis modellhívás | több modellhívás, másodpercek |
| Tesztelhetőség | unit-teszt (determinisztikus) | a core-ban tesztelt | csak end-to-end |
| Domén-tudás helye | a hívó kontextusában | a hívó kontextusában | a **mi** promptunkban |

**`search_plants`** a klasszikus MCP-minta: adatot szolgáltatunk, a hívó modell dönt. Olcsó,
kiszámítható, a hívó szabadon kombinálja a saját kontextusával (pl. „a fenti lista alapján
írj a kollégának egy emailt").

**`search_knowledge`** nem új logika, hanem egy **átkötött** core-tool. A core-ban minden tool
két részre van vágva: `executeSearchKnowledge` (határvédelem + logika) és `searchKnowledgeTool`
(az AI SDK-nak szóló definíció). Az MCP-nek csak a második fele idegen — az elsőt változtatás
nélkül újrahasználjuk, így az egész tool ~20 sor. Ez a jutalma annak, hogy a logika nem tapadt
az SDK-hoz.

**`ask_plantbase`** az *agent-as-tool*: a hívó számára ez egy sima tool, de mögötte a mi
promptunk, a mi SQL-szabályaink és a RAG tudásbázisunk fut. A hívó modellnek nem kell tudnia,
hogy néz ki a `products` tábla. Cserébe fekete doboz: a hívó nem látja a lépéseket — a trace
nálunk marad (`logs/<ts>.json`).

A tanulság nem az, hogy melyik a jobb, hanem hogy **hol akarod tartani a domén-tudást**.

## Két csapda a stdio-transportnál

**1. A stdout a protokollé.** stdio-n a JSON-RPC üzenetek a stdout-on mennek — egyetlen odaírt
`console.log` használhatatlanná teszi a szervert. A core több helyen ír a stdout-ra (a színes
trace, a RAG-nyom `traceLog`-ja). Ezért a `main.ts` az induláskor **elveszi a stdout-ot**: a
protokoll az eredeti csatornát kapja, minden más `process.stdout.write` a stderr-re megy (azt a
host naplózza). Ezen felül az `askAgent` hívás `print: false`.

**2. Az MCP-felület jogosultsága.** Az `ask_plantbase` fixen `role: 'customer'` szereppel hívja
az agentet. Adminként a query-agent megkapná a `delegateToIngest` toolt — azzal az MCP-n át
**írni** lehetne a katalógusba. Az MCP-felület read-only marad; a `search_plants` értékei pedig
`$1, $2, …` paraméterként mennek (soha nem az SQL szövegében), és a lekérdezés átmegy a core
`ensureReadOnlySelect` guardján is.

## Bekötés dev módban

### Claude Code

A repo gyökerében van egy `.mcp.json` — a projekt megnyitásakor a Claude Code felajánlja a
szerver engedélyezését. Kézzel:

```bash
claude mcp add --scope project plantbase -- pnpm mcp
claude mcp list          # állapot: ✓ connected
```

### Claude Desktop — GUI-ból, Extensionként (ez a demó-út)

**A Connectors menü NEM erre való**: az távoli, URL-es szervereket vesz fel. Egy lokális stdio
szerver ott soha nem jelenik meg. Lokálisat a GUI-ból **Extension** (`.mcpb` csomag) formájában
lehet telepíteni — így ül a gépen a filesystem, az iMessage vagy a Figma is.

```bash
pnpm mcp:mcpb        # → dist/plantbase.mcpb
```

Aztán **Beállítások → Extensions → Advanced settings → Install extension…** (vagy húzd rá a
fájlt az ablakra). Telepítéskor a Desktop **mappaválasztót** mutat: add meg az `ai-agent-kurzus`
checkout gyökerét.

⚠️ Ez **dev-csomag**: nem tartalmazza a szervert, hanem a repóban lévő ÉLŐ forrást indítja
(`mcpb/server/launcher.js` → `tsx` → `apps/mcp/src/main.ts`, `stdio: 'inherit'`). Pont ezt
akarjuk órán: a kódot élőben szerkesztjük, és a következő tool-hívás már az új kódot futtatja.
Egy terjeszthető MCPB mindent becsomagolna (esbuild-bundle + vendorolt `node_modules`) — itt az
lenne a rossz válasz.

### Claude Desktop — kézzel, a config-fájlban

A Desktop nem örökli a shell PATH-ját, ezért **abszolút út** kell, és az `.env`-et a `cwd`-ből
tölti. `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plantbase": {
      "command": "/abszolút/út/node",
      "args": ["/abszolút/út/ai-agent-kurzus/node_modules/tsx/dist/cli.mjs",
               "--conditions=@plantbase/source",
               "/abszolút/út/ai-agent-kurzus/apps/mcp/src/main.ts"],
      "cwd": "/abszolút/út/ai-agent-kurzus"
    }
  }
}
```

⚠️ A tsx-nél a **`tsx/dist/cli.mjs`** kell, NEM a `node_modules/.bin/tsx` — az utóbbi egy
shell-wrapper, amit a Node nem tud futtatni (és a wrapper viszont a PATH-ból keresné a node-ot,
ami a Desktop alatt szintén nincs meg). A `cwd` sem elhagyható: abból töltődik az `.env`.

### Inspector (host nélküli teszt) — a DEMÓRA is ez a legjobb

Két GUI van, mindkettő ugyanazt a szerverünket beszéli:

```bash
pnpm mcp:inspect     # hivatalos MCP Inspector — a szervert MAGA indítja
pnpm mcp:mcpjam      # MCPJam — a szervert a GUI-ban veszed fel, és LLM-mel is chatelhetsz
```

⚠️ **Port-ütközés:** mindkettő a **6274**-et akarja alapból. Ezért a `mcp:inspect` a 6280/6281-re
van állítva (`CLIENT_PORT` / `SERVER_PORT`), így a kettő egyszerre futhat — demón ez kell, mert
egymás mellett mutatod őket.

A hivatalos Inspector a linkben **auth tokent** ad; a kiírt teljes URL-t nyisd meg, ne csak a
`localhost:6280`-at.

Miért jobb ez demóra, mint egy host: látszik a **séma**, a nyers **JSON-RPC** forgalom és a
tool-eredmény formázatlanul — vagyis maga a protokoll, nem csak a hatása.

## Előfeltételek

Ugyanaz, mint a CLI-nél: futó Postgres (`docker compose up -d`), `.env` a repo gyökerében
(`ANTHROPIC_API_KEY`, `DATABASE_URL_READONLY`). Az `ask_plantbase` modellt hív, tehát tokenbe
kerül; a `search_plants` nem.

## Remote (HTTP) — hogy URL-ből bárki hozzáadhassa

```
main.ts (stdio)  →  a host INDÍTJA a folyamatot a te gépeden. Egy felhasználó, egy gép.
http.ts (HTTP)   →  a szerver a NETEN fut, a host CSATLAKOZIK hozzá. Bárki, URL-lel.
```

A tooljaink és a `plantbase-server.ts` egyetlen sorát sem kellett hozzányúlni — ez az MCP
lényege: a képességek és a szállítás külön rétegek.

```bash
MCP_PUBLIC_TOKEN=valami-hosszú-véletlen pnpm mcp:http    # → localhost:3010/mcp/<token>
```

**Stateless mód**: kérésenként új szerver + transport (`sessionIdGenerator: undefined`), így több
konténer mögött sincs ragadós munkamenet.

### Auth — amit tudni kell

**A Claude connector-felületén nem lehet saját fejlécet (`Authorization`) megadni** — vagy OAuth,
vagy semmi. Ezért a titok az ÚTVONALBA kerül (*capability URL*): `MCP_PUBLIC_TOKEN` beállításával
a végpont `/mcp/<token>`, rossz token → 404. Ez **nem** OAuth: aki látja a linket, hívhatja.
Kurzusra pont jó arány (kiosztod, óra után forgatod), éles termékhez OAuth kell.

Ha a `MCP_PUBLIC_TOKEN` nincs beállítva, a végpont `/mcp` és **nyitott** — a szerver ezt indulásnál
ki is írja.

⚠️ Az `ask_plantbase` **modellt hív**, tehát minden hívás a mi API-kulcsunkat költi. Ezért van
IP-alapú rate limit (5 perc / 60 kérés), és ezért kell a tokent cserélni, ha kikerül.

### Railway

Új service ugyanabban a projektben, ahol a Postgres és a web fut. `apps/mcp/railway.json` a
konfiguráció (Nixpacks, `pnpm mcp:http`, health check a `/health`-en).

Kötelező változók: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (a RAG-embeddinghez), `DATABASE_URL_READONLY`
(belső hálón a Postgres read-only szerepkörével), `MCP_PUBLIC_TOKEN`. A `PORT`-ot a platform adja.

Bekötés a Claude-ba: **Beállítások → Connectors → Add custom connector**, és a teljes URL:
`https://<railway-domain>/mcp/<token>`.
