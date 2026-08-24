import { describe, expect, it, vi } from 'vitest';
import type { MastraDBMessage } from '@mastra/core/agent';
import type { ProcessInputArgs } from '@mastra/core/processors';

import { piiSzuro } from './pii-szuro.js';
import { rbacProcesszor } from './rbac-processzor.js';
import { temakorGuardrail } from './temakor-guardrail.js';
import { belsoMunkatars, olvasSzerep } from './szerep.js';

// A bemeneti processzorok TISZTA logikája: nincs modellhívás, nincs DB — csak üzenet be,
// üzenet (vagy abort) ki. Pont ezért éri meg tesztelni: ez a réteg determinisztikusan véd.

/** Minimális felhasználói üzenet a processzoroknak. */
function uzenet(szoveg: string): MastraDBMessage {
  return {
    id: 'teszt-1',
    role: 'user',
    createdAt: new Date(0),
    content: { format: 2, parts: [{ type: 'text', text: szoveg }], content: szoveg },
  } as unknown as MastraDBMessage;
}

/** A processInput argumentumai; a requestContext-ből csak a `get` kell. */
function args(szoveg: string, szerep?: string): ProcessInputArgs {
  return {
    messages: [uzenet(szoveg)],
    abort: vi.fn((ok?: string) => {
      throw new Error(`ABORT: ${ok ?? ''}`);
    }),
    requestContext: { get: (kulcs: string) => (kulcs === 'szerep' ? szerep : undefined) },
  } as unknown as ProcessInputArgs;
}

function elsoSzoveg(uzenetek: MastraDBMessage[]): string {
  return (uzenetek[0]?.content.parts[0] as { text: string }).text;
}

describe('szerep', () => {
  it('szerep nélkül a legszűkebb jogosultságot feltételezi', () => {
    expect(olvasSzerep(undefined)).toBe('customer');
    expect(belsoMunkatars('customer')).toBe(false);
    expect(belsoMunkatars('admin')).toBe(true);
  });
});

describe('pii-szuro', () => {
  it('maszkolja az e-mail címet és a telefonszámot', () => {
    const eredmeny = piiSzuro.processInput(
      args('Írj a teszt.elek@pelda.hu címre vagy hívj: +36 30 123 4567'),
    ) as MastraDBMessage[];
    const szoveg = elsoSzoveg(eredmeny);
    expect(szoveg).toContain('[EMAIL]');
    expect(szoveg).toContain('[TELEFON]');
    expect(szoveg).not.toContain('teszt.elek@pelda.hu');
  });

  it('a content másolatát is maszkolja (különben a memóriában bennmaradna)', () => {
    const eredmeny = piiSzuro.processInput(
      args('a címem teszt.elek@pelda.hu'),
    ) as MastraDBMessage[];
    expect(eredmeny[0]?.content.content).toContain('[EMAIL]');
  });
});

describe('rbac-processzor', () => {
  it('vásárlótól elutasítja a katalógus-módosítást', () => {
    expect(() => rbacProcesszor.processInput?.(args('módosítsd a monstera árát 5000-re'))).toThrow(
      /ABORT/,
    );
  });

  it('admin szerepnek átengedi ugyanazt', () => {
    expect(() =>
      rbacProcesszor.processInput?.(args('módosítsd a monstera árát 5000-re', 'admin')),
    ).not.toThrow();
  });

  it('a sima növény-kérdést vásárlónak is átengedi', () => {
    expect(() => rbacProcesszor.processInput?.(args('milyen növényt ajánlasz?'))).not.toThrow();
  });
});

describe('temakor-guardrail', () => {
  it('elutasítja a témán kívüli kérdést', () => {
    expect(() =>
      temakorGuardrail.processInput?.(args('mondj egy receptet a gulyáslevesre kérlek szépen')),
    ).toThrow(/ABORT/);
  });

  it('átengedi a növény- és a bolti kérdést', () => {
    expect(() =>
      temakorGuardrail.processInput?.(args('mennyibe kerül a monstera és van-e készleten?')),
    ).not.toThrow();
  });

  it('a rövid üzenetet (igen / köszi) átengedi', () => {
    expect(() => temakorGuardrail.processInput?.(args('igen, jó lesz'))).not.toThrow();
  });
});
