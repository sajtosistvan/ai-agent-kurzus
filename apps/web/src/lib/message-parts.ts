import type { UIMessage } from 'ai';

// message-parts.ts — az üzenet részeinek szétválogatása EGY helyen, hogy az App.tsx
// render-blokkja olvasható maradjon: mit mond (text) és mit csinált (tool-részek).

/** A szerver `tool-<név>` típusú részei — a kártyához ennyi kell belőlük. */
export interface ToolUIPart {
  type: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

export function splitAssistantParts(m: UIMessage): {
  text: string;
  toolParts: ToolUIPart[];
} {
  const text = m.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const toolParts = m.parts.filter(
    (part): part is typeof part & ToolUIPart => part.type.startsWith('tool-'),
  );
  return { text, toolParts };
}
