// ansi.ts — terminál-színek EGY helyen. A trace (agent-nyom) és a RAG-log ugyanazt a
// helpert használja, hogy a "control room" kimenet egységes legyen, és a nyers \x1b
// escape-ek ne szennyezzék az üzleti kódot.

const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const wrap =
  (code: number) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  dim: wrap(2),
  bold: wrap(1),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  magenta: wrap(35),
  cyan: wrap(36),
  white: wrap(37),
};
