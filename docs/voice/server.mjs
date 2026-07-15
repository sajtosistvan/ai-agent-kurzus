// Eldobható órai demó-szerver (7. óra — Beszélő agent)
// Feladata: API-kulcs őrzése + cascade pipeline időméréssel + Realtime ephemeral token.
// Futtatás: OPENAI_API_KEY=sk-... node server.mjs  →  http://localhost:3777

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";

const PORT = 3777;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.OPENAI_API_KEY) {
  console.error("HIÁNYZIK az OPENAI_API_KEY környezeti változó.");
  console.error("Indítás:  OPENAI_API_KEY=sk-...  node server.mjs");
  process.exit(1);
}

const openai = new OpenAI();

// ---------- segédek ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ---------- 1. demó: cascade pipeline (STT → LLM → TTS), lépésenkénti időméréssel ----------

const CASCADE_SYSTEM_PROMPT = `Te egy magyar nyelvű ügyfélszolgálati voice agent vagy.
A válaszodat HANGOSAN fogják felolvasni, ezért:
- rövid mondatok, maximum 2-3 mondat összesen
- egyszerre csak egy kérdés
- számokat kimondható formában ("tizenkettő", nem "12-es lista")
- semmi felsorolás, semmi markdown.`;

async function handleCascade(req, res) {
  const audioBuffer = await readBody(req);
  if (audioBuffer.length < 100) return json(res, 400, { error: "Üres audio érkezett." });

  const t0 = Date.now();

  // 1) STT
  const sttStart = Date.now();
  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(audioBuffer, "input.webm"),
    model: "gpt-4o-mini-transcribe",
    language: "hu",
  });
  const sttMs = Date.now() - sttStart;
  const userText = transcription.text;

  // 2) LLM (streamelve, hogy a first token időt külön lássuk)
  const llmStart = Date.now();
  let llmFirstTokenMs = null;
  let replyText = "";
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages: [
      { role: "system", content: CASCADE_SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      if (llmFirstTokenMs === null) llmFirstTokenMs = Date.now() - llmStart;
      replyText += delta;
    }
  }
  const llmTotalMs = Date.now() - llmStart;

  // 3) TTS (first byte időt mérjük — élesben ez streamelve menne tovább)
  const ttsStart = Date.now();
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: replyText,
    response_format: "mp3",
  });
  let ttsFirstByteMs = null;
  const audioChunks = [];
  for await (const chunk of speech.body) {
    if (ttsFirstByteMs === null) ttsFirstByteMs = Date.now() - ttsStart;
    audioChunks.push(Buffer.from(chunk));
  }
  const ttsTotalMs = Date.now() - ttsStart;

  json(res, 200, {
    sttMs,
    userText,
    llmFirstTokenMs,
    llmTotalMs,
    replyText,
    ttsFirstByteMs,
    ttsTotalMs,
    totalMs: Date.now() - t0,
    audioBase64: Buffer.concat(audioChunks).toString("base64"),
  });
}

// ---------- 2-3. demó: Realtime session (ephemeral token a böngészőnek) ----------

const REALTIME_BASE_PROMPT = `Te a "Plantbase" webshop magyar nyelvű ügyfélszolgálati voice agentje vagy.
Beszélj magyarul, természetesen és RÖVIDEN: 1-2 mondat egyszerre.
A válaszod hangzik el, ne használj felsorolást vagy írásjeles formázást.`;

const FILLER_ON_PROMPT = `
Ha tool-t hívsz (pl. rendelés keresése), az eltarthat több másodpercig.
KÖTELEZŐ: a tool-hívás előtt azonnal mondj egy rövid, INFORMATÍV kitöltő mondatot,
amiben visszaigazolod, mit keresel (pl. "Máris keresem a tizenkétezer-háromszáznegyvenötös rendelést, egy pillanat.").
Ha van releváns hasznos infó (pl. visszaküldési szabály), azt is mondhatod a várakozás alatt.`;

const FILLER_OFF_PROMPT = `
Ha tool-t hívsz, NE mondj semmit a hívás előtt vagy közben.
Maradj teljesen csendben, amíg meg nem érkezik a tool eredménye, és csak utána válaszolj.`;

const ORDER_TOOL = {
  type: "function",
  name: "getOrderStatus",
  description: "Lekérdezi egy rendelés állapotát a rendelésszám alapján. Lassú backend-hívás.",
  parameters: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "A rendelés azonosítója, pl. 12345" },
    },
    required: ["orderId"],
  },
};

async function handleRealtimeSession(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || "{}");
  const vad = body.vad === "semantic" ? "semantic_vad" : "server_vad";
  const withTool = body.mode === "tool";
  const filler = body.filler === true;

  let instructions = REALTIME_BASE_PROMPT;
  if (withTool) instructions += filler ? FILLER_ON_PROMPT : FILLER_OFF_PROMPT;

  const session = {
    type: "realtime",
    model: "gpt-realtime",
    instructions,
    audio: {
      input: {
        // a transcript csak KÖZELÍTÉS — pont ezt mutatjuk meg az event logban
        transcription: { model: "gpt-4o-mini-transcribe", language: "hu" },
        turn_detection:
          vad === "semantic_vad"
            ? { type: "semantic_vad", eagerness: "auto" }
            : { type: "server_vad", silence_duration_ms: 500 },
      },
      output: { voice: "marin" },
    },
    tools: withTool ? [ORDER_TOOL] : [],
  };

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session }),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("client_secrets hiba:", JSON.stringify(data));
    return json(res, r.status, { error: data.error?.message || "client_secrets hiba" });
  }
  json(res, 200, { value: data.value });
}

// ---------- szerver ----------

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(path.join(__dirname, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "POST" && req.url === "/api/cascade") return await handleCascade(req, res);
    if (req.method === "POST" && req.url === "/api/realtime-session")
      return await handleRealtimeSession(req, res);
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Voice demó fut:  http://localhost:${PORT}`);
});
