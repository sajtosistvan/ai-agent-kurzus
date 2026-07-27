import { describe, expect, it } from 'vitest';
import { chatThread, esc, md } from './html.js';

describe('esc', () => {
  it('HTML-metakaraktereket escape-el', () => {
    expect(esc('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
  });
});

describe('md', () => {
  it('címsor + félkövér + lista', () => {
    const out = md('## Cím\n- egy **kettő**');
    expect(out).toContain('<h4>Cím</h4>');
    expect(out).toContain('<li>egy <strong>kettő</strong></li>');
  });
  it('markdown táblázatot renderel', () => {
    const out = md('| Név | Ár |\n|---|---|\n| Bazsalikom | 990 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>Név</th>');
    expect(out).toContain('<td>Bazsalikom</td>');
  });
  it('escape-el a renderelt tartalomban is', () => {
    expect(md('<b>x</b>')).toContain('&lt;b&gt;');
  });
});

describe('chatThread', () => {
  it('egy-körös: kérdés user-buborék, válasz bot-buborék', () => {
    const out = chatThread('Hány növény van?', '30 növény.');
    expect(out).toContain('class="msg user"');
    expect(out).toContain('class="msg bot"');
    expect(out).toContain('Hány növény van?');
  });
  it('több-körös átiratot körökre bont (👤/🤖)', () => {
    const transcript = '👤 Szia\n🤖 Helló\n\n👤 Kösz\n🤖 Szívesen';
    const out = chatThread('', transcript);
    expect((out.match(/class="msg user"/g) ?? []).length).toBe(2);
    expect((out.match(/class="msg bot"/g) ?? []).length).toBe(2);
  });
});
