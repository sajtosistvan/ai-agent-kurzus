import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Leaf, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToolCard } from '@/components/tool-card';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';

// App.tsx — a Vercel AI SDK useChat hookja hajtja, NEM sima fetch. A useChat minden hívásnál a
// TELJES üzenet-előzményt elküldi a szervernek (lásd apps/server/src/main.ts).
//
// KÉT PROTOKOLL — ezt érdemes megérteni:
//
//   TextStreamChatTransport (EDDIG):  a szerver sima szöveget (text/plain) küld. Streamel, de a
//     `message.parts`-ban CSAK `text` rész van. A tool-hívásokról a böngésző nem tud semmit —
//     nem azért, mert lassú a stream, hanem mert egy karakterfolyamba nem fér bele egy tool-hívás.
//
//   DefaultChatTransport (MOST):  a szerver az AI SDK ÜZENET-streamjét küldi. Ugyanúgy streamel,
//     de TÍPUSOS részeket: `text` ÉS `tool-runSql` ÉS `tool-searchKnowledge` (input + output).
//     Ezért tudunk kártyát rajzolni a tool-eredményből — lásd components/tool-card.tsx.

// Production deployen a web és az API külön Railway service-en fut, külön domainnel — a
// VITE_API_URL build-time env változó adja meg az API alap-URL-jét (pl. https://api.up.railway.app).
// Dev alatt üresen marad, ekkor a Vite proxyzza a relatív /api-t (lásd vite.config.ts).
const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';
const transport = new DefaultChatTransport({ api: `${apiBaseUrl}/api/chat` });

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
                // DEBUG: a böngésző-konzolban is látszik, mit kapott a kliens (tool-részekkel).
                if (m.role === 'assistant') {
                  console.log('[plantbase] üzenet-részek:', m.parts);
                }
                const text = m.parts
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('');
                // A tool-részek típusa: `tool-<toolNév>` (pl. tool-searchKnowledge).
                const toolParts = m.parts.filter((part) =>
                  part.type.startsWith('tool-'),
                );
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'}>
                    <div className={m.role === 'user' ? 'text-right' : 'text-left'}>
                      {m.role === 'user' ? (
                        <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
                          {text}
                        </span>
                      ) : (
                        <div className="inline-block max-w-[85%] text-left">
                          {/* ELŐSZÖR a tool-lépések (mit csinált), UTÁNA a válasz (mit mond). */}
                          {toolParts.map((part, index) => (
                            <ToolCard
                              key={`${m.id}-tool-${index}`}
                              toolName={part.type.replace('tool-', '')}
                              state={(part as { state: string }).state}
                              input={(part as { input?: unknown }).input}
                              output={(part as { output?: unknown }).output}
                            />
                          ))}
                          {text !== '' && (
                            <div className="prose prose-sm prose-neutral bg-muted rounded-lg px-3 py-2 prose-p:my-1 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                            </div>
                          )}
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
