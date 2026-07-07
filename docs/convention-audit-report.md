# Convention Audit Report — Plantbase Domain & Code Consistency

**Audit Date:** 2025-07-06  
**Scope:** DDD domain model (`docs/ddd/`), TypeScript conventions (`docs/konvenciok.md`), source code (`packages/core`, `apps/cli`)  
**Tools:** Read, Grep, Bash  
**Output Level:** 3 CRITICAL, 1 HIGH, 3 MEDIUM, 2 LOW

---

## Summary

Overall code quality is **strong**. Type safety, error handling, and immutability patterns are well-executed. No critical security or type-safety violations found. Main findings concern documentation clarity and minor logging convention.

**Findings by Severity:**

| Level | Count | Status |
|-------|-------|--------|
| **CRITICAL** | 0 | — |
| **HIGH** | 1 | `console.log` in production code (mitigated by context) |
| **MEDIUM** | 3 | Domain mapping undocumented, SQL string handling docs, ubiquitous language gaps |
| **LOW** | 2 | Comment precision, Trace file size edge case |

---

## Detailed Findings

### HIGH Severity

#### 1. console.log in CLI Output Path
**File:** `apps/cli/src/main.ts:62`  
**Issue:** Direct `console.log(result.answer)` appears in production code path.

```typescript
// main.ts:59-63
if (options.quiet) {
  console.log(result.answer);  // ← console.log in product code
}
```

**Verdict:** MITIGATED  
- Only used in `--quiet` mode when `print: false` (trace bypassed)
- Used for CLI output, not debug logging
- But **strictly speaking violates `konvenciok.md:47`** which states "Nincs `console.log` a termékkódban"

**Recommendation:**  
- Replace with structured logger from `@plantbase/core` (e.g., `traceLog`) for consistency, OR
- Add explicit exemption comment: `// CLI output, not debug logging`
- Consider using `process.stdout.write()` for intentional console output vs. logging

**Severity Rationale:** The violation is minor (output path, not debug), but the rule is absolute. Marked HIGH because it breaks the letter of the convention.

---

### MEDIUM Severity

#### 2. CareLevel ↔ Product.difficulty Mapping Undocumented
**Files:** `docs/ddd/model.md:39-43`, `packages/core/src/lib/tools/client-preferences.ts`  
**Issue:** The model.md explicitly notes this is an **open question** — how the agent should filter products by client care preference is not specified in the glossary or prompts.

```typescript
// client-preferences.ts:14-15
export const CARE_LEVELS = ['ALACSONY', 'KÖZEPES', 'MAGAS'] as const;

// Prisma schema product.difficulty: 'kezdő | haladó | profi'
// These are NOT the same scale. No mapping rules in code or docs.
```

**Observed Behavior:**
- Agent **never uses `getClientPreferences`** to filter — it only returns budget + careLevel as info
- The system-prompt (`prompts.ts:41-43`) vaguely says "vedd figyelembe a büdzsét (összár) és a szoba adottságait"
- No explicit rule: "IF careLevel=ALACSONY, recommend difficulty=kezdő"

**Verdict:** UNRESOLVED DESIGN DECISION  
The model.md correctly flags this as needing **business decision**. Until then, the tool exists but is underutilized.

**Recommendation:**
1. **Clarify in docs/ddd/glossary.md:** Add mapping table:
   ```
   ALACSONY ↔ kezdő
   KÖZEPES ↔ haladó
   MAGAS ↔ profi
   ```
2. **Update system-prompt** to explicitly use this rule in the `<rules>` section
3. **Add test case** in `packages/core/src/lib/tools/index.spec.ts` that verifies the mapping is applied

**Severity Rationale:** Design is sound (acknowledging uncertainty), but incomplete. Blocks full utility of `getClientPreferences` tool.

---

#### 3. SQL String Handling Documentation Gap
**File:** `packages/core/src/lib/tools/sql-guard.ts`  
**Issue:** The guard's escape and comment-stripping logic is sound, but there's a subtle inconsistency between docs and implementation:

**System-prompt says** (`docs/system-prompt.md:34`):
```
- Szöveges keresés: ILIKE (kis/nagybetű-független), pl. name ILIKE '%pozsgás%'.
```

**Implementation** (`sql-guard.ts:19-23`):
```typescript
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // /* ... */
    .replace(/--[^\n]*/g, ' ');         // -- ...
}
```

The system-prompt doesn't warn the model that comments will be stripped, potentially leading the model to embed comments it expects will survive. **Not a vulnerability** (guards are correct), but a clarity gap.

**Recommendation:**  
Add to system-prompt `<rules>`:
```xml
- Megjegyzések (-- és /* */) a lekérdezésből el lesznek távolítva a biztonsági ellenőrzés során.
```

**Severity Rationale:** Minor; guards are correct, model compliance is good in practice. But clarity improves prompting.

---

#### 4. `ClientCode` / `ClientPreference` Glossary Inconsistency
**Files:** `docs/ddd/glossary.md`, `packages/core/src/lib/tools/client-preferences.ts`  
**Issue:** Glossary shows ACME, GLOBEX, INITECH as valid ügyfélkód examples, but doesn't link this to the actual **implementation list** in code.

**Glossary** (line 9-10):
```markdown
| **Ügyfélkód** | `ClientCode` | Az ügyfél rövid azonosítója; a `getClientPreferences` tool bemenete. |
```

**Code** (`client-preferences.ts:25-29`):
```typescript
export const CLIENT_PREFERENCES = {
  ACME: { budget: 1000, careLevel: 'ALACSONY' },
  GLOBEX: { budget: 5000, careLevel: 'KÖZEPES' },
  INITECH: { budget: 250000, careLevel: 'MAGAS' },
} as const satisfies Record<string, ClientPreference>;
```

The glossary should reference that **only these three codes** are valid, and their budgets/care levels.

**Recommendation:**  
Expand glossary entry:
```markdown
| **Ügyfélkód** | `ClientCode` | Az ügyfél rövid azonosítója; a `getClientPreferences` tool bemenete. Érvényes kódok: **ACME** (1000 Ft, ALACSONY), **GLOBEX** (5000 Ft, KÖZEPES), **INITECH** (250000 Ft, MAGAS). |
```

**Severity Rationale:** Minor documentation gap; the code is correct and tests will catch misconfigurations. But glossary should be the single source of truth.

---

### LOW Severity

#### 5. Trace File Size Approaching Convention Threshold
**File:** `packages/core/src/lib/trace.ts`  
**Stats:** 351 lines (konvenciok.md recommends 200–400, max 800)

**Verdict:** ACCEPTABLE  
The file is well-structured and focused (observability/tracing only). No action needed.

**Note:** If observability expands, consider splitting into `trace.ts` (data structures) + `trace-printer.ts` (rendering).

---

#### 6. Comment Precision: trace.ts Line 64-65
**File:** `packages/core/src/lib/trace.ts:64-65`  
**Issue:** Minor comment clarity.

```typescript
/** Saját log-sor a konzolba ÉS a watch-logba — bárhonnan hívható a kódból. A nyers
 *  console.log-gal szemben ez a `tail -f` control roomban is megjelenik. */
export function traceLog(text: string): void {
```

**Comment phrasing:** "A nyers console.log-gal szemben" could be clearer: "Unlike raw `console.log`, which is not captured."

**No action required** (existing approach is idiomatic), but noted for future doc updates.

---

## Domain Model Consistency: ✓ VERIFIED

### Ubiquitous Language Check

All key terms from `docs/ddd/glossary.md` are correctly used in code:

| Term | Glossary | Code Location | ✓ Match |
|------|----------|---|---|
| **ClientCode** | ACME, GLOBEX, INITECH | `client-preferences.ts:31, 34` | ✓ |
| **ClientPreference** | budget + careLevel | `client-preferences.ts:17-22` | ✓ |
| **CareLevel** | ALACSONY, KÖZEPES, MAGAS | `client-preferences.ts:14-15` | ✓ |
| **Product** | entitás a katalógusban | `schema.prisma:17-40` | ✓ |
| **Katalógus** | products tábla | `system-prompt.ts:17-29` | ✓ |

✓ **All domain entities present and correctly named.**

---

## TypeScript Convention Compliance: ✓ STRONG

### Type Safety
- ✓ Explicit types on public APIs (`agent.ts`, `config.ts`, `client-preferences.ts`)
- ✓ **Zero `any` usage** in production code
- ✓ String literal unions used instead of `enum` (e.g., `CareLevel`)
- ✓ `unknown` properly narrowed at boundaries (config.ts, run-sql.ts)

### Error Handling
- ✓ Zod schema validation on all external inputs (config, tools)
- ✓ `unknown` errors safely instanceof-checked (db-readonly.ts:46, run-sql.ts:73)
- ✓ Errors returned as `.content` string, never swallowed

### Immutability
- ✓ Agent context spread: `[...messages, ...result.response.messages]` (agent.ts:146)
- ✓ No object mutations detected

### File Organization
- ✓ All files <800 lines (largest: trace.ts 351 lines)
- ✓ High cohesion: `trace.ts`, `config.ts`, `client-preferences.ts` each have single responsibility
- ✓ Naming: camelCase variables, PascalCase types, kebab-case filenames

### Security
- ✓ Config validates API key is not placeholder (config.ts:14-16)
- ✓ SQL SELECT-only guard (sql-guard.ts:30-63)
- ✓ Read-only database connection with statement timeout (db-readonly.ts:24)
- ✓ No string-concatenated SQL queries

---

## Recommendations Summary

### Priority 1 (Next Sprint)
1. **[HIGH]** Replace `console.log` in `main.ts:62` with structured logging or add explicit exemption comment
2. **[MEDIUM]** Document CareLevel ↔ difficulty mapping in `glossary.md` + update system-prompt

### Priority 2 (Documentation)
3. **[MEDIUM]** Add SQL comment-stripping note to system-prompt
4. **[MEDIUM]** Expand `ClientCode` entry in glossary with actual valid codes and budgets

### Priority 3 (Nice to Have)
5. **[LOW]** Consider extracting trace rendering logic if file grows beyond 400 lines

---

## Conclusion

The codebase is **well-maintained** with strong adherence to TypeScript conventions and clear domain modeling. The domain-driven design approach is correctly implemented, with ubiquitous language consistently used across code and documentation.

**Open items are all resolvable:**
- One minor console.log in a non-debug context (easily fixed)
- One documented open business question (CareLevel mapping) that blocks full tool utilization
- Minor documentation gaps (gossary expansion, SQL comment note)

**No blocking issues for production readiness.**

---

**Report prepared by:** Convention Auditor  
**Read-only mode:** ✓ No files modified  
**Next review:** Recommended after CareLevel mapping decision is finalized
