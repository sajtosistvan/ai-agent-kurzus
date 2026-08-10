import type { MastraDBMessage } from '@mastra/core/agent';

// utolso-kerdes.ts — apró közös segéd a processzoroknak: az utolsó FELHASZNÁLÓI üzenet
// szövege, kisbetűsítve. Két processzor is ezen dolgozik (RBAC, témakör-guardrail), ezért
// egy helyen él — a kulcsszavas heurisztika maga marad a processzorokban.

export function utolsoFelhasznaloiSzoveg(messages: MastraDBMessage[]): string {
  return (
    messages
      .filter((uzenet) => uzenet.role === 'user')
      .at(-1)
      ?.content.parts.filter((resz) => resz.type === 'text')
      .map((resz) => (resz as { text: string }).text)
      .join(' ')
      .toLowerCase() ?? ''
  );
}
