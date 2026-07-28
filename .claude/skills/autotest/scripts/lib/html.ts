// html.ts — a két riport-generátor (report-html.ts, rag-report-html.ts) KÖZÖS HTML-építői.
// „A közös kód eggyel kintebb lakik" (konvenciok.md) — korábban szó szerint duplikálva volt, és
// az `md` már divergált (a battery-változat tudott táblázatot, a RAG-os nem). Itt egy közös,
// táblázat-képes változat él. Self-contained (nincs külső lib).
import { spawn } from 'node:child_process';
import { platform } from 'node:process';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markdown: **félkövér**, *dőlt*, `kód` — a szöveg már escape-elt. */
export function mdInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** Mini markdown → HTML: címsorok, listák, TÁBLÁZAT, félkövér — hogy az asszisztens üzenete úgy
 *  nézzen ki, mint az élő chatben. */
export function md(src: string): string {
  const lines = esc(src).split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  const close = (): void => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
    if (inOl) {
      html += '</ol>';
      inOl = false;
    }
  };
  const isRow = (l: string): boolean => l.includes('|');
  const isSep = (l: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    if (!t) {
      close();
      i++;
      continue;
    }
    if (isRow(lines[i]!) && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      close();
      const header = splitRow(lines[i]!);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim() && isRow(lines[i]!)) {
        body.push(splitRow(lines[i]!));
        i++;
      }
      html +=
        '<div class="tbl-wrap"><table><thead><tr>' +
        header.map((h) => `<th>${mdInline(h)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>';
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(#{1,4})\s+(.*)/))) {
      close();
      const lvl = Math.min(6, m[1]!.length + 2);
      html += `<h${lvl}>${mdInline(m[2]!)}</h${lvl}>`;
    } else if ((m = t.match(/^[-*]\s+(.*)/))) {
      if (inOl) close();
      if (!inUl) {
        html += '<ul>';
        inUl = true;
      }
      html += `<li>${mdInline(m[1]!)}</li>`;
    } else if ((m = t.match(/^\d+\.\s+(.*)/))) {
      if (inUl) close();
      if (!inOl) {
        html += '<ol>';
        inOl = true;
      }
      html += `<li>${mdInline(m[1]!)}</li>`;
    } else {
      close();
      html += `<p>${mdInline(t)}</p>`;
    }
    i++;
  }
  close();
  return html || '<em>üres</em>';
}

/** A teljes beszélgetés chat-nézetben (user + asszisztens buborékok). */
export function chatThread(question: string, answer: string): string {
  const turns: { user: string; bot: string }[] = [];
  if (answer.includes('👤')) {
    for (const chunk of answer.split('👤 ').map((s) => s.trim()).filter(Boolean)) {
      const [user, ...botParts] = chunk.split('🤖');
      turns.push({ user: (user ?? '').trim(), bot: botParts.join('🤖').trim() });
    }
  } else {
    turns.push({ user: question, bot: answer });
  }
  const bubbles = turns
    .map(
      (t) =>
        `${t.user ? `<div class="msg user">${esc(t.user)}</div>` : ''}` +
        `<div class="msg bot"><div class="rendered">${md(t.bot)}</div></div>`,
    )
    .join('');
  return `<div class="chat">${bubbles}</div>`;
}

/** A riport megnyitása az OS alapértelmezett böngészőjében (fire-and-forget). */
export function openInBrowser(path: string): void {
  const opener = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(opener, [path], { detached: true, stdio: 'ignore', shell: platform === 'win32' });
    child.unref();
  } catch {
    /* headless/CI: nem kritikus */
  }
}
