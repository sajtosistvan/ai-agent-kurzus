import { Router, type Router as ExpressRouter } from 'express';
import { getPrisma } from '@plantbase/core';
import type { UIMessage } from 'ai';

// threads.ts — a beszélgetés-perzisztencia HTTP-oldala. A DB az igazságforrás: ez a réteg
// listázza a threadeket és adja vissza egy thread üzeneteit UIMessage[]-ként, hogy a kliens
// (useChat) pontosan ott folytassa, ahol az előzmény tart — tool-kártyákkal együtt.
//
// PRISMA: nincs saját kliens — a core közös, lazy Prisma-kliense (getPrisma) szolgálja ki
// a toolokat ÉS ezt a réteget is; leállásnál a main.ts zárja closePrisma-val.

const TITLE_MAX = 60;

/** Thread-cím az első user-üzenetből: egy sorba lapítva, 60 karakterre vágva. */
export function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX) + '…' : flat;
}

/** DB-sor → UIMessage. A parts változtatás nélkül jön vissza (úgy mentettük, ahogy streameltük). */
export function rowToUIMessage(row: {
  id: number;
  role: string;
  parts: unknown;
}): UIMessage {
  return {
    id: String(row.id),
    role: row.role as UIMessage['role'],
    parts: row.parts as UIMessage['parts'],
  };
}

/** A data-* partok (pl. data-thread) CSAK a UI-nak szólnak — a modell-előzménybe nem valók. */
export function stripDataParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.filter((part) => !part.type.startsWith('data-')),
  }));
}

/**
 * Ha egy korábbi agent-futás hibával elhalt, a DB végén válasz nélküli user-üzenet maradhat —
 * ezt eldobjuk, különben két user-kör kerülne egymás után a modell-előzménybe.
 */
export function dropTrailingUserRow<T extends { role: string }>(rows: T[]): T[] {
  const last = rows[rows.length - 1];
  return last?.role === 'user' ? rows.slice(0, -1) : rows;
}

export const threadsRouter: ExpressRouter = Router();

// GET /api/threads — a lista a chat alá: cím + frissesség, legutóbbi elöl.
threadsRouter.get('/', async (_req, res) => {
  try {
    const threads = await getPrisma().thread.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });
    res.json(threads);
  } catch (error: unknown) {
    console.error(`plantbase szerver hiba (thread-lista): ${String(error)}`);
    res.status(500).json({ error: 'Nem sikerült betölteni a beszélgetés-listát.' });
  }
});

// GET /api/threads/:id — egy beszélgetés teljes előzménye UIMessage[]-ként.
threadsRouter.get('/:id', async (req, res) => {
  try {
    const thread = await getPrisma().thread.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!thread) {
      res.status(404).send('Nincs ilyen beszélgetés.');
      return;
    }
    res.json({ id: thread.id, title: thread.title, messages: thread.messages.map(rowToUIMessage) });
  } catch (error: unknown) {
    console.error(`plantbase szerver hiba (thread-előzmény): ${String(error)}`);
    res.status(500).json({ error: 'Nem sikerült betölteni a beszélgetést.' });
  }
});
