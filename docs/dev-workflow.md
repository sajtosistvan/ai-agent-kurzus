# Plantbase — fejlesztői workflow + automatizmus

> Kurzus-melléklet. Konkrét git-szabályok, hook-konfigurációk, dokumentációs folyamat. L1 (amivel építünk): ezt is átadjuk a Claude Code-nak.

## Git

### Branching

- `main`: mindig zöld, deploy-olható. Közvetlenül main-re NEM commitolunk.
- Feature branch: `feat/<rövid-leírás>` (pl. `feat/runsql-tool`). Egyéb prefixek: `fix/`, `refactor/`, `docs/`, `chore/`.
- A kurzus checkpointjai (`stage-N`) branchek a fallbackhez.

### Commit (Conventional Commits)

Formátum: `<típus>: <leírás>`. Típusok: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.
Példák: `feat: add read-only runSql tool`, `test: cover runSql SELECT-only guard`.

### Auto-commit

Minden befejezett, koherens lépés után kicsi, fókuszált commit (egy lépés = egy commit). Lásd a `Stop` hookot.

## Hookok (`settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "pnpm prettier --write $FILE",
            "timeout": 10000,
            "async": true
          },
          {
            "type": "command",
            "command": "pnpm vitest related --run $FILE",
            "timeout": 60000,
            "async": true
          }
        ]
      }
    ]
  }
}
```

- **prettier** (PostToolUse, Edit): formázás szerkesztés után.
- **teszt** (PostToolUse, Edit): a változáshoz tartozó Vitest fut.

FONTOS: a hookok a **Claude Code (L1) akcióit** fogják meg (amit Claude szerkeszt/futtat), NEM a termék futásidejű SQL-jét. A termék read-only védelme a **DB-kapcsolat (read-only role)**, nem hook, mert a `runSql` a termék kódja, nem Claude Code tool.

## /docs (a repóban)

```
docs/
├── ddd/
│   ├── glossary.md        ubiquitous language (növény, kategória, fényigény, gondozás...)
│   └── model.md           entitások, value objectek, aggregátumok
└── tech/
    ├── infra.md           Postgres (OrbStack docker-compose), .env, a két DB-kapcsolat
    ├── architecture.md    core/apps, adat-elérés, read-only vs Prisma
    └── api.md             tool/CLI felület (ask, runSql)
```

## Dokumentáció-frissítés

A `/docs` frissítését a **`ddd-audit` skill** végzi (git-history → docs), külön, igény szerint futtatva. NEM készítünk doc-freshness ellenőrző scriptet és Stop hookot az elején. A CI-alapú változat a 4. órán jön (always-on / CI/CD).
