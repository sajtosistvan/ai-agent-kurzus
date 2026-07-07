// SELECT-only guard a runSql toolhoz. Ez a MÁSODIK védelmi réteg: az első a read-only
// DB-szerepkör (plantbase_ro), ami fizikailag sem enged írást (NFR1). A guard a hibát már a
// DB előtt, érthetően jelzi, és kizárja a több utasítást / nem-SELECT lekérdezést.

const DEFAULT_LIMIT = 50;

// Egész-szavas tiltott kulcsszavak (írás / DDL / jogosultság). A több utasítást a ";"-ellenőrzés,
// a nem-SELECT kezdést a prefix-ellenőrzés zárja ki; itt a klasszikus író/DDL igéket fogjuk meg.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i;

export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* ... */
    .replace(/--[^\n]*/g, ' '); // -- ...
}

/**
 * Ellenőrzi, hogy a lekérdezés egyetlen, csak olvasó SELECT (vagy WITH ... SELECT),
 * és LIMIT-et tesz rá, ha hiányzik. A megtisztított, futtatható SQL-t adja vissza.
 * Hibás bemenetnél SqlGuardError-t dob.
 */
export function ensureReadOnlySelect(rawSql: string): string {
  const withoutComments = stripComments(rawSql);
  // Lezáró pontosvessző(k) eltávolítása.
  const trimmed = withoutComments
    .trim()
    .replace(/;+\s*$/, '')
    .trim();

  if (trimmed === '') {
    throw new SqlGuardError('Üres lekérdezés.');
  }
  // Több utasítás kizárása (a maradék pontosvessző tagol).
  if (trimmed.includes(';')) {
    throw new SqlGuardError('Csak egyetlen lekérdezés futtatható (nincs ";").');
  }

  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('select') && !lower.startsWith('with')) {
    throw new SqlGuardError(
      'Csak SELECT (vagy WITH ... SELECT) engedélyezett.',
    );
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new SqlGuardError(
      'Tiltott kulcsszó: csak olvasó lekérdezés futtatható (nincs írás/DDL).',
    );
  }

  // LIMIT kikényszerítése, ha hiányzik.
  if (!/\blimit\b/i.test(trimmed)) {
    return `${trimmed} LIMIT ${DEFAULT_LIMIT}`;
  }
  return trimmed;
}
