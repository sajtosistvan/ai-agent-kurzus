import type { MastraDBMessage } from '@mastra/core/agent';
import { BaseProcessor } from '@mastra/core/processors';
import type { ProcessInputArgs } from '@mastra/core/processors';

// pii-szuro.ts — SZEMÉLYES ADAT MASZKOLÁSA a modellhívás ELŐTT.
//
// A vásárlók sokszor beleírják az e-mail címüket vagy a telefonszámukat a kérdésbe. Ennek
// semmi keresnivalója a modellnél: benne maradna a szolgáltatóhoz kimenő kérésben, a
// trace-ben ÉS a memóriában is (a memória mostantól tartósan tárol — ez élesíti a tétet).
//
// MASZKOL, NEM TILT: a kérdés érdemi része megmarad, csak a személyes adat helyére
// [EMAIL] / [TELEFON] / [BANKKARTYA] kerül. A logba CSAK a minta neve megy, az érték soha —
// egy PII-szűrő, ami kilogolja a PII-t, pont azt a bajt okozza, amit meg akart oldani.

interface Minta {
  readonly nev: string;
  readonly cimke: string;
  readonly regex: RegExp;
}

// A bankkártya-minta a telefon ELŐTT fut: a hosszabb számsorra mindkettő illeszkedhet,
// és a szigorúbb találat a fontosabb.
const MINTAK: readonly Minta[] = [
  { nev: 'email', cimke: '[EMAIL]', regex: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
  { nev: 'bankkartya', cimke: '[BANKKARTYA]', regex: /\b(?:\d[ -]?){13,16}\b/g },
  { nev: 'telefon', cimke: '[TELEFON]', regex: /(?:\+36|06)[ -]?\d{1,2}[ -]?\d{3}[ -]?\d{3,4}/g },
];

/** Visszaadja a maszkolt szöveget és azt, mely mintákra volt találat. */
function maszkol(szoveg: string): { maszkolt: string; talalatok: string[] } {
  const talalatok: string[] = [];
  const maszkolt = MINTAK.reduce((aktualis, minta) => {
    const uj = aktualis.replace(minta.regex, minta.cimke);
    if (uj !== aktualis) {
      talalatok.push(minta.nev);
    }
    return uj;
  }, szoveg);
  return { maszkolt, talalatok };
}

/** Egy üzenet maszkolt MÁSOLATA (az eredetit nem módosítjuk). */
function maszkoltUzenet(uzenet: MastraDBMessage, talalatok: string[]): MastraDBMessage {
  const ujReszek = uzenet.content.parts.map((resz) => {
    if (resz.type !== 'text') {
      return resz;
    }
    const eredmeny = maszkol((resz as { text: string }).text);
    talalatok.push(...eredmeny.talalatok);
    return { ...resz, text: eredmeny.maszkolt };
  });

  // A `content.content` a teljes üzenet szöveges MÁSOLATA. Ha csak a `parts`-ot maszkolnánk,
  // az eredeti adat itt bennmaradna, és bekerülne a memóriába és a trace-be is.
  const ujContent =
    typeof uzenet.content.content === 'string'
      ? maszkol(uzenet.content.content).maszkolt
      : uzenet.content.content;

  return { ...uzenet, content: { ...uzenet.content, parts: ujReszek, content: ujContent } };
}

/** BaseProcessor-ből származik (nem sima objektum), mert így kapja meg a Mastra loggerét. */
class PiiSzuro extends BaseProcessor<'pii-szuro'> {
  readonly id = 'pii-szuro' as const;
  override readonly name = 'PII szűrő';
  readonly description =
    'E-mail címet, telefonszámot és bankkártyaszámot maszkol a modellhívás előtt.';

  processInput({ messages }: ProcessInputArgs): MastraDBMessage[] {
    const talalatok: string[] = [];
    const tisztitott = messages.map((uzenet) =>
      uzenet.role === 'user' ? maszkoltUzenet(uzenet, talalatok) : uzenet,
    );

    if (talalatok.length > 0) {
      this.mastra?.getLogger()?.warn('Személyes adat maszkolva a kérdésben', {
        mintak: [...new Set(talalatok)],
        darabszam: talalatok.length,
      });
    }
    return tisztitott;
  }
}

export const piiSzuro = new PiiSzuro();
