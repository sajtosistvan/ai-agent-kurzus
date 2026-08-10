import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
} from 'ai';
import {
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
  closePrisma,
} from '@plantbase/core';
import { streamChat } from './chat-stream.js';
import { debugKnowledgeRouter } from './debug-knowledge.js';
import { threadsRouter, clipTitle } from './threads.js';

// server/main.ts — VÉKONY HTTP-réteg a Mastra agentek fölött. A böngészőből érkező kérdés
// pontosan ugyanazon az úton megy, mint a CLI-ben: `mastra.getAgent(...).stream(...)`.
// A `@plantbase/core` framework-független; ez a szerver csak egy belépési pont.
//
// KLIENS: a web app a Vercel AI SDK useChat hookját használja (DefaultChatTransport). A kliens
// csak az ÚJ üzenetet + a threadId-t küldi; az ELŐZMÉNYT NEM MI KEZELJÜK — a Mastra Memory
// tölti be a thread alapján, és ő is menti az új üzeneteket (`mastra_messages` tábla).
// Ezért tűnt el innen a Prisma-alapú üzenetmentés és a `convertToModelMessages` fordítás.
//
// MEGFIGYELHETŐSÉG: nincs saját trace. A lépések a Mastra loggerébe (PinoLogger) és a
// Studióba mennek — `pnpm mastra:dev`.

// Fail-fast: a kulcs/konfiguráció hiányát már indításkor, érthetően jelezzük.
try {
  loadConfig();
} catch (error: unknown) {
  if (error instanceof ConfigError) {
    console.error(`plantbase szerver: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const app = express();
app.use(cors());
app.use(express.json());
// A debug-végpontokat böngészőből nézzük (kivetítve) — formázott JSON, hogy olvasható legyen.
app.set('json spaces', 2);

/** Az UIMessage szöveg-részeiből (text parts) állítja össze a nyers kérdés-szöveget. */
function extractText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

app.post('/api/chat', async (req, res) => {
  const { threadId, message } = (req.body ?? {}) as {
    threadId?: string;
    message?: UIMessage;
  };
  const question = message?.role === 'user' ? extractText(message) : '';
  if (!message || question === '') {
    res.status(400).send('Üres kérdést nem lehet feltenni.');
    return;
  }

  // Új beszélgetéshez mi adjuk az azonosítót; a threadet a Mastra Memory hozza létre az
  // első agent-futáskor (a címmel együtt), külön írási lépés nélkül.
  const activeThreadId = threadId ?? randomUUID();

  try {
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Elöl a data-thread part: ebből tudja meg a kliens az új thread azonosítóját.
        writer.write({ type: 'data-thread', data: { threadId: activeThreadId } });
        await streamChat({
          question,
          threadId: activeThreadId,
          threadTitle: clipTitle(question),
          writer,
        });
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
    pipeUIMessageStreamToResponse({ response: res, stream });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`plantbase szerver hiba: ${messageText}`);
    // Ha már küldtünk streamelt darabot, a válaszkód/fejléc nem módosítható — csak lezárjuk.
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).send(messageText);
    }
  }
});

// Debug-végpontok: a RAG belseje (dokumentumok, chunkok, nyers vektorkeresés).
app.use('/debug/knowledge', debugKnowledgeRouter);
// Thread-API: beszélgetés-lista és -előzmény a Mastra Memoryból (lásd threads.ts).
app.use('/api/threads', threadsRouter);

const port = Number(process.env['PORT'] ?? 3001);
const server = app.listen(port, () => {
  console.log(`Plantbase szerver fut: http://localhost:${port}`);
});

// Tiszta leállás: a pg-poolokat és a közös Prisma-klienst zárjuk, hogy ne maradjon nyitott kapcsolat.
async function shutdown(): Promise<void> {
  server.close();
  await Promise.all([closeReadOnlyPool(), closeReadWritePool(), closePrisma()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
