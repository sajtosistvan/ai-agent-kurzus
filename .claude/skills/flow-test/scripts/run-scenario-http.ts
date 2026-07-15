import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import { DONE_MARKER, loadScenario, nextUserMessage, type Turn } from './persona.js';

// run-scenario-http.ts — HTTP driver: fetch a /api/chat-ra, a stream feldolgozása
// readUIMessageStream-mel. Gyors, fejlesztés közbeni iterációra. A szervernek a TESZTELT
// ORCHESTRATION_MODE-dal kell futnia; a --mode flag itt csak CÍMKE a loghoz.

const BASE = process.env['FLOW_TEST_API'] ?? 'http://localhost:3001';

/** SSE → UIMessageChunk stream. A szerver `data: {json}\n\n` eseményeket küld, a végén [DONE]. */
function sseToChunkStream(body: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('');
        if (data !== '' && data !== '[DONE]') {
          controller.enqueue(JSON.parse(data) as UIMessageChunk);
        }
      }
    },
  });
}

async function sendMessage(threadId: string | null, text: string): Promise<UIMessage> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId,
        message: { id: `sim-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] },
      }),
    });
  } catch {
    throw new Error(
      `Nem érem el a szervert (${BASE}) — fut a \`ORCHESTRATION_MODE=<mód> pnpm server\`?`,
    );
  }
  if (!response.ok || !response.body) {
    throw new Error(`A szerver hibával válaszolt: ${response.status} ${await response.text()}`);
  }
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: sseToChunkStream(response.body) })) {
    last = message;
  }
  if (!last) {
    throw new Error('Üres stream érkezett a szervertől.');
  }
  return last;
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function dataPartsOf(message: UIMessage): { type: string; data: unknown }[] {
  return message.parts
    .filter((p): p is { type: string; data: unknown } & typeof p => p.type.startsWith('data-'))
    .map((p) => ({ type: p.type, data: p.data }));
}

async function main(): Promise<void> {
  const [scenarioPath, ...rest] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error('Használat: run-scenario-http.ts <scenario.md> [--mode router|delegate]');
    process.exit(1);
  }
  const mode = rest[rest.indexOf('--mode') + 1] ?? 'ismeretlen';
  const scenario = loadScenario(scenarioPath);
  const turns: Turn[] = [];
  let threadId: string | null = null;

  for (let i = 0; i < scenario.maxTurns; i++) {
    const userText = await nextUserMessage(scenario, turns);
    if (userText.includes(DONE_MARKER)) {
      break;
    }
    console.log(`\n[${i + 1}] FELHASZNÁLÓ: ${userText}`);
    const reply = await sendMessage(threadId, userText);
    const dataParts = dataPartsOf(reply);
    const thread = dataParts.find((p) => p.type === 'data-thread');
    if (thread) {
      threadId = (thread.data as { threadId: string }).threadId;
    }
    const assistant = textOf(reply);
    console.log(`[${i + 1}] ASSZISZTENS: ${assistant.slice(0, 200)}`);
    turns.push({ user: userText, assistant, dataParts });
  }

  mkdirSync('logs/flow-test', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('logs/flow-test', `${stamp}-${basename(scenarioPath, '.md')}-${mode}.json`);
  writeFileSync(file, JSON.stringify({ scenario: scenario.name, mode, expectations: scenario.expectations, turns }, null, 2));
  console.log(`\nTrace mentve: ${file}`);
}

main().catch((error) => {
  console.error(`flow-test hiba: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
