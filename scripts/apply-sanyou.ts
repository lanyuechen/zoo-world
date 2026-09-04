/**
 * 按《有重要生态、科学、社会价值的陆生野生动物名录》（2023）为动物写入三有标签
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LIST_PATH = path.join(ROOT, 'data', 'protection', 'sanyou-wildlife-2023.json')
const SPECIES_DIR = path.join(ROOT, 'public', 'data', 'species')
const META_PATH = path.join(ROOT, 'public', 'data', 'meta.json')

const TAG = '三有'

interface SanyouSpecies {
  chineseName: string
  scientificName: string
  note?: string
}

interface SanyouList {
  title: string
  shortTitle: string
  version: string
  source: string
  sourceUrl: string
  species: SanyouSpecies[]
}

interface SpeciesRecord {
  scientificName: string
  chineseName: string
  kingdom: { latin: string; chinese: string }
  tags?: string[]
  sanyou?: boolean | null
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

function buildLookup(list: SanyouList) {
  const byLatin = new Map<string, SanyouSpecies>()
  const byChinese = new Map<string, SanyouSpecies>()
  for (const s of list.species) {
    byLatin.set(normName(s.scientificName), s)
    const zh = normZh(s.chineseName)
    if (zh) byChinese.set(zh, s)
    if (s.note) {
      for (const am of s.note.matchAll(/(?:原拉丁学名|原名)\s*([A-Z][a-z]+(?:\s+[a-z.-]+)+)/g)) {
        byLatin.set(normName(am[1]), s)
      }
    }
  }
  return { byLatin, byChinese }
}

export function resolveSanyou(
  record: Pick<SpeciesRecord, 'scientificName' | 'chineseName' | 'kingdom'>,
  lookup: ReturnType<typeof buildLookup>,
): boolean | null {
  if (record.kingdom?.latin !== 'Animalia') return null
  const latinKey = normName(record.scientificName)
  if (lookup.byLatin.has(latinKey)) return true
  const parts = latinKey.split(' ')
  if (parts.length >= 3 && lookup.byLatin.has(`${parts[0]} ${parts[1]}`)) return true
  const zh = normZh(record.chineseName || '')
  if (zh && lookup.byChinese.has(zh)) return true
  return false
}

export function applySanyouTags(
  record: SpeciesRecord,
  lookup: ReturnType<typeof buildLookup>,
): { sanyou: boolean | null; tags: string[] } {
  const sanyou = resolveSanyou(record, lookup)
  const tags = [...(record.tags || [])].filter((t) => t !== TAG)
  if (sanyou) tags.push(TAG)
  return { sanyou, tags }
}

export function loadSanyouLookup() {
  const list = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8')) as SanyouList
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

  const { list, lookup } = loadSanyouLookup()
  const files = fs.readdirSync(SPECIES_DIR).filter((f) => f.endsWith('.json'))

  let animal = 0
  let matched = 0
  let byLatin = 0
  let byChinese = 0
  const unmatched = new Set(list.species.map((s) => s.scientificName))

  for (const file of files) {
    const full = path.join(SPECIES_DIR, file)
    const rows = JSON.parse(fs.readFileSync(full, 'utf8')) as SpeciesRecord[]
    let changed = false

    for (const rec of rows) {
      const beforeSanyou = rec.sanyou
      const beforeTags = JSON.stringify(rec.tags || [])
      const { sanyou, tags } = applySanyouTags(rec, lookup)
      rec.sanyou = sanyou
      rec.tags = tags

      if (rec.kingdom?.latin === 'Animalia') {
        animal += 1
        if (sanyou) {
          matched += 1
          const latinKey = normName(rec.scientificName)
          const hit =
            lookup.byLatin.get(latinKey) ||
            (latinKey.split(' ').length >= 3
              ? lookup.byLatin.get(latinKey.split(' ').slice(0, 2).join(' '))
              : undefined) ||
            lookup.byChinese.get(normZh(rec.chineseName || ''))
          if (hit) {
            unmatched.delete(hit.scientificName)
            if (lookup.byLatin.has(latinKey) || latinKey.split(' ').length >= 3) byLatin += 1
            else byChinese += 1
          }
        }
      }

      if (beforeSanyou !== sanyou || beforeTags !== JSON.stringify(tags)) changed = true
    }

    if (changed) fs.writeFileSync(full, JSON.stringify(rows), 'utf8')
  }

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
    meta.withSanyou = matched
    meta.sanyou = {
      list: list.title,
      shortTitle: list.shortTitle,
      version: list.version,
      source: list.source,
      sourceUrl: list.sourceUrl,
      appliedAt: new Date().toISOString(),
      matchedSpecies: matched,
      animalSpecies: animal,
      listSpecies: list.species.length,
    }
    const notes = Array.isArray(meta.notes) ? (meta.notes as string[]) : []
    const note = '动物「三有」标签依据《有重要生态、科学、社会价值的陆生野生动物名录》（2023）匹配'
    if (!notes.includes(note)) notes.push(note)
    meta.notes = notes
    fs.writeFileSync(META_PATH, JSON.stringify(meta), 'utf8')
  }

  console.log('《三有名录》匹配完成')
  console.log(`  名录物种: ${list.species.length}`)
  console.log(`  库内动物界: ${animal}`)
  console.log(`  已标记三有: ${matched}`)
  console.log(`    学名匹配约: ${byLatin}`)
  console.log(`    中文名兜底约: ${byChinese}`)
  console.log(`  名录未命中库内: ${unmatched.size}`)
  if (unmatched.size) {
    console.log(
      [...unmatched]
        .sort()
        .slice(0, 20)
        .join('\n') + (unmatched.size > 20 ? '\n…' : ''),
    )
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
