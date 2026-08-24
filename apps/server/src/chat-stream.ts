import type { UIMessageStreamWriter } from 'ai';
import { toAISdkStream } from '@mastra/ai-sdk';
import { mastra } from '@plantbase/core';
import { createDataPartWriter } from './ui-data-parts.js';
import { WEB_RESOURCE } from './threads.js';

// chat-stream.ts — EGY belépési pont a chathez: a supervisor agent.
//
// AMI MEGSZŰNT: az `ORCHESTRATION_MODE` (off/router/delegate) kapcsoló és a hozzá tartozó
// két kézzel írt handover-út. A Mastrában az al-agent-delegálás a keretrendszer dolga
// (a supervisor al-agentként hívja a query-, katalógus- és csomag-agentet), ezért nincs
// mit kapcsolgatni: EGY út van.
//
// STREAM: a Mastra futás kimenetét a `toAISdkStream(..., { from: 'agent', version: 'v6' })`
// fordítja AI SDK UI-üzenetfolyammá (a repo `ai@6`-on van) — ebből jön a szöveg és a
// `tool-<név>` rész. A Plantbase saját chipjeit (data-agent/data-tool/data-package) az
// `onChunk` mellékágon írjuk ki, lásd ui-data-parts.ts.
//
// ELŐZMÉNY: nincs kézi `history` — a `memory: { thread, resource }` opció miatt a Mastra
// tölti be a thread korábbi üzeneteit, és menti is az újakat.

const ROOT_AGENT_ID = 'plantbase-supervisor';

export async function streamChat(args: {
  question: string;
  threadId: string;
  /** Új thread esetén ezzel a címmel jön létre; meglévőnél nincs hatása. */
  threadTitle: string;
  writer: UIMessageStreamWriter;
}): Promise<void> {
  const agent = mastra.getAgentById(ROOT_AGENT_ID);
  const onChunk = createDataPartWriter({
    writer: args.writer,
    rootAgentId: ROOT_AGENT_ID,
  });

  const result = await agent.stream(args.question, {
    memory: {
      thread: { id: args.threadId, title: args.threadTitle },
      resource: WEB_RESOURCE,
    },
    onChunk: (chunk) => onChunk(chunk),
  });

  args.writer.merge(toAISdkStream(result, { from: 'agent', version: 'v6' }));
}
