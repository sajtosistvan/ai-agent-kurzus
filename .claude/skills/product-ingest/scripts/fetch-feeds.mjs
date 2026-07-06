#!/usr/bin/env node
// Plantbase termék-ingest — DETERMINISZTIKUS 1. fázis.
// Letölti a Shopify products.json feedeket, kiszűri a nem-növényeket, kinyeri a
// biztonságosan kinyerhető mezőket (latin név, ár HUF-ra váltva, cserépméret, magasság),
// dedupál latin név szerint, és egy "candidate" tömböt ír stdout-ra (JSON).
//
// A nyelvi + gondozási enrichment (magyar név/leírás, fény/öntözés/nehézség/pet_safe...)
// NEM itt történik: azt a SKILL.md szerint az LLM tölti ki a candidate.bodyHtml + tags alapján.
//
// Használat:  node fetch-feeds.mjs > candidates.json
// Csak beépített Node modulokat használ (fetch globális Node 18+ alatt).

const SOURCES = [
  { domain: 'thesill.com', currency: 'USD', latinFrom: 'botanical-tag' },
  { domain: 'tropicalhome.hu', currency: 'HUF', latinFrom: 'title' },
]

// A felhasználó által megadott fix árfolyamok. HUF = 1 (nincs váltás).
const FX_TO_HUF = { HUF: 1, USD: 310, EUR: 350 }

// product_type szűrő: csak élő növény. A többit (kaspó, szerszám, föld, műnövény) kihagyjuk.
const NON_PLANT_TYPES = new Set([
  'accessory', 'accessories', 'planter', 'consumable', 'faux', 'soil', 'tool', 'tools', 'care', '',
])
const FT_TO_CM = 30.48

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Egy oldal letöltése átmeneti hibára retry-jal (hálózati flakiness / rate limit ellen).
async function fetchPage(url, attempt = 1) {
  const MAX = 4
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 plantbase-ingest' } })
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    if (attempt >= MAX) throw err
    await sleep(500 * 2 ** (attempt - 1)) // 0.5s, 1s, 2s backoff
    return fetchPage(url, attempt + 1)
  }
}

async function fetchAllProducts(domain) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const url = `https://${domain}/products.json?limit=250&page=${page}`
    const { products } = await fetchPage(url)
    if (!products || products.length === 0) break
    all.push(...products)
    if (products.length < 250) break
  }
  return all
}

const tagList = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')).map((t) => t.trim())

// Latin (botanikai) név kinyerése forrásonként. null, ha nem meghatározható -> később skip.
function extractLatin(source, p) {
  if (source.latinFrom === 'botanical-tag') {
    const tag = tagList(p).find((t) => /^botanical name\s*:/i.test(t))
    if (!tag) return null
    return tag.split(':').slice(1).join(':').trim() || null
  }
  // title-alapú (tropicalhome): a cím maga a latin név, a cserépméret-suffixet levágjuk.
  return p.title
    .replace(/\s*[-–]\s*\d+([.,]\d+)?\s*cm.*$/i, '')
    .replace(/\s+\d+([.,]\d+)?\s*cm\b/gi, '')
    .trim() || null
}

// Dedup-kulcs: kisbetűs, a KULTIVÁR SZAVAKAT megtartjuk (csak az idézőjel-karaktereket és a
// méret-tokeneket vesszük ki), így "Citrus x meyeri Improved" ≠ "Citrus limon Harvey", de a
// két boltban azonos faj+kultivár (pl. "Epipremnum aureum Global green") egy kulcsra esik.
// Cél: "1 termék csak egyszer", DE a valóban eltérő kultivárokat NE olvasszuk össze.
function dedupKey(latin) {
  return latin
    .toLowerCase()
    .replace(/["'“”‘’]/g, ' ') // csak az idézőjel-karakterek — a kultivár szó marad
    .replace(/\b\d+([.,]\d+)?\s*cm\b/g, ' ')
    .replace(/[^a-zàáâäãåæçèéêëìíîïñòóôöõùúûü\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const parsePotCm = (p) => {
  const m = tagList(p).map((t) => t.match(/(\d+([.,]\d+)?)\s*cm/i)).find(Boolean)
  return m ? Math.round(parseFloat(m[1].replace(',', '.'))) : null
}

// thesill "Mature Height Value: 8 ft." / "... 90 cm" -> max magasság cm.
function parseMaxHeightCm(p) {
  const tag = tagList(p).find((t) => /mature height/i.test(t))
  if (!tag) return null
  const ft = tag.match(/(\d+([.,]\d+)?)\s*ft/i)
  if (ft) return Math.round(parseFloat(ft[1].replace(',', '.')) * FT_TO_CM)
  const cm = tag.match(/(\d+([.,]\d+)?)\s*cm/i)
  return cm ? Math.round(parseFloat(cm[1].replace(',', '.'))) : null
}

function toHuf(amount, currency) {
  const rate = FX_TO_HUF[currency]
  if (rate == null) throw new Error(`Ismeretlen pénznem: ${currency}`)
  return Math.round(parseFloat(amount) * rate)
}

function toCandidate(source, p) {
  const latin = extractLatin(source, p)
  const v = p.variants?.[0] ?? {}
  const price = v.price != null ? toHuf(v.price, source.currency) : null
  // Shopify: compare_at_price a (magasabb) eredeti ár. Ha van és > price -> akció.
  const compareAt = v.compare_at_price != null ? toHuf(v.compare_at_price, source.currency) : null
  const onSale = compareAt != null && price != null && compareAt > price
  return {
    source: source.domain,
    handle: p.handle,
    url: `https://${source.domain}/products/${p.handle}`,
    rawTitle: p.title,
    latinName: latin,
    dedupKey: latin ? dedupKey(latin) : null,
    productType: p.productType ?? p.product_type ?? '',
    tags: tagList(p).filter((t) => !/^rs_[a-z]{2}$/i.test(t)), // szállítási-zóna zaj kiszűrve
    bodyHtml: (p.body_html ?? '').slice(0, 2000),
    image: p.images?.[0]?.src ?? null,
    // Ár (HUF): a séma price = eredeti (regular), sale_price = akciós (null ha nincs akció).
    priceHuf: onSale ? compareAt : price,
    salePriceHuf: onSale ? price : null,
    currentPotCm: parsePotCm(p),
    maxHeightCm: parseMaxHeightCm(p),
    available: Boolean(v.available),
    sourceCurrency: source.currency,
    sources: [source.domain], // dedupnál bővül, ha több boltban is szerepel
  }
}

// Ütközésnél a "gazdagabb"/elérhető rekordot tartjuk meg.
function score(c) {
  return (c.available ? 4 : 0) + (c.maxHeightCm ? 1 : 0) + (c.currentPotCm ? 1 : 0) + (c.bodyHtml ? 1 : 0)
}

async function main() {
  const raw = []
  for (const source of SOURCES) {
    const products = await fetchAllProducts(source.domain)
    for (const p of products) {
      const type = String(p.product_type ?? '').toLowerCase().trim()
      if (NON_PLANT_TYPES.has(type)) continue // nem-növény kihagyva
      raw.push(toCandidate(source, p))
    }
  }

  // Dedup latin név szerint (1 termék csak egyszer). A latin nélkülieket megtartjuk a
  // riporthoz "skip" jelöléssel — az LLM-fázis dönt róluk (rendszerint kihagyja).
  const byKey = new Map()
  const skipped = []
  for (const c of raw) {
    if (!c.dedupKey) { skipped.push({ ...c, skipReason: 'nincs latin név' }); continue }
    const prev = byKey.get(c.dedupKey)
    if (!prev) { c.sources = [c.source]; byKey.set(c.dedupKey, c); continue }
    const winner = score(c) > score(prev) ? c : prev
    winner.sources = [...new Set([...(prev.sources ?? [prev.source]), c.source])]
    byKey.set(c.dedupKey, winner)
  }

  // Opcionális --limit N: a candidate-lista levágása teszt-/dry-run futáshoz.
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : null
  const candidates = [...byKey.values()]
  const out = limit != null && Number.isFinite(limit) ? candidates.slice(0, limit) : candidates

  process.stdout.write(JSON.stringify({
    generatedAtNote: 'árfolyam: USD=310, EUR=350, HUF=1 (fix)',
    candidates: out,
    skippedNoLatin: skipped,
    stats: { unique: byKey.size, emitted: out.length, skippedNoLatin: skipped.length, rawPlants: raw.length },
  }, null, 2))
}

main().catch((err) => { console.error('fetch-feeds hiba:', err.message); process.exit(1) })
