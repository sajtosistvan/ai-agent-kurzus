# Web chat UX quick wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add markdown rendering, smart auto-scroll (shadcn `message-scroller`), and a stop button to the `apps/web` Plantbase chat, per `docs/superpowers/specs/2026-07-08-web-chat-ux-quick-wins-design.md`.

**Architecture:** Three independent, additive changes to the single-file `apps/web/src/App.tsx` chat UI. No new files except one CLI-scaffolded shadcn component (`message-scroller.tsx`) and no changes to `apps/server` or `packages/core` — this plan is 100% client-side.

**Tech Stack:** React 19, Vite 8, Tailwind v4 (CSS-based config), shadcn/ui (`new-york` style, already configured in `apps/web/components.json`), `@ai-sdk/react` `useChat`, `react-markdown` + `remark-gfm` (new), `@tailwindcss/typography` (new).

## Global Constraints

- **No unit tests for `apps/web`** — the project's established convention (see `CLAUDE.md`) is that `packages/core` is unit-tested and the web layer is verified manually in a browser. Every task's verification step is: `pnpm nx typecheck web` (must pass with zero errors) + a manual browser check via the running dev server (`pnpm web`, proxied to `pnpm server` on port 3001 — both must already be running; if not, start them: `pnpm server &` then `pnpm web &`, or ask the user to confirm they're running).
- **Do not touch `apps/server` or `packages/core`** — this plan is scoped to `apps/web` only.
- **Commit messages:** `<type>: <description>` (feat/fix/refactor/docs/test/chore), no `Co-Authored-By` trailer (attribution is disabled globally for this user).
- **File in scope:** `apps/web/src/App.tsx` (current content is the baseline all three tasks below diff against, in order).

---

### Task 1: Markdown rendering for assistant messages

**Files:**
- Modify: `apps/web/package.json` (add `react-markdown`, `remark-gfm` deps; `@tailwindcss/typography` devDep)
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: assistant message bubbles are now a `<div>` (not `<span>`) with class `prose prose-sm prose-neutral`, rendering `<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>` instead of raw text. User message bubbles are unchanged (plain text, `<span>`).

**Watch out:** `tsconfig.base.json` sets `"noUnusedLocals": true` — any import that becomes unused after this task's edit WILL fail `pnpm nx typecheck web` (this is the same rule that currently flags an unused `isAdmin` in `packages/core`, unrelated to this plan). Step 5 below removes the now-unused `cn` import for exactly this reason — don't skip that part of the diff.

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @plantbase/web add react-markdown remark-gfm
pnpm --filter @plantbase/web add -D @tailwindcss/typography
```

Expected: `apps/web/package.json` gets `react-markdown` and `remark-gfm` under `"dependencies"`, `@tailwindcss/typography` under `"devDependencies"`. `pnpm-lock.yaml` at the repo root updates.

- [ ] **Step 2: Register the Tailwind Typography plugin**

Modify `apps/web/src/styles.css` — add the plugin directive right after the Tailwind import (currently line 1):

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@custom-variant dark (&:is(.dark *));
```

(Only the `@plugin` line is new; everything else in the file stays as-is.)

- [ ] **Step 3: Fix the stale "no streaming" comment**

`apps/web/src/App.tsx` currently has this comment block (lines 9-13), which is outdated now that streaming is implemented:

```tsx
// App.tsx — a Vercel AI SDK useChat hookja hajtja, NEM sima fetch. A TextStreamChatTransport a
// legkisebb protokoll: a szerver egy darab sima szöveget (text/plain) küld vissza, a hook ezt
// alakítja UI-üzenetté. A useChat minden hívásnál a TELJES üzenet-előzményt elküldi a szervernek
// (lásd apps/server/src/main.ts) — így a beszélgetés kontextusa a szerveren is megmarad.
// NINCS streaming: egy kérés → egy teljes válasz (a szerver generateText-tel dolgozik).
```

Replace the last line (`// NINCS streaming...`) with:

```tsx
// STREAMING: a szerver tokenenként írja a választ (streamText a core-ban), a TextStreamChatTransport
// ezt darabonként olvassa be és alakítja UI-szöveg-deltákká, ahogy megérkeznek.
```

- [ ] **Step 4: Add the markdown imports**

In `apps/web/src/App.tsx`, add two imports after the existing `TextStreamChatTransport` import (currently line 3):

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
```

- [ ] **Step 5: Render assistant messages as markdown**

First, remove the now-unused `cn` import — change:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
```

to:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
```

Then find the message-rendering block (currently inside the `messages.map((m) => ...)` callback):

```tsx
{messages.map((m) => (
  <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
    <span
      className={cn(
        'inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm',
        m.role === 'user'
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-foreground',
      )}
    >
      {m.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')}
    </span>
  </div>
))}
```

Replace it with (this splits the user/assistant branches — user stays a plain `<span>`, assistant becomes a markdown-rendering `<div>`):

```tsx
{messages.map((m) => {
  const text = m.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return (
    <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
      {m.role === 'user' ? (
        <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
          {text}
        </span>
      ) : (
        <div className="prose prose-sm prose-neutral inline-block max-w-[85%] rounded-lg bg-muted px-3 py-2 text-left prose-p:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm nx typecheck web
```

Expected: exits 0, no errors.

- [ ] **Step 7: Manual browser verification**

With `pnpm server` and `pnpm web` running (proxy on `localhost:4200` → `localhost:3001`), open `http://localhost:4200`, ask a question that produces a rich answer, e.g. "sorolj fel 3 növényt, akciósat is". Confirm in the rendered page:
- Headings/bold render as actual bold/heading text, not literal `**`/`###` characters.
- A `---` in the source renders as a horizontal rule, not three dashes.
- If any product has a sale price, the struck-through original price (`~~1990 Ft~~`) renders with an actual strikethrough (this exercises `remark-gfm`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/src/styles.css apps/web/src/App.tsx pnpm-lock.yaml
git commit -m "feat(web): render assistant chat messages as markdown"
```

---

### Task 2: Smart auto-scroll via shadcn `message-scroller`

**Files:**
- Create: `apps/web/src/components/ui/message-scroller.tsx` (scaffolded by the shadcn CLI — exact content is generated, not hand-written)
- Modify: `apps/web/src/App.tsx`
- Possibly modify: `apps/web/package.json` (only if the CLI adds a new dependency — see Step 2)

**Interfaces:**
- Consumes: `messages` array from `useChat()` (from Task 1's/original `App.tsx` state) — each `m` has `.id: string`, `.role: 'user' | 'assistant'`.
- Produces: the message list is wrapped in `MessageScrollerProvider` / `MessageScroller` / `MessageScrollerViewport` / `MessageScrollerContent` / `MessageScrollerItem`, imported from `@/components/ui/message-scroller`.

- [ ] **Step 1: Scaffold the component**

```bash
cd apps/web && pnpm dlx shadcn@latest add message-scroller
```

Expected: creates `apps/web/src/components/ui/message-scroller.tsx` (the CLI reads `apps/web/components.json` for the `new-york` style and `@/components/ui` alias, matching where `button.tsx` and `input.tsx` already live). Run from the repo root afterward: `cd /Users/istvansajtos/LABA/ai-agent-kurzus`.

- [ ] **Step 2: Confirm the generated API surface**

Open `apps/web/src/components/ui/message-scroller.tsx` and confirm it exports (by name) at least: `MessageScrollerProvider`, `MessageScroller`, `MessageScrollerViewport`, `MessageScrollerContent`, `MessageScrollerItem`, `MessageScrollerButton`. Also check whether `MessageScrollerProvider` accepts a boolean `autoScroll` prop, and whether `MessageScrollerItem` accepts `messageId` (string) and `scrollAnchor` (boolean) props.

If any name or prop differs from what's listed above (the CLI/registry could have shipped an updated API since this plan was written), adjust the JSX in Step 4 to match the actual exported names/props — the visual/behavioral goal (auto-scroll-at-bottom, turn-anchor on user messages, jump-to-bottom button) stays the same regardless of exact prop names.

If the CLI added any new package to `apps/web/package.json` (check `git diff apps/web/package.json`), that's expected and fine — include it in Step 6's commit.

- [ ] **Step 3: Add the imports**

In `apps/web/src/App.tsx`, add after the `Input` import:

```tsx
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
```

- [ ] **Step 4: Wrap the message list**

In `apps/web/src/App.tsx`, find this block (produced by Task 1, Step 5):

```tsx
<div className="flex-1 space-y-3 overflow-y-auto">
  {messages.length === 0 && (
    <p className="text-muted-foreground text-sm">
      Kérdezz a katalógusról — pl. „mutass 3 pet-safe növényt raktáron, 5000
      Ft alatt”.
    </p>
  )}
  {messages.map((m) => {
    const text = m.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return (
      <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
        {m.role === 'user' ? (
          <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
            {text}
          </span>
        ) : (
          <div className="prose prose-sm prose-neutral inline-block max-w-[85%] rounded-lg bg-muted px-3 py-2 text-left prose-p:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  })}
  {loading && (
    <p className="text-muted-foreground text-sm">gondolkodik…</p>
  )}
</div>
```

Replace it with:

```tsx
<MessageScrollerProvider autoScroll>
  <MessageScroller className="flex-1">
    <MessageScrollerViewport>
      <MessageScrollerContent className="space-y-3">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Kérdezz a katalógusról — pl. „mutass 3 pet-safe növényt raktáron, 5000
            Ft alatt”.
          </p>
        )}
        {messages.map((m) => {
          const text = m.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('');
          return (
            <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'}>
              <div className={m.role === 'user' ? 'text-right' : 'text-left'}>
                {m.role === 'user' ? (
                  <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
                    {text}
                  </span>
                ) : (
                  <div className="prose prose-sm prose-neutral inline-block max-w-[85%] rounded-lg bg-muted px-3 py-2 text-left prose-p:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                  </div>
                )}
              </div>
            </MessageScrollerItem>
          );
        })}
        {loading && <p className="text-muted-foreground text-sm">gondolkodik…</p>}
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton />
  </MessageScroller>
</MessageScrollerProvider>
```

(Only the wrapping elements changed — the `messages.map` body is identical to Task 1's output.)

- [ ] **Step 5: Typecheck**

```bash
pnpm nx typecheck web
```

Expected: exits 0. If `MessageScroller`/`MessageScrollerContent` don't accept a `className` prop (TS error), remove the `className` from that specific element and instead wrap it in a plain `<div className="flex-1">...</div>` / `<div className="space-y-3">...</div>` at that position — the scroll behavior is driven by the Provider/Viewport, not by these two classes, so this fallback doesn't change functionality.

- [ ] **Step 6: Manual browser verification**

With the dev server running, open `http://localhost:4200`:
1. Ask a question that produces a long, multi-paragraph answer (e.g. "mesélj részletesen 5 növényről"). While it's streaming, don't touch the scrollbar — confirm the view follows the bottom of the growing text automatically.
2. Ask another long question. While it's streaming, scroll up manually. Confirm the view does **not** snap back to the bottom on its own, and a "jump to bottom" control (`MessageScrollerButton`) appears/becomes usable.
3. Click that control. Confirm it scrolls to the latest message and auto-follow resumes for the next message.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/message-scroller.tsx apps/web/src/App.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): smart auto-scroll for the chat transcript (shadcn message-scroller)"
```

(If Step 1 didn't touch `package.json`/`pnpm-lock.yaml`, drop those two paths from the `git add`.)

---

### Task 3: Stop button during streaming

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `stop` function returned by `useChat()` (from `@ai-sdk/react` — already a dependency, no install needed).
- Produces: no new exports; purely a UI behavior change in the same file.

- [ ] **Step 1: Add the `Square` icon import**

In `apps/web/src/App.tsx`, change the existing lucide import line:

```tsx
import { Leaf, Send } from 'lucide-react';
```

to:

```tsx
import { Leaf, Send, Square } from 'lucide-react';
```

- [ ] **Step 2: Destructure `stop` from `useChat`**

Change:

```tsx
const { messages, sendMessage, status } = useChat({ transport });
```

to:

```tsx
const { messages, sendMessage, status, stop } = useChat({ transport });
```

- [ ] **Step 3: Swap the send button for a stop button while streaming**

Find the form's submit button:

```tsx
<Button type="submit" size="icon" disabled={loading}>
  <Send />
</Button>
```

Replace it with:

```tsx
{loading ? (
  <Button type="button" size="icon" onClick={() => stop()}>
    <Square />
  </Button>
) : (
  <Button type="submit" size="icon" disabled={input.trim() === ''}>
    <Send />
  </Button>
)}
```

Note the `disabled` condition changed from `disabled={loading}` (Send is never shown while loading now, so that condition no longer applies) to `disabled={input.trim() === ''}` (keeps the original "don't submit an empty question" behavior for the ready state).

- [ ] **Step 4: Typecheck**

```bash
pnpm nx typecheck web
```

Expected: exits 0.

- [ ] **Step 5: Manual browser verification**

With the dev server running, open `http://localhost:4200`, ask a question that produces a longish streamed answer. While it's streaming:
1. Confirm the button shows a stop/square icon (not the paper-plane send icon).
2. Click it. Confirm the stream stops immediately, the partial answer text already shown stays in the chat (isn't cleared), and the button reverts to the send icon with the input re-enabled.
3. Type a new question and send it normally — confirm the chat still works end-to-end after a stop.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): add stop button to interrupt a streaming response"
```

---

## Final full-file reference

After all three tasks, `apps/web/src/App.tsx` should read as follows (for cross-checking the incremental diffs above — do not paste this over the incrementally-edited file; it's provided only to catch drift):

```tsx
import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { Leaf, Send, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';

// App.tsx — a Vercel AI SDK useChat hookja hajtja, NEM sima fetch. A TextStreamChatTransport a
// legkisebb protokoll: a szerver egy darab sima szöveget (text/plain) küld vissza, a hook ezt
// alakítja UI-üzenetté. A useChat minden hívásnál a TELJES üzenet-előzményt elküldi a szervernek
// (lásd apps/server/src/main.ts) — így a beszélgetés kontextusa a szerveren is megmarad.
// STREAMING: a szerver tokenenként írja a választ (streamText a core-ban), a TextStreamChatTransport
// ezt darabonként olvassa be és alakítja UI-szöveg-deltákká, ahogy megérkeznek.

// Production deployen a web és az API külön Railway service-en fut, külön domainnel — a
// VITE_API_URL build-time env változó adja meg az API alap-URL-jét (pl. https://api.up.railway.app).
// Dev alatt üresen marad, ekkor a Vite proxyzza a relatív /api-t (lásd vite.config.ts).
const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';
const transport = new TextStreamChatTransport({ api: `${apiBaseUrl}/api/chat` });

export default function App() {
  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [input, setInput] = useState('');
  const loading = status === 'submitted' || status === 'streaming';

  function send(): void {
    const question = input.trim();
    if (question === '' || loading) {
      return;
    }
    setInput('');
    void sendMessage({ text: question });
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center gap-2 border-b pb-3">
        <Leaf className="text-primary" />
        <h1 className="text-lg font-semibold">Plantbase</h1>
        <span className="text-muted-foreground text-sm">
          növény-katalógus asszisztens
        </span>
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="space-y-3">
              {messages.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Kérdezz a katalógusról — pl. „mutass 3 pet-safe növényt raktáron, 5000
                  Ft alatt”.
                </p>
              )}
              {messages.map((m) => {
                const text = m.parts
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('');
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'}>
                    <div className={m.role === 'user' ? 'text-right' : 'text-left'}>
                      {m.role === 'user' ? (
                        <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
                          {text}
                        </span>
                      ) : (
                        <div className="prose prose-sm prose-neutral inline-block max-w-[85%] rounded-lg bg-muted px-3 py-2 text-left prose-p:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </MessageScrollerItem>
                );
              })}
              {loading && <p className="text-muted-foreground text-sm">gondolkodik…</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="flex gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Írd be a kérdésed…"
          disabled={loading}
        />
        {loading ? (
          <Button type="button" size="icon" onClick={() => stop()}>
            <Square />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={input.trim() === ''}>
            <Send />
          </Button>
        )}
      </form>
    </div>
  );
}
```
