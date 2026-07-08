# Web chat UX quick wins

**Scope:** `apps/web` (a böngészős Plantbase chat). Három, egymástól független, kis hatókörű UX-fejlesztés a jelenlegi `useChat`-alapú streamelő chat fölé:

1. Markdown-renderelés az assistant-válaszokon
2. Okos auto-scroll (shadcn `message-scroller`)
3. Stop gomb streamelés közben

Nem cél: perzisztencia (localStorage), hibamegjelenítés, multiline input, copy gomb — ezek külön kör.

## 1. Markdown renderelés

**Probléma:** az agent válaszai markdown-formázottak (`**félkövér**`, `### fejléc`, listák, `---`, `~~áthúzás~~`), de a kliens jelenleg nyers szövegként jeleníti meg őket (lásd a `parts.filter(text).join('')` jelenlegi logikát).

**Megoldás:**
- Új függőségek az `apps/web`-ben: `react-markdown`, `remark-gfm`, `@tailwindcss/typography`.
- A `styles.css`-be (Tailwind v4, CSS-alapú config) egy `@plugin "@tailwindcss/typography";` sor kerül az `@import 'tailwindcss';` után.
- Csak az **assistant** szerepű üzenetek szövegrészét rendereljük `<ReactMarkdown remarkPlugins={[remarkGfm]}>`-vel. A **user** üzenetek maradnak sima szöveg (nincs értelme markdownt parse-olni a user saját beírt kérdésén).
- Az assistant-buborék class-ai: `prose prose-sm max-w-none` — a `max-w-none` szükséges, mert a `.prose` alapból `65ch`-ben maximalizálja a szélességet, ami ütközne a buborék saját `max-w-[85%]`-ával.
- Az assistant-buborék konténere `inline-block`-ról blokk-szintű `div`-re vált (a user-buborék marad `inline-block`, jobbra igazítva) — rich tartalomnál (fejléc, lista, `---`) ez a természetesebb megjelenés.

**Edge case-ek:**
- Streamelés közben a markdown időnként "félbevágott" (pl. nyitott `**` lezárás nélkül) — a `react-markdown` ezt nem dobja hibaként, legfeljebb átmenetileg máshogy renderel egy karaktert, ami a következő tokennel helyreáll. Nincs szükség külön kezelésre.
- Üres/whitespace-only assistant szöveg (nem várt, de védekezésül): a `ReactMarkdown` üres inputtal nem hibázik, üres `div`-et renderel.

## 2. Okos auto-scroll (shadcn `message-scroller`)

**Probléma:** a jelenlegi `<div className="flex-1 ... overflow-y-auto">` nem görget automatikusan, és nincs semmilyen logika arra, hogy streamelés közben kövesse-e a legalját vagy sem.

**Megoldás:**
- Telepítés: `pnpm dlx shadcn@latest add message-scroller` az `apps/web` könyvtárban (a `components.json` már be van állítva `new-york` stílusra, `@/components/ui` alias-szal) — ez a `src/components/ui/message-scroller.tsx`-be scaffoldolja a headless komponenst + a hozzá tartozó primitíveket. Pontos extra runtime-függőség a CLI futtatásakor derül ki (várhatóan nincs, mert a komponens leírása szerint "React primitívekre épül, nincs külső scroll-lib").
- A jelenlegi üzenetlista JSX-et lecseréljük erre a hierarchiára:
  ```
  MessageScrollerProvider (autoScroll)
    MessageScroller
      MessageScrollerViewport
        MessageScrollerContent
          MessageScrollerItem (messageId={m.id}, scrollAnchor={m.role === 'user'})
            ... a jelenlegi üzenet-JSX (markdown/plain szöveg) ...
      MessageScrollerButton
  ```
- `scrollAnchor` a **user**-üzeneteken van bekapcsolva — ezek jelölik az új "kört" (a komponens ilyenkor a user kérdését húzza a viewport tetejéhez közel, ahogy a válasz streamel alá).
- `MessageScrollerButton`: a beépített "ugrás a legaljára" gomb, ami akkor jelenik meg/aktív, ha a user felgörgetett és lemaradt az élő streamről.

**Viselkedés (a komponens saját logikája, nem nekünk kell megírni):**
- Ha a user a legalján van, új token érkezésekor követi a legalját.
- Ha a user felgörgetett, az automatikus görgetés kikapcsol, amíg vissza nem görget vagy meg nem nyomja a `MessageScrollerButton`-t.

## 3. Stop gomb

**Probléma:** hosszú válasz streamelése közben nincs mód megszakítani.

**Megoldás:**
- A `useChat()` hívásból mostantól a `stop` függvényt is destrukturáljuk.
- A küldés-gomb (jelenleg mindig `<Send />`, `disabled={loading}`) viselkedése:
  - **Nem streamel** (`status === 'ready' | 'error'`): jelenlegi viselkedés — `<Send />` ikon, `type="submit"`, `disabled` ha üres az input.
  - **Streamel** (`status === 'submitted' | 'streaming'`): ikon `<Square />`-re vált (lucide, már importálva van a `lucide-react`), a gomb `type="button"`, `onClick={() => stop()}`, és **nem** disabled (ez a lényege — meg kell tudni szakítani).
- Megszakításkor a `useChat` addig megérkezett részleges assistant-szöveget a beszélgetésben hagyja (ez a `stop()` alapviselkedése, nem kell külön kezelnünk).

## Nem cél / kizárva ebből a körből

- Hibaüzenet UI (`useChat().error` megjelenítése)
- Multiline input / Shift+Enter
- Copy-to-clipboard gomb
- localStorage-perzisztencia
- Kattintható példakérdés-chip-ek

## Tesztelés

Tisztán UI-változás; a projekt konvenciója szerint az `apps/web` réteg jelenleg nem unit-tesztelt (a `core` van tesztelve), ez a három funkció is manuális böngésző-teszttel lesz ellenőrizve:

1. Markdown-os kérdésre (pl. "sorolj fel 3 növényt") a válasz formázva jelenik meg (félkövér, lista, `---` mint elválasztó, nem nyers `**`/`###`).
2. Hosszú, streamelt válasz közben felgörgetve a lista NEM ugrik vissza automatikusan a legaljára; a `MessageScrollerButton`-nal vissza lehet ugrani.
3. Streamelés közben a stop gombra kattintva a válasz megszakad, a addig megérkezett szöveg megmarad, az input/gomb visszaáll küldésre alkalmas állapotba.
