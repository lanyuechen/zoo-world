/**
 * 按《国家重点保护野生动物名录》（2021）为动物界物种写入 status
 *
 * 匹配顺序：学名精确 → 属级规则 → 目/科“所有种”规则 → 中文名兜底
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LIST_PATH = path.join(ROOT, 'data', 'protection', 'national-key-wildlife-2021.json')
const SPECIES_DIR = path.join(ROOT, 'public', 'data', 'species')
const META_PATH = path.join(ROOT, 'public', 'data', 'meta.json')

interface ProtectSpecies {
  chineseName: string
  scientificName: string
  level: 'Ⅰ' | 'Ⅱ'
  status: string
  note?: string
}

interface TaxonRule {
  chineseName: string
  genus?: string
  taxon?: string
  rank?: string
  level: 'Ⅰ' | 'Ⅱ'
  status: string
  match: 'genus' | 'order' | 'family'
  note?: string
}

interface ProtectList {
  title: string
  version: string
  source: string
  sourceUrl: string
  species: ProtectSpecies[]
  taxonRules: TaxonRule[]
}

interface SpeciesRecord {
  scientificName: string
  chineseName: string
  kingdom: { latin: string; chinese: string }
  phylum: { latin: string; chinese: string }
  class: { latin: string; chinese: string }
  order: { latin: string; chinese: string }
  family: { latin: string; chinese: string }
  genus: { latin: string; chinese: string }
  status: string | null
  [key: string]: unknown
}

function normName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normZh(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

/** 常见学名拼写 / 异名差异（名录 ↔ Species 2000） */
const LATIN_ALIASES: Record<string, string[]> = {
  'baleanoptera musculus': ['balaenoptera musculus'],
  'baleanoptera acutorostrata': ['balaenoptera acutorostrata'],
  'baleanoptera borealis': ['balaenoptera borealis'],
  'baleanoptera edeni': ['balaenoptera edeni'],
  'baleanoptera omurai': ['balaenoptera omurai'],
  'baleanoptera physalus': ['balaenoptera physalus'],
  'baleanoptera novaeangliae': ['balaenoptera novaeangliae'],
  'lutrongale perspicillata': ['lutrogale perspicillata'],
  'eumetonpias jubatus': ['eumetopias jubatus'],
  'nyctereutes procyonides': ['nyctereutes procyonoides'],
  'arctogalidia trivigata': ['arctogalidia trivirgata'],
  'anthropoides virgo': ['grus virgo'],
  'budorcas tibetanus': ['budorcas tibetana'],
}

function buildLookup(list: ProtectList) {
  const byLatin = new Map<string, ProtectSpecies>()
  const byChinese = new Map<string, ProtectSpecies>()

  for (const s of list.species) {
    const key = normName(s.scientificName)
    if (!byLatin.has(key) || s.level === 'Ⅰ') byLatin.set(key, s)
    for (const alias of LATIN_ALIASES[key] || []) {
      if (!byLatin.has(alias) || s.level === 'Ⅰ') byLatin.set(alias, s)
    }
    const zh = normZh(s.chineseName)
    if (zh && (!byChinese.has(zh) || s.level === 'Ⅰ')) byChinese.set(zh, s)
  }

  const genusRules = list.taxonRules.filter((r) => r.match === 'genus')
  const orderRules = list.taxonRules.filter((r) => r.match === 'order')
  const familyRules = list.taxonRules.filter((r) => r.match === 'family')

  return { byLatin, byChinese, genusRules, orderRules, familyRules }
}

export function resolveAnimalStatus(
  record: Pick<
    SpeciesRecord,
    'scientificName' | 'chineseName' | 'order' | 'family' | 'genus'
  >,
  lookup: ReturnType<typeof buildLookup>,
): string | null {
  const latinKey = normName(record.scientificName)
  const direct = lookup.byLatin.get(latinKey)
  if (direct) return direct.status

  // 亚种：用种本名再试（binomial 前两词）
  const parts = latinKey.split(' ')
  if (parts.length >= 3) {
    const binomial = `${parts[0]} ${parts[1]}`
    const parent = lookup.byLatin.get(binomial)
    if (parent) return parent.status
  }

  for (const rule of lookup.genusRules) {
    if (normName(record.genus.latin) === normName(rule.genus || '')) return rule.status
  }
  for (const rule of lookup.familyRules) {
    if (normName(record.family.latin) === normName(rule.taxon || '')) return rule.status
  }
  for (const rule of lookup.orderRules) {
    if (normName(record.order.latin) === normName(rule.taxon || '')) return rule.status
  }

  const zh = normZh(record.chineseName || '')
  if (zh && lookup.byChinese.has(zh)) return lookup.byChinese.get(zh)!.status

  return null
}

export function loadProtectionLookup() {
  const list = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8')) as ProtectList
  return { list, lookup: buildLookup(list) }
}

function main() {
  if (!fs.existsSync(LIST_PATH)) {
    console.error(`缺少名录文件：${LIST_PATH}`)
    process.exit(1)
  }
  if (!fs.existsSync(SPECIES_DIR)) {
    console.error(`缺少物种分片：请先 npm run import:excel:index-only`)
    process.exit(1)
  }

  const { list, lookup } = loadProtectionLookup()
  const files = fs.readdirSync(SPECIES_DIR).filter((f) => f.endsWith('.json'))

  let animal = 0
  let matched = 0
  let byLatin = 0
  let byGenus = 0
  let byHigher = 0
  let byChinese = 0
  const unmatchedProtect = new Set(list.species.map((s) => s.scientificName))

  for (const file of files) {
    const full = path.join(SPECIES_DIR, file)
    const rows = JSON.parse(fs.readFileSync(full, 'utf8')) as SpeciesRecord[]
    let changed = false

    for (const rec of rows) {
      if (rec.kingdom?.latin !== 'Animalia') continue
      animal += 1

      const before = rec.status
      // 先清掉旧保护等级，再按名录重写（避免残留）
      let status: string | null = null
      const latinKey = normName(rec.scientificName)
      const direct = lookup.byLatin.get(latinKey)
      if (direct) {
        status = direct.status
        byLatin += 1
        unmatchedProtect.delete(direct.scientificName)
        // also clear aliases
        for (const [k, v] of lookup.byLatin) {
          if (v.scientificName === direct.scientificName) unmatchedProtect.delete(v.scientificName)
        }
      } else {
        const parts = latinKey.split(' ')
        if (parts.length >= 3) {
          const parent = lookup.byLatin.get(`${parts[0]} ${parts[1]}`)
          if (parent) {
            status = parent.status
            byLatin += 1
            unmatchedProtect.delete(parent.scientificName)
          }
        }
      }

      if (!status) {
        for (const rule of lookup.genusRules) {
          if (normName(rec.genus.latin) === normName(rule.genus || '')) {
            status = rule.status
            byGenus += 1
            break
          }
        }
      }
      if (!status) {
        for (const rule of lookup.familyRules) {
          if (normName(rec.family.latin) === normName(rule.taxon || '')) {
            status = rule.status
            byHigher += 1
            break
          }
        }
      }
      if (!status) {
        for (const rule of lookup.orderRules) {
          if (normName(rec.order.latin) === normName(rule.taxon || '')) {
            status = rule.status
            byHigher += 1
            break
          }
        }
      }
      if (!status) {
        const zh = normZh(rec.chineseName || '')
        if (zh && lookup.byChinese.has(zh)) {
          status = lookup.byChinese.get(zh)!.status
          byChinese += 1
          unmatchedProtect.delete(lookup.byChinese.get(zh)!.scientificName)
        }
      }

      if (status) matched += 1
      if (before !== status) {
        rec.status = status
        changed = true
      }
    }

    if (changed) fs.writeFileSync(full, JSON.stringify(rows), 'utf8')
  }

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
    const protection =
      meta.protection && typeof meta.protection === 'object'
        ? (meta.protection as Record<string, unknown>)
        : {}
    protection.wildlife = {
      list: list.title,
      version: list.version,
      source: list.source,
      sourceUrl: list.sourceUrl,
      appliedAt: new Date().toISOString(),
      matchedSpecies: matched,
      animalSpecies: animal,
    }
    meta.protection = protection
    meta.withAnimalProtection = matched
    const plantCount =
      typeof meta.withPlantProtection === 'number'
        ? (meta.withPlantProtection as number)
        : typeof (protection.plant as { matchedSpecies?: number } | undefined)?.matchedSpecies ===
            'number'
          ? (protection.plant as { matchedSpecies: number }).matchedSpecies
          : 0
    meta.withPlantProtection = plantCount
    meta.withProtection = matched + plantCount
    const notes = Array.isArray(meta.notes) ? (meta.notes as string[]) : []
    const note =
      '动物保护等级依据《国家重点保护野生动物名录》（2021）匹配写入 status 字段'
    if (!notes.includes(note)) notes.push(note)
    meta.notes = notes
    fs.writeFileSync(META_PATH, JSON.stringify(meta), 'utf8')
  }

  console.log('《国家重点保护野生动物名录》匹配完成')
  console.log(`  名录物种条目: ${list.species.length}（另有阶元规则 ${list.taxonRules.length}）`)
  console.log(`  库内动物界: ${animal}`)
  console.log(`  已写入保护等级: ${matched}`)
  console.log(`    学名匹配: ${byLatin}`)
  console.log(`    属级规则: ${byGenus}`)
  console.log(`    目/科规则: ${byHigher}`)
  console.log(`    中文名兜底: ${byChinese}`)
  console.log(`  名录未命中库内: ${unmatchedProtect.size}`)
  if (unmatchedProtect.size && unmatchedProtect.size <= 40) {
    console.log([...unmatchedProtect].sort().join('\n'))
  } else if (unmatchedProtect.size) {
    console.log([...unmatchedProtect].sort().slice(0, 30).join('\n') + '\n…')
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
