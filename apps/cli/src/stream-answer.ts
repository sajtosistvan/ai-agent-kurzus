import { stdout } from 'node:process';
import type { Agent } from '@mastra/core/agent';

// stream-answer.ts — EGY agent-kör a terminálban: kérdés be, válasz betűnként ki.
//
// Ez a fájl a bizonyítéka annak, hogy a saját agent-loopunkra nincs többé szükség: a
// `agent.stream()` visszaadja a Mastra futás kimenetét, mi pedig csak a `textStream`-et
// írjuk a stdout-ra. A tool-hívások, a lépések és a hibák a Mastra loggerébe és a
// Studióba (`pnpm mastra:dev`) kerülnek — nem a terminál dolga őket kirajzolni.
//
// MEMÓRIA: a `memory: { thread, resource }` opció kapcsolja be a Mastra Memoryt. Az
// előzményt NEM mi adogatjuk körről körre — a thread azonosítója elég, a többi a Mastra dolga.

export interface BeszelgetesAzonosito {
  /** A beszélgetés azonosítója — ugyanaz a thread = folytatódó beszélgetés. */
  thread: string;
  /** Ki beszél — a CLI-ben egy fix „gépnél ülő ember". */
  resource: string;
}

/**
 * Feltesz egy kérdést az agentnek, és a válasz szövegét streamelve a stdout-ra írja.
 * A stream végén sortörést teszünk, hogy a prompt tiszta sorban jöjjön vissza.
 */
export async function streamAgentAnswer(
  agent: Agent,
  input: string,
  beszelgetes: BeszelgetesAzonosito,
): Promise<void> {
  const result = await agent.stream(input, {
    memory: { thread: beszelgetes.thread, resource: beszelgetes.resource },
  });

  for await (const chunk of result.textStream) {
    stdout.write(chunk);
  }
  stdout.write('\n');
}
