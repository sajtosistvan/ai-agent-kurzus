import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Leaf, Send, Square } from 'lucide-react';
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
            <MessageScrollerContent>
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
