/**
 * 按《国家重点保护野生植物名录》（2021）为植物界物种写入 status
 *
 * 匹配顺序：学名精确 → 属/科“所有种”规则（含除外）→ 中文名兜底
 * 组（sect.）规则因运行时索引无组级字段，不自动扩及全属。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LIST_PATH = path.join(ROOT, 'data', 'protection', 'national-key-wildplants-2021.json')
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
  section?: string
  level: 'Ⅰ' | 'Ⅱ'
  status: string
  match: 'genus' | 'family' | 'section'
  excludeChinese?: string[]
  excludeLatin?: string[]
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
    .replace(/ë/g, 'e')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normZh(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

const LATIN_ALIASES: Record<string, string[]> = {
  'isoetes': ['isoetes'], // Isoëtes → Isoetes via normName
  'christensenia assamica': ['christensenia aesculifolia'],
  'taiwania flousiana': ['taiwania cryptomerioides'],
}

function excludedByRule(
  record: Pick<SpeciesRecord, 'scientificName' | 'chineseName'>,
  rule: TaxonRule,
): boolean {
  const latin = normName(record.scientificName)
  const zh = normZh(record.chineseName || '')
  if (rule.excludeLatin?.some((x) => latin === normName(x) || latin.startsWith(normName(x) + ' '))) {
    return true
  }
  if (rule.excludeChinese?.some((x) => zh === normZh(x))) return true
  return false
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
  const familyRules = list.taxonRules.filter((r) => r.match === 'family')

  return { byLatin, byChinese, genusRules, familyRules }
}

export function resolvePlantStatus(
  record: Pick<
    SpeciesRecord,
    'scientificName' | 'chineseName' | 'family' | 'genus' | 'kingdom'
  >,
  lookup: ReturnType<typeof buildLookup>,
): string | null {
  const isPlant = record.kingdom?.latin === 'Plantae'
  const latinKey = normName(record.scientificName)
  const direct = lookup.byLatin.get(latinKey)
  if (direct) return direct.status

  const parts = latinKey.split(' ')
  if (parts.length >= 3) {
    const binomial = `${parts[0]} ${parts[1]}`
    const parent = lookup.byLatin.get(binomial)
    if (parent) return parent.status
  }

  if (isPlant) {
    for (const rule of lookup.genusRules) {
      if (normName(record.genus.latin) !== normName(rule.genus || '')) continue
      if (excludedByRule(record, rule)) continue
      return rule.status
    }
    for (const rule of lookup.familyRules) {
      if (normName(record.family.latin) !== normName(rule.taxon || '')) continue
      if (excludedByRule(record, rule)) continue
      return rule.status
    }
  }

  const zh = normZh(record.chineseName || '')
  if (zh && lookup.byChinese.has(zh)) return lookup.byChinese.get(zh)!.status

  return null
}

export function loadPlantProtectionLookup() {
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

  const { list, lookup } = loadPlantProtectionLookup()
  const files = fs.readdirSync(SPECIES_DIR).filter((f) => f.endsWith('.json'))

  let plant = 0
  let matched = 0
  let byLatin = 0
  let byGenus = 0
  let byFamily = 0
  let byChinese = 0
  const unmatchedProtect = new Set(list.species.map((s) => s.scientificName))

  for (const file of files) {
    const full = path.join(SPECIES_DIR, file)
    const rows = JSON.parse(fs.readFileSync(full, 'utf8')) as SpeciesRecord[]
    let changed = false

    for (const rec of rows) {
      const isPlant = rec.kingdom?.latin === 'Plantae'
      const isNonAnimal = rec.kingdom?.latin && rec.kingdom.latin !== 'Animalia'
      if (!isNonAnimal) continue
      if (isPlant) plant += 1

      const before = rec.status
      // 植物界：完整规则；其它界（如名录中的真菌）：仅学名/中文精确匹配
      let status: string | null = null
      const latinKey = normName(rec.scientificName)
      const direct = lookup.byLatin.get(latinKey)
      if (direct) {
        status = direct.status
        byLatin += 1
        unmatchedProtect.delete(direct.scientificName)
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

      if (isPlant && !status) {
        for (const rule of lookup.genusRules) {
          if (normName(rec.genus.latin) !== normName(rule.genus || '')) continue
          if (excludedByRule(rec, rule)) continue
          status = rule.status
          byGenus += 1
          break
        }
      }
      if (isPlant && !status) {
        for (const rule of lookup.familyRules) {
          if (normName(rec.family.latin) !== normName(rule.taxon || '')) continue
          if (excludedByRule(rec, rule)) continue
          status = rule.status
          byFamily += 1
          break
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

      if (status) {
        matched += 1
        if (!isPlant) {
          // 计入非植物界命中
        }
      }
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
    protection.plant = {
      list: list.title,
      version: list.version,
      source: list.source,
      sourceUrl: list.sourceUrl,
      appliedAt: new Date().toISOString(),
      matchedSpecies: matched,
      plantSpecies: plant,
    }
    meta.protection = protection
    meta.withPlantProtection = matched
    const animalCount =
      typeof meta.withAnimalProtection === 'number'
        ? (meta.withAnimalProtection as number)
        : typeof (protection as { wildlife?: { matchedSpecies?: number } }).wildlife
              ?.matchedSpecies === 'number'
          ? (protection as { wildlife: { matchedSpecies: number } }).wildlife.matchedSpecies
          : typeof meta.withProtection === 'number'
            ? (meta.withProtection as number)
            : 0
    // 若尚未区分 withAnimalProtection，尽量保留原动物计数
    if (typeof meta.withAnimalProtection !== 'number') {
      const prev = protection as {
        matchedSpecies?: number
        wildlife?: { matchedSpecies?: number }
      }
      if (typeof prev.wildlife?.matchedSpecies === 'number') {
        meta.withAnimalProtection = prev.wildlife.matchedSpecies
      } else if (typeof prev.matchedSpecies === 'number' && !prev.wildlife) {
        // 旧格式：protection 顶层即动物
        meta.withAnimalProtection = prev.matchedSpecies
        protection.wildlife = {
          list: prev.list,
          version: prev.version,
          source: prev.source,
          sourceUrl: prev.sourceUrl,
          appliedAt: prev.appliedAt,
          matchedSpecies: prev.matchedSpecies,
          animalSpecies: prev.animalSpecies,
        }
        delete prev.list
        delete prev.version
        delete prev.source
        delete prev.sourceUrl
        delete prev.appliedAt
        delete prev.matchedSpecies
        delete prev.animalSpecies
      }
    }
    const animal =
      typeof meta.withAnimalProtection === 'number'
        ? (meta.withAnimalProtection as number)
        : animalCount
    meta.withAnimalProtection = animal
    meta.withProtection = animal + matched

    const notes = Array.isArray(meta.notes) ? (meta.notes as string[]) : []
    const note =
      '植物保护等级依据《国家重点保护野生植物名录》（2021）匹配写入 status 字段'
    if (!notes.includes(note)) notes.push(note)
    meta.notes = notes
    fs.writeFileSync(META_PATH, JSON.stringify(meta), 'utf8')
  }

  console.log('《国家重点保护野生植物名录》匹配完成')
  console.log(`  名录物种条目: ${list.species.length}（另有阶元规则 ${list.taxonRules.length}）`)
  console.log(`  库内植物界: ${plant}`)
  console.log(`  已写入保护等级: ${matched}`)
  console.log(`    学名匹配: ${byLatin}`)
  console.log(`    属级规则: ${byGenus}`)
  console.log(`    科级规则: ${byFamily}`)
  console.log(`    中文名兜底: ${byChinese}`)
  console.log(`  名录未命中库内: ${unmatchedProtect.size}`)
  if (unmatchedProtect.size) {
    console.log(
      [...unmatchedProtect]
        .sort()
        .slice(0, 25)
        .join('\n') + (unmatchedProtect.size > 25 ? '\n…' : ''),
    )
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
