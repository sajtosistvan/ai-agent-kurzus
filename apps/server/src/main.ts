import 'dotenv/config';
import { join } from 'node:path';
import express from 'express';
import cors from 'cors';
import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
} from 'ai';
import {
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
  getPrisma,
  closePrisma,
  setWatchLog,
} from '@plantbase/core';
import { streamChat } from './chat-stream.js';
import { debugKnowledgeRouter } from './debug-knowledge.js';
import {
  threadsRouter,
  clipTitle,
  rowToUIMessage,
  stripDataParts,
  dropTrailingUserRow,
} from './threads.js';

// server/main.ts — VÉKONY HTTP-réteg a core agent fölött. A böngészőből érkező kérdés PONTOSAN
// ugyanazon az úton megy, mint a CLI-ben: askAgent → a Vercel AI SDK agent-loop. A `@plantbase/core`
// framework-független; ez a szerver csak egy belépési pont (a CLI a másik).
//
// DEBUG: askAgent-et `print: true`-val hívjuk, ezért a SZERVER konzolján ugyanaz a színes,
// körről körre növekvő trace fut le, mint a CLI-ben (trace.ts). A böngésző csak a választ kapja.
// Külön terminálban `tail -f logs/agent.log` ugyanúgy nézhető, mint a CLI-nél.
//
// KLIENS: a web app a Vercel AI SDK useChat hookját használja (DefaultChatTransport), NEM sima
// fetch-et. A kliens csak az ÚJ üzenetet + a threadId-t küldi; az előzmény a DB-ből jön —
// az adatbázis az igazságforrás. A DB-sorokat convertToModelMessages-szel alakítjuk az askAgent
// `history` opciójává, így a beszélgetés a szerveren is folytatódik körről körre.
//
// STREAMING: a válasz az AI SDK ÜZENET-streamjeként megy ki (pipeUIMessageStreamToResponse):
// nemcsak a szöveg-deltákat, hanem a TOOL-HÍVÁSOKAT és -EREDMÉNYEKET is típusos részekként
// (`tool-runSql`, `tool-searchKnowledge`) — ebből rajzol a kliens kártyát (apps/web/App.tsx).

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

// A folyamatos "control room" log — ugyanaz a fájl, mint a CLI-nél.
setWatchLog(join(process.cwd(), 'logs', 'agent.log'));

const app = express();
app.use(cors());
app.use(express.json());
// A debug-végpontokat böngészőből nézzük (kivetítve) — formázott JSON, hogy olvasható legyen.
app.set('json spaces', 2);

// Az UIMessage szöveg-részeiből (text parts) állítja össze a nyers kérdést-szöveget.
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

  // A core közös Prisma-kliense — a toolok és a threads router is ugyanezt használja.
  const prisma = getPrisma();
  try {
    // (1) Thread: meglévő betöltése vagy új nyitása — a cím az első kérdésből.
    const thread = threadId
      ? await prisma.thread.findUnique({ where: { id: threadId } })
      : await prisma.thread.create({ data: { title: clipTitle(question) } });
    if (!thread) {
      res.status(404).send('Nincs ilyen beszélgetés.');
      return;
    }

    // (2) Előzmény a DB-ből (a mostani üzenet ELŐTTI állapot) → modell-előzmény.
    const priorRows = await prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    // Ha egy korábbi futás hibázott, lógó user-üzenet maradhatott a végén — azt kihagyjuk,
    // különben két user-kör kerülne egymás után az előzménybe.
    // A data-partokat CSAK a modell-előzményből szűrjük — a flow-lock (chat-stream) pont
    // ezekből olvassa ki az állapotot, ezért az UI-alakot is megőrizzük.
    const priorUI = dropTrailingUserRow(priorRows).map(rowToUIMessage);
    const history = await convertToModelMessages(stripDataParts(priorUI));

    // (3) A user-üzenet mentése — a válasz sikerétől függetlenül megmarad.
    await prisma.message.create({
      data: { threadId: thread.id, role: 'user', parts: message.parts as object },
    });

    // (4) Stream: elöl a data-thread part (ebből tudja meg a kliens az új thread id-t),
    //     mögé az agent üzenet-streamje; a kész választ az onFinish menti.
    //
    // onStream → az AI SDK ÜZENET-streamje megy ki (nem sima szöveg): a böngésző így nemcsak a
    // válasz betűit kapja meg, hanem a TOOL-HÍVÁSOKAT és a TOOL-EREDMÉNYEKET is, típusos részekként
    // (`tool-runSql`, `tool-searchKnowledge`). Ebből rajzol a kliens kártyát — lásd apps/web/App.tsx.
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'data-thread', data: { threadId: thread.id } });
        // off módban a mai askAgent-út fut változatlanul; router/delegate módban az
        // orchestrator — a protokoll-transzformáció a chat-stream.ts-ben (egyetlen fájl).
        await streamChat({ question, history, uiHistory: priorUI, writer });
      },
      onFinish: async ({ responseMessage }) => {
        // Saját try/catch: a stream közben elszálló mentés ne legyen kezeletlen rejection.
        try {
          await prisma.message.create({
            data: {
              threadId: thread.id,
              role: 'assistant',
              parts: responseMessage.parts as object,
            },
          });
          // frissesség a listához
          await prisma.thread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        } catch (error: unknown) {
          console.error(`plantbase szerver hiba (mentés): ${String(error)}`);
        }
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

// Debug-végpontok: a RAG belseje (dokumentumok, chunkok, nyers vektorkeresés). Lásd debug-knowledge.ts.
app.use('/debug/knowledge', debugKnowledgeRouter);
// Thread-API: beszélgetés-lista és -előzmény (lásd threads.ts).
app.use('/api/threads', threadsRouter);

const port = Number(process.env['PORT'] ?? 3001);
const server = app.listen(port, () => {
  console.log(`Plantbase szerver fut: http://localhost:${port}`);
});

// Tiszta leállás: a pg-poolokat és a core közös Prisma-kliensét zárjuk, hogy ne maradjon nyitott kapcsolat.
async function shutdown(): Promise<void> {
  server.close();
  await Promise.all([closeReadOnlyPool(), closeReadWritePool(), closePrisma()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
