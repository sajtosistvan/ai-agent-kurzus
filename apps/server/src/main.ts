import 'dotenv/config';
import { join } from 'node:path';
import express from 'express';
import cors from 'cors';
import {
  askAgent,
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closeReadWritePool,
  setWatchLog,
} from '@plantbase/core';

// server/main.ts — VÉKONY HTTP-réteg a core agent fölött. A böngészőből érkező kérdés PONTOSAN
// ugyanazon az úton megy, mint a CLI-ben: askAgent → a Vercel AI SDK agent-loop. A `@plantbase/core`
// framework-független; ez a szerver csak egy belépési pont (a CLI a másik).
//
// DEBUG: askAgent-et `print: true`-val hívjuk, ezért a SZERVER konzolján ugyanaz a színes,
// körről körre növekvő trace fut le, mint a CLI-ben (trace.ts). A böngésző csak a választ kapja.
// Külön terminálban `tail -f logs/agent.log` ugyanúgy nézhető, mint a CLI-nél.
//
// STREAMING: NINCS. A /api/chat egyszer válaszol a teljes szöveggel (generateText). A streamre
// váltás egy külön, tiszta lépés lesz (streamText a szerveren + useChat a kliensen).

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

app.post('/api/chat', async (req, res) => {
  const message: unknown = req.body?.message;
  const question = typeof message === 'string' ? message.trim() : '';
  if (question === '') {
    res.status(400).json({ error: 'Üres kérdést nem lehet feltenni.' });
    return;
  }

  try {
    // print: true → a teljes trace a szerver konzolján, mint a CLI-ben.
    const result = await askAgent(question, { print: true });
    res.json({ answer: result.answer });
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`plantbase szerver hiba: ${messageText}`);
    res.status(500).json({ error: messageText });
  }
});

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
