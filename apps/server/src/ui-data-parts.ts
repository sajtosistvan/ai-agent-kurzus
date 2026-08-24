import type { UIMessageStreamWriter } from 'ai';

// ui-data-parts.ts — a BÖNGÉSZŐNEK SZÓLÓ EXTRA RÉSZEK. A Mastra stream magától kiadja a
// szöveget és a `tool-<név>` részeket (ebből rajzol a kliens tool-kártyát), de a Plantbase
// UI-nak három saját chipje is van, aminek nincs Mastra-megfelelője:
//
//   data-agent   — KI dolgozik éppen (supervisor vagy egy al-agent)
//   data-tool    — egy tool-hívás rövid összefoglalója (chip a kártya fölött)
//   data-package — a csomagterv-kártya (összesítő + megerősítés)
//
// Ez NEM a régi házi trace visszacsempészése: itt egyetlen dolgot csinálunk, a Mastra
// futás-chunkjait lefordítjuk a UI SZERZŐDÉSÉRE (apps/web/src/lib/message-parts.ts).
// A megfigyelhetőség továbbra is a Mastra loggeré és a Studióé.

/** A `data-tool` part tartalma — az apps/web `ToolEventData` típusának tükre. */
export interface ToolEventData {
  agent: string;
  toolName: string;
  summary: string | null;
  isError: boolean;
  rowCount: number | null;
  nested: boolean;
}

/** Egy „elég közeli" Mastra chunk-alak: csak azt írjuk le, amire szükségünk van. */
interface MastraChunkLike {
  type: string;
  payload?: Record<string, unknown>;
}

/** A csomagterv felismerése a tool-kimenetből — alak alapján, tool-névre hivatkozás nélkül. */
function csomagTervE(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const plan = value as Record<string, unknown>;
  return (
    typeof plan['customerCode'] === 'string' &&
    Array.isArray(plan['items']) &&
    typeof plan['totalPrice'] === 'number'
  );
}

/** Szám kiolvasása több lehetséges mezőnév közül (magyar és angol tool-sémák). */
function elsoSzam(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (typeof source[key] === 'number') {
      return source[key] as number;
    }
  }
  return null;
}

/** Szöveg kiolvasása több lehetséges mezőnév közül. */
function elsoSzoveg(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof source[key] === 'string' && source[key] !== '') {
      return source[key] as string;
    }
  }
  return null;
}

/**
 * Egy Mastra futás chunkjaiból UI data-* partokat ír. A visszaadott függvényt az
 * `agent.stream({ onChunk })` hívja meg minden chunkra; a belső állapot (ki az aktuális
 * agent) csak ennyi.
 */
export function createDataPartWriter(args: {
  writer: UIMessageStreamWriter;
  /** A gyökér-agent azonosítója — amíg nincs al-agent, ő „dolgozik". */
  rootAgentId: string;
}): (chunk: unknown) => void {
  const { writer, rootAgentId } = args;
  let aktualisAgent = rootAgentId;
  let melyseg = 0;

  writer.write({ type: 'data-agent', data: { agent: rootAgentId } });

  return (chunk: unknown): void => {
    const { type, payload } = (chunk ?? {}) as MastraChunkLike;
    if (!payload) {
      return;
    }

    if (type === 'agent-execution-start') {
      const agentId = payload['agentId'];
      if (typeof agentId === 'string') {
        aktualisAgent = agentId;
        melyseg += 1;
        writer.write({ type: 'data-agent', data: { agent: agentId } });
      }
      return;
    }

    if (type === 'agent-execution-end') {
      melyseg = Math.max(0, melyseg - 1);
      aktualisAgent = melyseg === 0 ? rootAgentId : aktualisAgent;
      writer.write({ type: 'data-agent', data: { agent: aktualisAgent } });
      return;
    }

    if (type !== 'tool-result') {
      return;
    }

    const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : 'ismeretlen';
    const result = payload['result'];
    const resultObject =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : {};

    writer.write({
      type: 'data-tool',
      data: {
        agent: aktualisAgent,
        toolName,
        summary: elsoSzoveg(resultObject, ['osszefoglalo', 'summary', 'uzenet']),
        isError:
          payload['isError'] === true || resultObject['sikeres'] === false,
        rowCount: elsoSzam(resultObject, ['sorokSzama', 'rowCount', 'talalatok']),
        nested: melyseg > 0,
      } satisfies ToolEventData,
    });

    // A csomagterv a saját kártyáját kapja — akkor is, ha épp melyik tool adta vissza.
    const terv = csomagTervE(result)
      ? result
      : csomagTervE(resultObject['terv'])
        ? resultObject['terv']
        : null;
    if (terv) {
      writer.write({ type: 'data-package', data: terv as Record<string, unknown> });
    }
  };
}
