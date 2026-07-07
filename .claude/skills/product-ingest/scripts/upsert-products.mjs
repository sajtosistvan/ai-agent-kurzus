#!/usr/bin/env node
// Plantbase termék-ingest — DETERMINISZTIKUS 3. fázis.
// Beolvassa az LLM által feldúsított, sémára illesztett termékeket (stdin vagy fájl-arg, JSON tömb),
// szigorúan validál a rendszer-határon (fail-fast), majd latin név szerint UPSERT-el a `products` táblába
// a READ-WRITE Prisma kliensen (DATABASE_URL). Az agent read-only kapcsolatát NEM érinti.
//
// A `products` táblán jelenleg NINCS unique index a latin_name-en, ezért "find-then-update/create"
// mintát használunk (idempotens újrafuttatás). Ajánlott hardening: @unique a latinName-en + prisma.upsert.
//
// Használat:
//   node fetch-feeds.mjs > candidates.json          # 1. fázis
//   # 2. fázis: az LLM feldúsítja -> enriched.json (rekord-tömb)
//   node upsert-products.mjs enriched.json           # 3. fázis (vagy: cat enriched.json | node upsert-products.mjs)
//   node upsert-products.mjs enriched.json --dry-run # csak validál + jelent, NEM ír DB-be
//
// Függőség-mentes szándékkal: a validáció kézi (a bundolt script bárhonnan fusson, ne igényeljen zod-ot;
// az alkalmazáson BELÜLI ingest a konvenció szerint Zod-ot használna). A Prisma klienst createRequire
// tölti (CJS interop), az útvonal a scripthez relatív — a cwd-től független.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// A séma-enumok a schema.prisma kommentjeiből (system-prompt.md a forrás). String-literal union.
const CATEGORY = ['szobanövény', 'kerti', 'pozsgás', 'kaktusz', 'fűszer', 'fa-cserje', 'lógó', 'virágzó']
const LOCATION = ['beltéri', 'kültéri', 'mindkettő']
const LIGHT = ['árnyék', 'alacsony', 'közepes', 'erős', 'direkt nap']
const WATERING = ['ritka', 'közepes', 'gyakori', 'állandóan nedves']
const DIFFICULTY = ['kezdő', 'haladó', 'profi']

const isInt = (n) => typeof n === 'number' && Number.isInteger(n)
const isStr = (s) => typeof s === 'string' && s.trim().length > 0
const inEnum = (v, list) => list.includes(v)

// Validáció a rendszer-határon: az LLM kimenete megbízhatatlan input -> szigorú ellenőrzés, fail-fast.
// Visszaad egy hibalista-tömböt (üres = érvényes).
function validate(p) {
  const errs = []
  const req = (cond, msg) => { if (!cond) errs.push(msg) }
  req(isStr(p?.name), 'name: nem üres string kell')
  req(isStr(p?.latinName), 'latinName: nem üres string kell')
  req(inEnum(p?.category, CATEGORY), `category: egy ezek közül: ${CATEGORY.join('|')}`)
  req(inEnum(p?.location, LOCATION), `location: egy ezek közül: ${LOCATION.join('|')}`)
  req(typeof p?.price === 'number' && p.price > 0, 'price: pozitív szám (HUF) kell')
  req(p?.salePrice === null || (typeof p?.salePrice === 'number' && p.salePrice > 0), 'salePrice: pozitív szám vagy null')
  req(p?.salePrice == null || (typeof p?.price === 'number' && p.salePrice < p.price), 'salePrice: csak a price alatt lehet (akciós ár)')
  req(isInt(p?.stock) && p.stock >= 0, 'stock: nemnegatív egész')
  req(inEnum(p?.light, LIGHT), `light: egy ezek közül: ${LIGHT.join('|')}`)
  req(inEnum(p?.watering, WATERING), `watering: egy ezek közül: ${WATERING.join('|')}`)
  req(inEnum(p?.difficulty, DIFFICULTY), `difficulty: egy ezek közül: ${DIFFICULTY.join('|')}`)
  req(isInt(p?.currentHeightCm) && p.currentHeightCm > 0, 'currentHeightCm: pozitív egész')
  req(isInt(p?.maxHeightCm) && p.maxHeightCm > 0, 'maxHeightCm: pozitív egész')
  req(isInt(p?.currentPotCm) && p.currentPotCm > 0, 'currentPotCm: pozitív egész')
  req(typeof p?.petSafe === 'boolean', 'petSafe: boolean')
  req(typeof p?.kidSafe === 'boolean', 'kidSafe: boolean')
  req(typeof p?.airPurifying === 'boolean', 'airPurifying: boolean')
  req(typeof p?.rating === 'number' && p.rating >= 0 && p.rating <= 5, 'rating: 0 és 5 közötti szám')
  req(isInt(p?.reviewsCount) && p.reviewsCount >= 0, 'reviewsCount: nemnegatív egész')
  req(isStr(p?.description), 'description: nem üres string (magyar leírás)')
  return errs
}

// Csak a séma-mezőket engedjük tovább a Prismának (ismeretlen kulcs -> hiba lenne).
const SCHEMA_FIELDS = [
  'name', 'latinName', 'category', 'location', 'price', 'salePrice', 'stock', 'light', 'watering',
  'difficulty', 'currentHeightCm', 'maxHeightCm', 'currentPotCm', 'petSafe', 'kidSafe', 'airPurifying',
  'rating', 'reviewsCount', 'description',
]
const pick = (p) => Object.fromEntries(SCHEMA_FIELDS.map((k) => [k, p[k]]))

async function main() {
  const fileArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
  const dryRun = process.argv.includes('--dry-run')
  const rawText = fileArg ? readFileSync(fileArg, 'utf8') : readFileSync(0, 'utf8')

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    console.error('Nem sikerült JSON-t olvasni:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const items = Array.isArray(parsed) ? parsed : parsed.products
  if (!Array.isArray(items)) {
    console.error('A bemenetnek termék-tömbnek (vagy { products: [...] }) kell lennie.')
    process.exit(1)
  }

  // Fail-fast validáció az ÍRÁS előtt: ha bármelyik rekord hibás, egyáltalán ne írjunk DB-be.
  const valid = []
  const errors = []
  items.forEach((item, i) => {
    const issues = validate(item)
    if (issues.length === 0) valid.push(pick(item))
    else errors.push({ index: i, name: item?.name ?? item?.latinName ?? '?', issues })
  })

  if (errors.length > 0) {
    console.error(`Validációs hiba ${errors.length} rekordnál — NEM írok DB-be:`)
    for (const e of errors.slice(0, 20)) console.error(`  [#${e.index}] ${e.name}: ${e.issues.join('; ')}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`DRY-RUN: ${valid.length} rekord érvényes, DB-írás kihagyva.`)
    return
  }

  // Prisma kliens CJS interop-pal, a scripthez relatív útvonalról (cwd-független).
  const { PrismaClient } = require('../../../../packages/db/generated/client/index.js')
  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  try {
    for (const p of valid) {
      const existing = await prisma.product.findFirst({
        where: { latinName: { equals: p.latinName, mode: 'insensitive' } },
      })
      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data: p })
        updated++
      } else {
        await prisma.product.create({ data: p })
        created++
      }
    }
  } catch (err) {
    console.error('DB-hiba upsert közben:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }

  console.log(`Kész: ${created} létrehozva, ${updated} frissítve (összesen ${valid.length}).`)
}

main().catch((err) => { console.error('upsert-products hiba:', err instanceof Error ? err.message : String(err)); process.exit(1) })
