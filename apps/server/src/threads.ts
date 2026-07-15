import { Router } from 'express';
import { PrismaClient } from '@plantbase/db';
import type { UIMessage } from 'ai';

// threads.ts — a beszélgetés-perzisztencia HTTP-oldala. A DB az igazságforrás: ez a réteg
// listázza a threadeket és adja vissza egy thread üzeneteit UIMessage[]-ként, hogy a kliens
// (useChat) pontosan ott folytassa, ahol az előzmény tart — tool-kártyákkal együtt.

let prisma: PrismaClient | null = null;
/** Lazy Prisma a szervernek — a chat-handler (main.ts) is ezt használja. */
export function getServerPrisma(): PrismaClient {
  if (prisma === null) {
    prisma = new PrismaClient();
  }
  return prisma;
}

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

export const threadsRouter = Router();

// GET /api/threads — a lista a chat alá: cím + frissesség, legutóbbi elöl.
threadsRouter.get('/', async (_req, res) => {
  const threads = await getServerPrisma().thread.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  res.json(threads);
});

// GET /api/threads/:id — egy beszélgetés teljes előzménye UIMessage[]-ként.
threadsRouter.get('/:id', async (req, res) => {
  const thread = await getServerPrisma().thread.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!thread) {
    res.status(404).send('Nincs ilyen beszélgetés.');
    return;
  }
  res.json({ id: thread.id, title: thread.title, messages: thread.messages.map(rowToUIMessage) });
});
