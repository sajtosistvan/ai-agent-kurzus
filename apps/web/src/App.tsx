import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { Leaf, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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
  const { messages, sendMessage, status } = useChat({ transport });
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

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Kérdezz a katalógusról — pl. „mutass 3 pet-safe növényt raktáron, 5000
            Ft alatt”.
          </p>
        )}
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
        {loading && (
          <p className="text-muted-foreground text-sm">gondolkodik…</p>
        )}
      </div>

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
        <Button type="submit" size="icon" disabled={loading}>
          <Send />
        </Button>
      </form>
    </div>
  );
}
