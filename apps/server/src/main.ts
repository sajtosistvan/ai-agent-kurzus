import 'dotenv/config';
import { join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { convertToModelMessages, type UIMessage } from 'ai';
import {
  askAgent,
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
  setWatchLog,
} from '@plantbase/core';
import { debugKnowledgeRouter } from './debug-knowledge.js';

// server/main.ts — VÉKONY HTTP-réteg a core agent fölött. A böngészőből érkező kérdés PONTOSAN
// ugyanazon az úton megy, mint a CLI-ben: askAgent → a Vercel AI SDK agent-loop. A `@plantbase/core`
// framework-független; ez a szerver csak egy belépési pont (a CLI a másik).
//
// DEBUG: askAgent-et `print: true`-val hívjuk, ezért a SZERVER konzolján ugyanaz a színes,
// körről körre növekvő trace fut le, mint a CLI-ben (trace.ts). A böngésző csak a választ kapja.
// Külön terminálban `tail -f logs/agent.log` ugyanúgy nézhető, mint a CLI-nél.
//
// KLIENS: a web app a Vercel AI SDK useChat hookját használja (TextStreamChatTransport), NEM sima
// fetch-et. A useChat minden hívásnál a TELJES üzenet-előzményt (UIMessage[]) elküldi — ebből
// vágjuk le az utolsó (új) user-üzenetet kérdésnek, a többit convertToModelMessages-szel alakítjuk
// az askAgent `history` opciójává, így a beszélgetés a szerveren is folytatódik körről körre.
//
// STREAMING: a válasz TOKENENKÉNT megy ki (streamText a core-ban, res.write() itt) sima
// szövegként (text/plain) — a TextStreamChatTransport ugyanezt a szöveg-folyamot olvassa be
// darabonként a kliensen, és alakítja UI-szöveg-deltákká, ahogy megérkeznek.

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
  const messages: unknown = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).send('Üres beszélgetést nem lehet feltenni.');
    return;
  }

  const uiMessages = messages as UIMessage[];
  const lastMessage = uiMessages[uiMessages.length - 1];
  const question = lastMessage?.role === 'user' ? extractText(lastMessage) : '';
  if (question === '') {
    res.status(400).send('Üres kérdést nem lehet feltenni.');
    return;
  }

  try {
    // A korábbi körök (useChat mindig a teljes előzményt küldi) → askAgent history-ja.
    const history = await convertToModelMessages(uiMessages.slice(0, -1));
    // print: true → a teljes trace a szerver konzolján, mint a CLI-ben.
    //
    // onStream → az AI SDK ÜZENET-streamje megy ki (nem sima szöveg): a böngésző így nemcsak a
    // válasz betűit kapja meg, hanem a TOOL-HÍVÁSOKAT és a TOOL-EREDMÉNYEKET is, típusos részekként
    // (`tool-runSql`, `tool-searchKnowledge`). Ebből rajzol a kliens kártyát — lásd apps/web/App.tsx.
    await askAgent(question, {
      print: true,
      history,
      onStream: (result) => result.pipeUIMessageStreamToResponse(res),
    });
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

const port = Number(process.env['PORT'] ?? 3001);
const server = app.listen(port, () => {
  console.log(`Plantbase szerver fut: http://localhost:${port}`);
});

// Tiszta leállás: a pg-poolokat zárjuk, hogy ne maradjon nyitott kapcsolat.
async function shutdown(): Promise<void> {
  server.close();
  await Promise.all([closeReadOnlyPool(), closeReadWritePool()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
