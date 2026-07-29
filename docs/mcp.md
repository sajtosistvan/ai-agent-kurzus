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

### Claude Desktop

A Desktop nem örökli a shell PATH-ját, ezért **abszolút út** kell, és az `.env`-et a `cwd`-ből
tölti. `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plantbase": {
      "command": "/abszolút/út/node",
      "args": ["/abszolút/út/ai-agent-kurzus/node_modules/.bin/tsx",
               "--conditions=@plantbase/source",
               "/abszolút/út/ai-agent-kurzus/apps/mcp/src/main.ts"],
      "cwd": "/abszolút/út/ai-agent-kurzus"
    }
  }
}
```

### Inspector (host nélküli teszt)

```bash
pnpm mcp:inspect
```

Böngészőben nyílik: tool-lista, séma, kézi hívás, nyers JSON-RPC forgalom. **Mindig ezzel
teszteld először** — sokkal gyorsabb visszajelzés, mint egy host újraindítgatása.

## Előfeltételek

Ugyanaz, mint a CLI-nél: futó Postgres (`docker compose up -d`), `.env` a repo gyökerében
(`ANTHROPIC_API_KEY`, `DATABASE_URL_READONLY`). Az `ask_plantbase` modellt hív, tehát tokenbe
kerül; a `search_plants` nem.

## Ha remote (HTTP) kell

Az `apps/mcp/src/main.ts`-ben a `server` objektum változatlan marad, csak a transport cserélődik
(`StreamableHTTPServerTransport` + Express + bearer token). Ez kell akkor, ha nem a saját gépeden
futna, vagy ha ChatGPT-be is be akarnád kötni — az csak remote HTTPS URL-t fogad el.
