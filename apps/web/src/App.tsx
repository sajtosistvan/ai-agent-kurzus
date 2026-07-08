import { useState } from 'react';
import { Leaf, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// App.tsx — a legkisebb működő chat. Sima fetch a /api/chat-ra (a Vite proxyzza a szerverre),
// NINCS streaming: egy kérés → egy teljes válasz. A streamet külön, tiszta lépésben kapcsoljuk be
// (useChat a kliensen + streamText a szerveren). A debug (trace) a SZERVER konzolján fut, mint a CLI-ben.

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(): Promise<void> {
    const question = input.trim();
    if (question === '' || loading) {
      return;
    }
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
      });
      const data: { answer?: string; error?: string } = await res.json();
      const answer = res.ok
        ? (data.answer ?? '')
        : `Hiba: ${data.error ?? 'ismeretlen hiba'}`;
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Hálózati hiba: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
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
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={cn(
                'inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {m.content}
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
          void send();
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
