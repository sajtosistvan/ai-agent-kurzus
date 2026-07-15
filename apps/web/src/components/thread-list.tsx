import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// thread-list.tsx — a korábbi beszélgetések a chat ALATT. Kattintásra ?thread=<id>-re
// navigálunk TELJES újratöltéssel: a betöltés útja így ugyanaz, mint egy megosztott linké —
// egy útvonal van, nem kettő (szándékos egyszerűsítés).

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

export function ThreadList({ activeId }: { activeId: string | null }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/threads`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setThreads)
      .catch(() => setThreads([]));
  }, []);

  if (threads.length === 0) {
    return null;
  }
  return (
    <nav className="border-t pt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase">Korábbi beszélgetések</h2>
        {/* A helyi Button variánsban nincs "sm" méret — kis gombot className-mel kapunk. */}
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => window.location.assign(window.location.pathname)}>
          Új beszélgetés
        </Button>
      </div>
      <ul className="max-h-40 overflow-y-auto">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted ${t.id === activeId ? 'bg-muted font-medium' : ''}`}
              onClick={() => window.location.assign(`?thread=${t.id}`)}
            >
              {t.title}
              <span className="text-muted-foreground ml-2 text-xs">
                {new Date(t.updatedAt).toLocaleDateString('hu-HU')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
