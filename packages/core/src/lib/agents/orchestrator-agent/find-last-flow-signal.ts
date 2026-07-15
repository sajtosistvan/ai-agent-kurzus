// find-last-flow-signal.ts — a FLOW-LOCK állapota. Nem session-store: a szerver stateless,
// a lock az üzenet-előzményben MÁR ÚGYIS OTT LÉVŐ data-tool partokból olvasható ki.
// Nyitás: routeTo → package (az orchestrator döntése). Zárás: sikeres savePackage vagy
// cancelPackage. SOHA nem a válasz-szöveget parse-oljuk — csak strukturált tool-eseményeket.

export type FlowSignal = 'package-open' | 'closed' | 'none';

/** Minimális szerkezeti típus: a szerver UIMessage-eket ad be, a teszt sima objektumokat. */
export interface FlowHistoryPart {
  type: string;
  data?: unknown;
}
export interface FlowHistoryMessage {
  parts: FlowHistoryPart[];
}

interface ToolPartData {
  toolName?: string;
  targetAgent?: string;
  isError?: boolean;
}

export function findLastFlowSignal(messages: FlowHistoryMessage[]): FlowSignal {
  let state: FlowSignal = 'none';
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'data-tool' || typeof part.data !== 'object' || part.data === null) {
        continue;
      }
      const data = part.data as ToolPartData;
      if (data.isError) {
        continue; // hibás tool-futás nem jelzés — a lock nem mozdul
      }
      if (data.toolName === 'routeTo' && data.targetAgent === 'package') {
        state = 'package-open';
      }
      if (data.toolName === 'savePackage' || data.toolName === 'cancelPackage') {
        state = 'closed';
      }
    }
  }
  return state;
}
