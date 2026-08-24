import { Router, type Router as ExpressRouter } from 'express';
import type { MastraMemory } from '@mastra/core/memory';
import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { mastra } from '@plantbase/core';

// threads.ts — a beszélgetés-perzisztencia HTTP-oldala, MOST MÁR A MASTRA MEMORY FÖLÖTT.
//
// AMI VÁLTOZOTT: eddig saját `thread`/`message` Prisma-táblákba mentettünk. A Mastra Memory
// ugyanezt megcsinálja (`mastra_threads` / `mastra_messages`, UGYANABBAN a Postgresben),
// és az agent futás közben magától írja. Ezért itt már nem mentünk semmit — csak OLVASUNK:
//
//   thread   = egy beszélgetés   (Memory `thread`)
//   resource = kihez tartozik    (Memory `resource`) — a webnél egy fix felhasználó
//
// A DB-alak → UIMessage[] fordítást a `toAISdkMessages(..., { version: 'v6' })` végzi
// (@mastra/ai-sdk), így a kliens (useChat) ugyanúgy folytatja, ahol az előzmény tart.

/** A böngészőből érkező forgalom egyetlen „felhasználója" — a kurzus-app egyfelhasználós. */
export const WEB_RESOURCE = 'web-user';

const THREAD_LIST_LIMIT = 50;
const TITLE_MAX = 60;

/** Thread-cím az első user-üzenetből: egy sorba lapítva, 60 karakterre vágva. */
export function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX) + '…' : flat;
}

/**
 * A Memory-példány az agenttől jön: a Mastrában a memória az agent konfigurációjának része,
 * nem külön szolgáltatás. Bármelyik agenté jó — mind ugyanarra a tárolóra mutat.
 */
export async function getWebMemory(): Promise<MastraMemory> {
  const memory = await mastra.getAgentById('plantbase-supervisor').getMemory();
  if (!memory) {
    throw new Error('A Mastra agenthez nincs memória konfigurálva.');
  }
  return memory;
}

export const threadsRouter: ExpressRouter = Router();

// GET /api/threads — a lista a chat alá: cím + frissesség, legutóbbi elöl.
threadsRouter.get('/', async (_req, res) => {
  try {
    const memory = await getWebMemory();
    const { threads } = await memory.listThreads({
      filter: { resourceId: WEB_RESOURCE },
      perPage: THREAD_LIST_LIMIT,
      page: 0,
    });
    res.json(
      threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
      })),
    );
  } catch (error: unknown) {
    console.error(`plantbase szerver hiba (thread-lista): ${String(error)}`);
    res
      .status(500)
      .json({ error: 'Nem sikerült betölteni a beszélgetés-listát.' });
  }
});

// GET /api/threads/:id — egy beszélgetés teljes előzménye UIMessage[]-ként.
threadsRouter.get('/:id', async (req, res) => {
  try {
    const memory = await getWebMemory();
    const thread = await memory.getThreadById({ threadId: req.params.id });
    if (!thread) {
      res.status(404).send('Nincs ilyen beszélgetés.');
      return;
    }
    // perPage: false → a TELJES előzmény, lapozás nélkül (kurzus-méretű beszélgetések).
    const { messages } = await memory.recall({
      threadId: thread.id,
      resourceId: WEB_RESOURCE,
      perPage: false,
    });
    res.json({
      id: thread.id,
      title: thread.title,
      messages: toAISdkMessages(messages, { version: 'v6' }),
    });
  } catch (error: unknown) {
    console.error(`plantbase szerver hiba (thread-előzmény): ${String(error)}`);
    res.status(500).json({ error: 'Nem sikerült betölteni a beszélgetést.' });
  }
});
