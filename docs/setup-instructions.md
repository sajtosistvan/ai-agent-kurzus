# 2. óra: A fejlesztői környezettől az első működő agentig

Ez a leírás végigvezet azon, hogyan állítod fel a fejlesztői környezetedet, és hogyan építed fel vele lépésről lépésre az első működő AI agentedet, a `plantbase`-t, a saját gépeden. A cél konkrét és mérhető: a végén a `plantbase ask "..."` parancs valódi, természetes nyelvű választ ad egy adatbázis-kérdésre. Ez nem elméleti bevezető, hanem egy követhető út a nulláról a működő rendszerig, amit mindenki végig tud csinálni.

Végig két dolgot különböztetünk meg, és érdemes fejben szétválasztani őket. Az egyik az eszköz, **amivel építünk**: a Claude Code, egy fejlesztői AI agent, amelynek természetes nyelven utasításokat adsz, ő pedig megírja a kódot, futtatja a parancsokat és teszteli a munkát. A másik a termék, **amit építünk**: a plantbase, a mi saját agentünk, ami a felhasználó kérdését SQL-re fordítja és megválaszolja. A leírásban mindkettő szerepel: a Claude Code-nak adott utasítások hétköznapi, természetes nyelvűek, a plantbase saját belső utasítását (a system promptját) viszont strukturáltan, XML-szerűen írjuk meg. Ez a megkülönböztetés végig fontos lesz.

## 1. Mit építünk

A `plantbase` egy parancssori (CLI) AI agent egy növény-webshop katalógusa fölött. A felhasználó hétköznapi nyelven kérdez (például: „milyen alacsony fényt bíró szobanövényeim vannak 5000 Ft alatt, raktáron?"), az agent ezt SQL-re fordítja, lefuttatja a katalóguson, majd a kapott sorokból érthető, természetes nyelvű választ ad. A felhasználónak nem kell SQL-t tudnia, mégis önkiszolgáló módon kérdezhet az adatból.

A kulcs, hogy az alapoktól, rétegről rétegre építjük fel, hogy minden darab működése külön-külön is látszódjon. Először egy puszta parancssori program lesz, ami csak visszhangozza, amit beírsz. Aztán bekötjük egy LLM-be, így már beszélget, de még nem fér hozzá az adatbázishoz. Végül kap egy eszközt (a `runSql` toolt), amivel valóban lekérdezi a katalógust. A végállapot az, hogy a `plantbase ask "..."` helyes választ ad egy valódi kérdésre, és te pontosan érted, mi történik az egyes rétegekben.

Fontos, hogy ez nem „vibe coding". Nem annyit mondunk Claude-nak, hogy „csinálj egy appot", aztán elfogadjuk, ami kijön. Pontos leírást (a projekt doksijait) adunk be, tervet készíttetünk a kód előtt, minden lépés után átnézzük a változást, tesztelünk és commitolunk. Te irányítasz, az AI hajt végre, az ítélet a tiéd.

## 2. A fejlesztői környezet telepítése

Mielőtt bármit építenénk, fel kell raknod néhány eszközt. A sorrend logikus: előbb a fő eszköz (Claude Code), utána a futtatókörnyezet és a csomagkezelő (Node, pnpm), végül a kiegészítők (GitHub CLI, Docker, szerkesztő). Minden lépés mind a három platformon működik. Windowson a parancsokat PowerShellben (vagy WSL-ben) futtasd; a `docker compose`, `pnpm` és `gh` szintaxisa mindenhol azonos.

1. **Claude Code** (a fő eszköz, ezzel fogunk építeni). Telepítés:
   - macOS / Linux: `curl -fsSL https://claude.ai/install.sh | bash` (macOS-en alternatíva: `brew install --cask claude-code`).
   - Windows: PowerShellben `irm https://claude.ai/install.ps1 | iex` (natív telepítés), vagy WSL-ben a macOS/Linux-út.
   - Ne npm-mel telepítsd. Az első indításkor bejelentkezel: a `claude` parancs elindításakor, vagy a session-ben a `/login` paranccsal.

2. **Node LTS** (a futtatókörnyezet, erre épül a pnpm és a TypeScript-futtatás is). Telepítés:
   - macOS: `brew install node`, vagy nvm-mel.
   - Windows: `winget install OpenJS.NodeJS.LTS`, vagy nvm-windows. (WSL alatt a Linux-utat használd.)
   - Linux: a disztró csomagkezelője helyett ajánlott az nvm (`nvm install --lts`) vagy a NodeSource LTS-csomag.

3. **pnpm** (a csomagkezelő, ne npm). A Node része a corepack, ezzel kapcsolod be minden platformon: `corepack enable pnpm` (Windowson PowerShellben vagy a Terminálban).

4. **GitHub CLI** (`gh`). A Claude minden git- és GitHub-műveletet ezen keresztül végez, ezért kell. Telepítés:
   - macOS: `brew install gh`.
   - Windows: `winget install GitHub.cli` (vagy `scoop install gh`).
   - Linux: a disztró csomagkezelőjéből (apt/dnf), vagy a hivatalos GitHub CLI repóból.
   - Mindenhol, telepítés után: jelentkezz be a `gh auth login` paranccsal.

5. **Docker** (ez futtatja a lokális Postgres adatbázist egy konténerben). Telepítés:
   - macOS: **OrbStack** (`brew install --cask orbstack`) vagy Docker Desktop.
   - Windows: **Docker Desktop** (`winget install Docker.DockerDesktop`), WSL2 backenddel. (OrbStack csak macOS-en van.)
   - Linux: Docker Engine a disztró csomagkezelőjéből.

6. **Szerkesztő.** macOS / Linux: **Zed** (`brew install --cask zed`). Windowson **VS Code** (vagy Cursor) javasolt a Zed helyett, mert a Zed elsősorban Mac-re készült.

A végén ellenőrizd, hogy minden a helyén van. Futtasd ezeket, és mindegyik adjon vissza egy verziószámot:

```
claude --version
node -v
pnpm -v
gh --version
docker --version
```

## 3. Claude Code: hozzáférés és alapbeállítások

A Claude Code fizetős eszköz, tehát szükséged lesz hozzáférésre. Három út van. A legegyszerűbb az **előfizetés** (Pro, Max, Team vagy Enterprise): bejelentkezés-alapú, fix havidíjas, és a kurzusra ezt ajánljuk. A második az **Anthropic Console API kulcs**, ami pay-as-you-go, vagyis tokenenként fizetsz. A harmadik egy **felhős platform** (Amazon Bedrock, Google Vertex vagy Microsoft Foundry), ez inkább cégeknek való.

Ha előfizetést használsz, két korláttal érdemes számolni, amelyek egyszerre élnek. Az egyik egy gördülő, 5 órás ablak: a kereted 5 óránként újraindul, és ha beleütközöl, várnod kell a következő resetig. A másik egy heti felső keret, ami az 5 órás ablak fölött is érvényes.

Néhány alapbeállítást érdemes ismerned. A modellt a `/model` paranccsal váltod (Opus, Sonnet, Haiku), ez teljesítmény és költség közti döntés. Azt, hogy mennyit „gondolkodjon" válasz előtt, az `/effort` szabályozza. A jogosultságokat (meddig mehet jóváhagyás nélkül) a `Shift+Tab` váltogatja a futó session-ben. A `/rc` paranccsal a session-t webről vagy mobilról is irányíthatod. A tartós projekt-kontextust és szabályokat pedig a `CLAUDE.md` fájlban tartod, amit a `/init` hoz létre és a `/memory` szerkeszt. Ami tartós, azt a `settings.json`-ban is rögzítheted; ami pillanatnyi, azt menet közben slash-paranccsal vagy `Shift+Tab`-bal állítod.

A jogosultsági (permission) módokat különösen hasznos érteni, mert ezzel szabályozod, mennyire dolgozhat magától az agent:

- `default`: minden kockázatos lépésnél visszakérdez.
- `acceptEdits`: a fájlszerkesztéseket automatikusan elfogadja, de a futtatásoknál még kérdez.
- `plan`: read-only tervezés, vagyis előbb megmutatja a tervet, és nem nyúl semmihez.
- `auto` (research preview): nagyrészt magától dolgozik.
- `dontAsk`: nem kérdez vissza.
- `bypassPermissions`: minden engedélyt megkerül; ez veszélyes, csak elszigetelt konténerben használd.

A kurzuson főleg a `plan` (terv a kód előtt) és az `acceptEdits` (gördülékeny építés) között fogsz váltani a `Shift+Tab`-bal. Tartós beállításként a `settings.json`-ban így néz ki: `"permissions": { "defaultMode": "acceptEdits" }`.

## 4. Pluginek és MCP-szerverek

Két módon bővíted a Claude Code képességeit. A **pluginek** kész funkciócsomagok (parancsok, skillek, workflow-k), amelyeket egy „marketplace"-ből telepítesz. Az **MCP-szerverek** külső eszközöket kötnek be (GitHub, adatbázis, naprakész dokumentáció), így az agent nem csak a kódhoz fér hozzá, hanem ezekhez a rendszerekhez is.

A plugineket a session-ben a `/plugin` paranccsal telepíted. Mind a három, amire szükségünk van, a beépített `claude-plugins-official` marketplace-ből jön, ezt nem kell külön hozzáadni:

```
/plugin install superpowers@claude-plugins-official
/plugin install commit-commands@claude-plugins-official
/plugin install skill-creator@claude-plugins-official
```

A **superpowers** egy skill-gyűjtemény (például teszt-vezérelt fejlesztés és szisztematikus hibakeresés), a **commit-commands** a git/commit workflow-t adja (`/commit`), a **skill-creator** pedig saját skillek készítéséhez kell. A `/plugin` parancs egy interaktív böngészőt is nyit, ahol telepíthetsz és letilthatsz. Külső, nem hivatalos marketplace-t előbb így adsz hozzá: `/plugin marketplace add <github-repo-vagy-url>`, utána `/plugin install <plugin>@<marketplace>`.

Az MCP-szervereket terminálból (vagy a session-ben a `/mcp` felületen) adod hozzá. Mindegyiknél fontos a hatókör (scope): a **project** scope a repóba kerül (`.mcp.json`), így a csapattal megosztva; a **user** scope minden projektedben elérhető, de személyes; a **local** scope csak az adott projektben, személyesen él. Ezeket telepítsd:

```
# github (project scope) — issue-k és PR-ek kezelése, a repóba kerül, csapattal megosztva.
claude mcp add --transport http --scope project github https://api.githubcopilot.com/mcp/

# Context7 (user scope) — naprakész library-dokumentáció (Prisma, Nx, Anthropic SDK), kevesebb hallucináció.
claude mcp add --transport http --scope user context7 https://mcp.context7.com/mcp

# Postgres (project scope) — az agent rálát a products sémára, READ-ONLY lekérdezéssel fejlesztés közben.
# A read-only connection stringet írd be (a DATABASE_URL_READONLY értékét):
claude mcp add --scope project postgres -- npx -y @modelcontextprotocol/server-postgres "postgresql://plantbase_ro:JELSZO@localhost:5432/plantbase"

# Prisma (project scope) — migrate-dev / migrate-status és a Prisma Studio elérése Claude-ból.
claude mcp add --scope project prisma -- npx -y prisma mcp
```

A telepített MCP-ket a `claude mcp list`, `claude mcp get <név>` és `claude mcp remove <név>` paranccsal kezeled. Windowson a parancsok PowerShellben (vagy WSL-ben) ugyanígy működnek.

## 5. Indulás előtt: a projekt doksijai és a kulcsok

A plantbase felépítéséhez nem üres mappából indulsz: kapsz egy doksi-csomagot, amit kiindulásként beadsz Claude-nak. Ez írja le, mit kell felépíteni (üzleti követelmény, tech stack, architektúra, kódkonvenciók, fejlesztői workflow), plusz benne van a termék-agent system promptja is. A teljes anyag a kurzus repójában van:

```
https://github.com/sajtosistvan/ai-agent-kurzus
```

A repo `docs/` mappájában találod a hat doksit. Ezek tartalma a leírás végén, a 8. szekcióban egy az egyben olvasható, hogy itt is kéznél legyen. A gyakorlatban annyi a dolgod, hogy ezeket a fájlokat elérhetővé teszed Claude-nak a projektmappádban (például bemásolod őket egy `docs/` mappába), és a következő lépésben ráirányítod.

Mielőtt elindítod az építést, állítsd be a titkokat. Másold a repóban lévő `.env.example`-t `.env`-re, és töltsd ki a saját értékeiddel. Három dolog kell bele: az LLM API kulcsod (`ANTHROPIC_API_KEY`), egy írható-olvasható adatbázis-kapcsolat (`DATABASE_URL`), és egy csak olvasható kapcsolat (`DATABASE_URL_READONLY`):

```
ANTHROPIC_API_KEY=...          # LLM API kulcs
DATABASE_URL=...               # read-write — ezzel migrál és seedel a Prisma
DATABASE_URL_READONLY=...      # read-only — ezt használja az agent runSql toolja (csak SELECT)
```

A két adatbázis-kapcsolat szándékos, és ez a rendszer egyik legfontosabb biztonsági eleme. A Prisma az írható-olvasható kapcsolaton viszi a sémát, a migrációt és a seedet. Maga az agent viszont csak a read-only kapcsolaton kérdezhet, így soha nem tud adatot módosítani, akkor sem, ha rossz SQL-t generálna. A `.env` fájlt soha ne tedd gitbe; vedd fel a `.gitignore`-ba.

## 6. Az agent felépítése Claude Code-dal (lépésről lépésre)

Innen az agent felépíti a projektet, te pedig irányítod és ellenőrzöd. A módszer végig ugyanaz: terv a kód előtt, kis lépések, minden lépés után tesztelés és commit. Ha egy lépés túl nagyra nőne (sokáig „gondolkodik"), állítsd meg (`Esc`) és bontsd kisebbre.

**1. lépés: indítás és terv.** Indítsd el a Claude Code-ot a projektmappádban (`claude`). Add be neki a doksikat, és add ki az indító promptot, amely tervet kér a kód előtt. Ez a prompt egyben a teljes építés vázát is megadja (előbb a kész környezet, utána három implementációs fázis):

> Olvasd el a projekt dokumentációját, és ez alapján készíts egy implementációs tervet. A releváns library-dokumentációkat MINDEN esetben olvasd be Context7-tel, mielőtt kódolnál. Ha valami nem világos, kérdezz, mielőtt nekikezdenél.
>
> A tervet (proposal) írd a fájlrendszerbe, a /docs mappába. Logikusan fázisolj, hogy minden fázis végén tudjak tesztelni; minden fázis legyen kicsi, önállóan tesztelhető increment, a végén egy commit.
>
> A terv két nagy részből álljon:
>
> A) A KÖRNYEZET LÉTREHOZÁSA (mérföldkő: kész a környezet). Az út addig a pontig, ahol a projekt fut és tesztelhető: Nx monorepo (packages/core + apps/cli), packages/db a Prisma libbel (products séma + migráció), a kész seed betöltése, és egy üres CLI elindul. A függőségek, a seed-adat és a tesztek/scriptek már rendelkezésre állnak, ezekre építs, ne generáld újra a seed-adatot.
>
> B) AZ IMPLEMENTÁCIÓ 3 FÁZISA, EBBEN A SORRENDBEN, hogy a működés rétegről rétegre látszódjon:
>
> 1. fázis — CLI visszhang, LLM nélkül: a CLI-n keresztül interaktálok, és a program visszaírja, amit beírtam (echo). Még nincs LLM és nincs adatbázis.
> 2. fázis — LLM, adatbázis nélkül: a CLI-t bekötöd egy sima LLM-hívásba. Az agent válaszol, DE nincs adatbázis-hozzáférése, ezért az adatra vonatkozó kérdésnél őszintén jelzi, hogy nem fér hozzá az adatbázishoz, és nem tud válaszolni.
> 3. fázis — SQL-es interakció: bekötöd a runSql toolt. Az agent a kérdésből SQL-t ír, lefuttatja a katalóguson, és valós, természetes nyelvű választ ad.
>
> Minden implementációs lépés után kérd, hogy teszteljek.

Mielőtt jóváhagyod a tervet, érdemes `plan` módban (`Shift+Tab`) dolgozni, hogy Claude előbb csak a tervet mutassa meg, és ne nyúljon a fájlokhoz. Olvasd át, és ha jó, engedd tovább.

**2. lépés: a környezet létrehozása (A rész).** Itt Claude felépíti a vázat: létrehozza az Nx monorepót (a `packages/core` és az `apps/cli` csomaggal), a `packages/db` Prisma-libet a `products` sémával és a migrációval, betölti a kész seedet (kb. 30 növény), és elindít egy üres CLI-t. Itt indítod el a lokális adatbázist a projekt gyökerében:

```
docker compose up -d
```

Ezután ellenőrizd, hogy a migráció és a seed lefutott (a Postgres MCP-vel rá tudsz nézni a `products` táblára Claude-ból). Ez a mérföldkő: ha a projekt fut és van benne adat, kész a környezet.

**3. lépés: 1. fázis, CLI visszhang.** A legkisebb működő darab: a CLI visszaírja, amit beírsz, LLM és adatbázis nélkül. Teszteld: ha visszhangoz, mehetsz tovább. Ennek a lépésnek az értelme, hogy a parancssori belépési pont magában is működjön, mielőtt bármi okosat tenne.

**4. lépés: 2. fázis, LLM adatbázis nélkül.** Bekötöd a CLI-t egy egyszerű LLM-hívásba (az Anthropic SDK-val). Mostantól az agent beszélget és válaszol, de még nincs hozzáférése a katalógushoz. Tesztként kérdezz rá konkrét adatra: a jó viselkedés az, ha őszintén jelzi, hogy nincs adatbázis-hozzáférése. Ez a lépés mutatja meg, hogy az LLM önmagában nem tud a te adataidról.

**5. lépés: 3. fázis, SQL-es interakció.** Bekötöd a `runSql` toolt (a read-only kapcsolaton, csak SELECT). Innen az agent a kérdésből SQL-t ír, lefuttatja a katalóguson, és a sorokból természetes nyelvű választ ad. Ez a pont, ahol igazi agent lesz belőle: nyelvi modell, eszköz és többlépéses futás együtt.

**6. lépés: futtatás, a működő rendszer.** Tedd fel élesben a kérdést:

```
pnpm plantbase ask "Milyen alacsony fényt bíró szobanövényeim vannak 5000 Ft alatt, raktáron?"
```

Az agent SQL-t ír, a `runSql` lefuttatja, és visszakapsz egy valódi, természetes nyelvű választ. Ezen a ponton megvan az első működő agented, és érted, mi történik minden rétegben. Innen már csak bővíted (újabb kérdések, újabb toolok).

Végig tartsd magad a fegyelemhez: a tervet jóváhagytad, minden lépés után átnézted a változást (diff), teszteltél, és kicsi, fókuszált commitot csináltál. Ez a különbség a „vibe coding" és a felelős, agentic fejlesztés között.

## 7. Hogyan épül fel a rendszer

Hogy értsd, mit építettél, érdemes ránézni a szerkezetre. A projekt egy Nx monorepo: a `packages/core`-ban van az agent-logika (az LLM-hívás, a `runSql` tool, a séma-kontextus és a naplózás), a `packages/db`-ben a Prisma (séma, migráció, kliens, seed), az `apps/cli`-ben pedig a parancssori felület. A részletes fájlstruktúra és az indoklások a 8.3 (Architektúra) szakaszban olvashatók.

Három döntés viszi végig az egészet. Az első, hogy a core nem ismeri a belépési pontot: ma CLI hívja, később lehet API vagy web, anélkül hogy a magot újra kéne írni. A második a két adatbázis-kapcsolat: az agent csak read-only kapcsolaton kérdez (csak SELECT), a Prisma pedig külön, írható kapcsolaton kezeli a sémát és a seedet, így az agent soha nem módosíthat adatot. A harmadik az átláthatóság: minden interakciót naplózol, és egy `--show-prompt` kapcsolóval bármikor megnézheted a modellnek küldött teljes promptot.

A fejlesztést automatizmusokkal is támogathatod, ezek nem kötelezőek a működéshez. A leggyakoribb a szerkesztés utáni automatikus formázás (prettier) és a változáshoz tartozó tesztek futtatása (Vitest). Ezeket hookokként állítod be a `settings.json`-ban; a pontos konfiguráció a 8.5 (Fejlesztői workflow) szakaszban van. Fontos érteni, hogy ezek a hookok a Claude Code műveleteit fogják meg (amit ő szerkeszt vagy futtat), nem a termék futásidejű SQL-jét; azt a read-only adatbázis-kapcsolat védi.

## 8. Projekt-doksik (a Claude Code-nak átadott build-input)

Ezt a hat doksit adod be Claude Code-nak kiindulásként (lásd 5. és 6. szekció); a build erre a hat doksira épül. Forrás és a teljes kit (skillek, seed, agent, `.env.example`): https://github.com/sajtosistvan/ai-agent-kurzus

### 8.1 BRS — üzleti követelmény (build brief)

#### 1. Üzleti igény / probléma

A lakberendező (a persona) sok időt tölt azzal, hogy a szobák adottságai (fény, méret, szín), az ügyfél igényei és a növény-adatbázis alapján összeállítsa a megfelelő növénycsomagot.

Hol megy el az idő (a kézi munka java):

- webshop-nézegetés, keresgélés;
- méricskélés: belefér-e a térbe (aktuális és kifejlett magasság, cserépméret);
- raktárkészlet-ellenőrzés;
- akciók figyelése;
- belefér-e a büdzsébe.

Az adat megvan, de a kinyerése aprómunka, és SQL-tudást vagy elemzőt igényelne. Ez lassítja az ügyfél-ajánlat összeállítását.

##### ROI / mérőszámok

(Az 1. óra Hard/Soft ROI kerete szerint.)

**Hard (forintosítható):**

- Időmegtakarítás: 1 ügyfél átlagosan 3 szoba, jelenleg 10-15 perc/szoba kézzel; havi 5 ügyfél (~15 szoba/hó, ~2,5-3,75 óra/hó). **KPI: 1 szoba < 5 perc** az agenttel.
- Olcsóbb kosár: az agent megtalálja ugyanazt olcsóbban vagy jobb ár-érték alternatívát, és figyeli az akciókat → alacsonyabb beszerzési költség.

**Soft (valós, de nehezen forintosítható):**

- Magasabb ügyfélélmény (gyorsabb, pontosabb ajánlat).
- Jobb minőségű munka (jobb illeszkedés a tér és az ügyfél igényeihez).

**Bővítési képesség (későbbi):** a lakberendező korábbi döntéseinek elemzése → jobb javaslat (ugyanaz olcsóbban, jobb alternatíva). Ehhez az ajánlás-történet tárolása kell; a v1 csak a katalógus felett dolgozik.

#### 2. Megoldás

`plantbase`: parancssori (CLI) AI agent, amely a természetes nyelvű kérdést SQL-re fordítja a növény-katalógus (`products`) felett, read-only lefuttatja, és természetes nyelvű választ ad. Önkiszolgáló analitika SQL-tudás nélkül.

Skálázódási irány a kurzus során: otthoni segéd → ecommerce → ügyfélszolgálat → logisztika. Ugyanaz a minta (LLM + tool + adat) skálázódik.

#### 3. Hatókör (scope, v1)

Benne (v1):

- A `products` katalógus feletti természetes nyelvű kérdés-válasz.
- Read-only adat-elérés.
- CLI felület: `ask` parancs + interaktív mód.

Kívül (későbbi órák):

- Rendelés/bevétel adat, írás vagy módosítás.
- Web és voice felület.
- Több felhasználó, jogosultságkezelés.

#### 4. Követelmények

##### Funkcionális (FR)

- **FR1, Kérdezés:** `plantbase ask "<kérdés>"` egyszeri lekérdezés, és interaktív readline mód (amíg `exit`).
- **FR2, NL → SQL:** az agent az LLM-mel SQL-t generál, és a `runSql` toolon keresztül futtatja; több lépéses (multistep) loop a végleges válaszig.
- **FR3, Válasz:** a lekérdezés eredményéből természetes nyelvű választ ad.
- **FR4, Naplózás:** minden interakciót logol (`logs/<timestamp>.jsonl`): system prompt, üzenetek, generált SQL, eredmény, válasz, token-felhasználás.
- **FR5, Átláthatóság:** `--show-prompt` mód, amely kiírja a teljes üzenet-tömböt.

##### Nem-funkcionális (NFR)

- **NFR1, Biztonság:** az agent read-only adatbázis-kapcsolaton fut, csak SELECT.
- **NFR2, Átláthatóság:** a működés naplóból és `--show-prompt`-ból követhető.
- **NFR3, Karbantarthatóság:** a `konvenciok.md` és `architektura.md` betartása.
- **NFR4, Reprodukálhatóság:** a projekt a `stack.md` szerinti, legfrissebb stabil eszközökkel felépíthető.

#### 5. Sikerkritériumok

- A felhasználó természetes nyelven kérdez a katalógusról, és helyes, érthető választ kap SQL-tudás nélkül.
- Demo-kritérium: élő kérdés → helyes SQL → helyes válasz.
- Az agent soha nem módosítja az adatot (csak SELECT, read-only kapcsolat).
- Minden interakció naplózva; a működés `--show-prompt`-tal átlátható.
- **Hatékonyság (KPI):** egy szoba növénycsomagja 5 perc alatt összeállítható (a korábbi 10-15 perc helyett).

#### 6. Adat

A `products` (növény-katalógus) tábla a domain. A pontos séma a `stack.md`-ben. Szintetikus, kb. 30 növényes seed, valós fajnevekkel és reális attribútumokkal.

### 8.2 Tech stack + products séma

Elv: iparági best practice, legfrissebb STABIL verzió (se cutting-edge, se elavult).

- Nyelv / monorepo: TypeScript (strict), Nx, pnpm, Node LTS
- DB: PostgreSQL lokálisan docker-compose-ban (OrbStack futtatja), Prisma (ORM: séma, migráció, seed, typed query). Helyben dolgozunk, nincs felhő-DB.
- Agent: Anthropic SDK (hivatalos kliens, nem nyers HTTP) + saját tool-use loop, agent-framework nélkül. Zod (validáció)
- CLI: commander + node:readline
- Tooling: Vitest, ESLint + Prettier, tsx
- Eszköz: Zed, gh CLI

#### products séma

```sql
products (
  id            serial primary key,
  name          text,        -- köznapi név
  latin_name    text,
  category      text,        -- szobanövény / kerti / pozsgás / kaktusz / fűszer / fa-cserje / lógó / virágzó
  location      text,        -- beltéri / kültéri / mindkettő
  price             numeric,  -- ár (HUF)
  sale_price        numeric,  -- akciós ár (ha van akció), különben null
  stock             int,      -- raktárkészlet (db)
  light             text,     -- árnyék / alacsony / közepes / erős / direkt nap
  watering          text,     -- ritka / közepes / gyakori / állandóan nedves
  difficulty        text,     -- kezdő / haladó / profi
  current_height_cm int,      -- aktuális magasság
  max_height_cm     int,      -- kifejlett (max) magasság
  current_pot_cm    int,      -- aktuális cserépméret
  pet_safe          boolean,  -- háziállat-barát
  kid_safe          boolean,  -- gyerekbiztos (nem mérgező)
  air_purifying     boolean,  -- légtisztító
  rating            numeric,  -- 0-5
  reviews_count     int,
  description       text
)
```

##### Értékkészletek (kategorikus mezők)

- **category:** szobanövény, kerti, pozsgás, kaktusz, fűszer, fa-cserje, lógó, virágzó
- **location:** beltéri, kültéri, mindkettő
- **light:** árnyék, alacsony, közepes, erős, direkt nap
- **watering:** ritka, közepes, gyakori, állandóan nedves
- **difficulty:** kezdő, haladó, profi
- **bool:** pet_safe, kid_safe, air_purifying

### 8.3 Architektúra (fájlstruktúra + döntések)

#### Fájlstruktúra (Nx monorepo)

```
plantbase/
├── packages/core   agent-logika (LLM-hívás, runSql tool, séma-kontextus, naplózás)
├── packages/db     Prisma lib (séma, migráció, kliens, seed) — NEM a gyökérben
├── apps/cli        CLI (ask parancs + interaktív mód)
├── docs            dokumentáció (lásd dev-workflow.md)
└── konfig          nx, package.json, .env, docker-compose

Később (NEM most): apps/api (4. óra), apps/web (5. óra)
```

(Csak nagy vonalakban; a fájl-szintű bontást Claude generálja a konvenciók szerint.)

#### Főbb technológiai döntések

1. **Framework-agnostic core.** A `packages/core` nem ismeri a belépési pontokat (CLI/API/web). Új felület = új app, nem újraírás. (Mastra majd az 5. órán a core köré.)
2. **Két DB-kapcsolat, két jog.** Az agent `runSql`-je READ-ONLY kapcsolaton fut (`DATABASE_URL_READONLY`), csak SELECT. A Prisma READ-WRITE kapcsolaton (`DATABASE_URL`) viszi a sémát, migrációt, seedet. Az agent NEM Prismán kérdez.
3. **Saját agent-loop.** Az `askAgent` az Anthropic SDK-ra (hivatalos kliens, nem nyers HTTP) épülő, kézzel írt tool-use loop, agent-framework nélkül, hogy a mechanika látható maradjon ("az alapoktól").
4. **Átláthatóság beépítve.** Minden interakció JSONL-be naplózva; `--show-prompt` a teljes prompt megjelenítéséhez.
5. **Lokális DB.** docker-compose Postgres, OrbStack futtatja. Helyben dolgozunk, nincs felhő-DB.
6. **Prisma külön Nx lib.** A Prisma (séma, migráció, kliens, seed) a `packages/db` libben él, NEM a repo gyökerében: a séma az Nx graph része, a core és a seed onnan importál.
7. **Library-doksi munka előtt.** Új vagy ritkán használt API-nál (pl. Prisma) ELŐBB beolvassuk a doksit Context7-tel, csak utána kódolunk, mert így kevesebb a hiba a tesztek alatt.

Konvenciók: `konvenciok.md`. Git/hook/automatizmus: `dev-workflow.md`.

### 8.4 Kódkonvenciók

#### Naming

- `camelCase` változó/függvény, `PascalCase` típus/osztály/komponens, `UPPER_SNAKE` konstans.
- Beszédes nevek; boolean: `is`/`has`/`can` prefix; függvény = ige (`fetchUser`, `parseQuery`).
- Fájlnév: `kebab-case`. Egy fájl egy felelősség.

#### TypeScript

- `strict` mód. Explicit típus a publikus API-n; lokálisan elég az inferencia.
- `unknown` a külső/megbízhatatlan inputra, NEM `any`; szűkíts biztonságosan.
- `interface` objektum-alakra (ami bővülhet), `type` unió/intersection/utility-re. String literal union `enum` helyett.
- Immutabilitás, ne mutálj:
  ```ts
  // rossz: obj.x = 1
  // jó:    const next = { ...obj, x: 1 }
  ```

#### Hibakezelés

- async `try/catch`; az `unknown` errort szűkítsd (`instanceof Error`).
- Ne nyeld el a hibát némán; UI-facing üzenet + szerver-oldali részletes log.
- Validáció a rendszer-határokon (Zod), fail-fast, beszédes hibaüzenet.
  ```ts
  const Input = z.object({ text: z.string().min(1) });
  ```

#### Tesztelés

- TDD ahol értelmes: piros (bukó teszt) → zöld (minimál implementáció) → refaktor.
- Szintek: unit (függvények), integration (DB/API), E2E kritikus flow-ra (Playwright).
- Egy teszt egy dolgot ellenőrizzen; beszédes nevek ("should ... when ...").
- Determinista, izolált tesztek; ne függj külső/globális állapottól vagy időzítéstől.
- Cél: 80%+ lefedettség.

#### Fájlszervezés

- Sok kis, fókuszált fájl (200-400 sor, max 800). Magas kohézió, alacsony csatolás.
- Feature/domain szerint rendezz, ne típus szerint.
- Nincs mély beágyazás (>4 szint); korai return.

#### Naplózás

- Nincs `console.log` a termékkódban → strukturált logger.

#### Biztonság

- Titkok env-ben (`.env`), soha a repóba (gitignore).
- Minden külső adat (user input, API-válasz, LLM-output) megbízhatatlan: validáld, ne bízz benne.
- Paraméterezett lekérdezések; ne építs query-t string-konkatenációval.

#### Az agent promptjai (XML-szerű struktúra)

- Amit a **TERMÉK** ad át az LLM-nek (a system prompt és az askAgent üzenetei), azt **XML-szerű tagekkel** strukturáljuk: így a részek elkülönülnek, és csökken a hallucináció.
- Ez NEM a fejlesztői, Claude Code-nak adott promptokra vonatkozik, azok természetes nyelvűek maradnak.
- Ajánlott tagek: `<role>`, `<schema>`, `<rules>`, `<examples>`, `<question>` (a nevek szabadon választhatók, de legyenek beszédesek és konzisztensek).
- Minta (a plantbase agent system promptjából):
  ```xml
  <role>Plantbase asszisztens vagy: növény-katalógus kérdésekre válaszolsz.</role>
  <schema>products(id, name, category, price, sale_price, light, watering, pet_safe, stock, ...)</schema>
  <rules>
  - Csak SELECT-et generálj. ILIKE a szöveges szűrésre, mindig LIMIT.
  - Ár: COALESCE(sale_price, price).
  - Ha nincs találat, mondd meg; ne találj ki oszlopot vagy táblát.
  </rules>
  ```

#### Git

- Conventional Commits, feature branch, kicsi fókuszált commitok. Részletek: `dev-workflow.md`.

### 8.5 Fejlesztői workflow + automatizmus

#### Git

##### Branching

- `main`: mindig zöld, deploy-olható. Közvetlenül main-re NEM commitolunk.
- Feature branch: `feat/<rövid-leírás>` (pl. `feat/runsql-tool`). Egyéb prefixek: `fix/`, `refactor/`, `docs/`, `chore/`.
- A kurzus checkpointjai (`stage-N`) branchek a fallbackhez.

##### Commit (Conventional Commits)

Formátum: `<típus>: <leírás>`. Típusok: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.
Példák: `feat: add read-only runSql tool`, `test: cover runSql SELECT-only guard`.

##### Auto-commit

Minden befejezett, koherens lépés után kicsi, fókuszált commit (egy lépés = egy commit). Lásd a `Stop` hookot.

#### Hookok (`settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "pnpm prettier --write $FILE",
            "timeout": 10000,
            "async": true
          },
          {
            "type": "command",
            "command": "pnpm vitest related --run $FILE",
            "timeout": 60000,
            "async": true
          }
        ]
      }
    ]
  }
}
```

- **prettier** (PostToolUse, Edit): formázás szerkesztés után.
- **teszt** (PostToolUse, Edit): a változáshoz tartozó Vitest fut.

FONTOS: a hookok a **Claude Code (L1) akcióit** fogják meg (amit Claude szerkeszt/futtat), NEM a termék futásidejű SQL-jét. A termék read-only védelme a **DB-kapcsolat (read-only role)**, nem hook, mert a `runSql` a termék kódja, nem Claude Code tool.

#### /docs (a repóban)

```
docs/
├── ddd/
│   ├── glossary.md        ubiquitous language (növény, kategória, fényigény, gondozás...)
│   └── model.md           entitások, value objectek, aggregátumok
└── tech/
    ├── infra.md           Postgres (OrbStack docker-compose), .env, a két DB-kapcsolat
    ├── architecture.md    core/apps, adat-elérés, read-only vs Prisma
    └── api.md             tool/CLI felület (ask, runSql)
```

#### Dokumentáció-frissítés

A `/docs` dokumentációt igény szerint, külön lépésben frissíted (a git-history alapján). Az elején nem készítünk hozzá automatizmust; a CI-alapú változat a 4. órán jön (always-on / CI/CD).

### 8.6 A termék system promptja (L2, XML-szerűen tagolt)

Ez NEM a Claude Code-nak adott build-prompt, hanem maga a plantbase termék-agent utasítása. A build során a `core/schema-context` ezt adja a modellnek.

```xml
<role>
Te a Plantbase asszisztens vagy: egy lakberendezőnek (és otthoni felhasználóknak) segítesz növényt választani és növénycsomagot összeállítani egy webshop katalógusa alapján.
</role>

<task>
A felhasználó természetes nyelvű kérdését fordítsd SQL-re a products tábla felett, futtasd le a runSql toollal, majd a kapott sorokból adj rövid, érthető, magyar nyelvű választ.
</task>

<schema>
products (
  id, name, latin_name,
  category,                              -- szobanövény / kerti / pozsgás / kaktusz / fűszer / fa-cserje / lógó / virágzó
  location,                              -- beltéri / kültéri / mindkettő
  price, sale_price, stock,              -- ár, akciós ár (null ha nincs), raktárkészlet
  light,                                 -- árnyék / alacsony / közepes / erős / direkt nap
  watering,                              -- ritka / közepes / gyakori / állandóan nedves
  difficulty,                            -- kezdő / haladó / profi
  current_height_cm, max_height_cm,      -- aktuális és kifejlett magasság
  current_pot_cm,                        -- aktuális cserépméret
  pet_safe, kid_safe, air_purifying,     -- háziállat-barát, gyerekbiztos, légtisztító
  rating, reviews_count, description
)
</schema>

<rules>
- CSAK SELECT. Soha ne módosíts adatot (INSERT/UPDATE/DELETE/DDL tilos).
- Mindig tegyél LIMIT-et (alapból 20-50).
- Szöveges keresés: ILIKE (kis/nagybetű-független), pl. name ILIKE '%pozsgás%'.
- Ár: a tényleges ár COALESCE(sale_price, price) (ha van akció, az számít). Büdzsénél ezzel számolj.
- Raktár: ha "raktáron" a kérés, szűrj stock > 0-ra.
- Méret: current_height_cm az aktuális, max_height_cm a kifejlett magasság, current_pot_cm a cserépméret.
- Gondozás: light (fény), watering (öntözés), difficulty (nehézség), pet_safe (háziállat-barát).
</rules>

<behavior>
- Ha a kérdés kétértelmű (hiányzik a büdzsé, a szoba adottsága vagy a darabszám), KÉRDEZZ vissza, mielőtt találgatnál.
- Csomag-összeállításnál vedd figyelembe a büdzsét (összár) és a szoba adottságait (fény, méret).
- A válaszban emeld ki a döntéshez fontos attribútumokat: ár (és akció), raktárkészlet, méret-illeszkedés, fény/öntözés/gondozás.
- Légy tömör: a végén természetes nyelvű összegzés, ne nyers tábla-dump.
- Ne találj ki nem létező oszlopot vagy táblát.
</behavior>

<tools>
- runSql(query): read-only SQL futtatás a katalóguson. A generált SQL-t mindig ezzel futtasd, ne csak kiírd.
</tools>
```
