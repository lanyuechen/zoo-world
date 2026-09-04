/**
 * 将 GBIF 中国子集汇总的省级分布合并进物种 distribution（不改分类主干）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sortProvinces } from './lib/province-aliases'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SUMMARY = path.join(ROOT, 'data', 'gbif', 'china-species-summary.json')
const SPECIES_DIR = path.join(ROOT, 'public', 'data', 'species')
const META_PATH = path.join(ROOT, 'public', 'data', 'meta.json')

interface SummarySpecies {
  scientificName: string
  occurrenceCount: number
  provinces: string[]
}

interface SummaryFile {
  title: string
  filter: string
  source: string
  sourceUrl: string
  compiledAt: string
  species: SummarySpecies[]
}

interface SpeciesRecord {
  scientificName: string
  distribution: string[]
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

function main() {
  if (!fs.existsSync(SUMMARY)) {
    console.error(`缺少 ${SUMMARY}，先运行 npm run gbif:process`)
    process.exit(1)
  }
  const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8')) as SummaryFile
  const byLatin = new Map<string, SummarySpecies>()
  for (const s of summary.species) {
    byLatin.set(normName(s.scientificName), s)
  }

  let matched = 0
  let updated = 0
  let withDist = 0

  for (const file of fs.readdirSync(SPECIES_DIR).filter((f) => f.endsWith('.json'))) {
    const fp = path.join(SPECIES_DIR, file)
    const list = JSON.parse(fs.readFileSync(fp, 'utf8')) as SpeciesRecord[]
    let dirty = false
    for (const rec of list) {
      const hit = byLatin.get(normName(rec.scientificName))
      if (!hit || !hit.provinces.length) {
        if (rec.distribution?.length) withDist += 1
        continue
      }
      matched += 1
      const merged = sortProvinces([...(rec.distribution || []), ...hit.provinces])
      if (merged.join('|') !== (rec.distribution || []).join('|')) {
        rec.distribution = merged
        dirty = true
        updated += 1
      }
      if (rec.distribution.length) withDist += 1
    }
    if (dirty) fs.writeFileSync(fp, JSON.stringify(list))
  }

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
    meta.withDistribution = withDist
    meta.gbif = {
      list: summary.title,
      filter: summary.filter,
      source: summary.source,
      sourceUrl: summary.sourceUrl,
      appliedAt: new Date().toISOString(),
      summaryCompiledAt: summary.compiledAt,
      matchedSpecies: matched,
      updatedSpecies: updated,
      listSpecies: summary.species.length,
      role: '辅助分布与地图；非主分类',
    }
    fs.writeFileSync(META_PATH, JSON.stringify(meta))
  }

  console.log('GBIF 分布合并完成')
  console.log(`  汇总物种: ${summary.species.length}`)
  console.log(`  库内命中: ${matched}（更新 ${updated}）`)
  console.log(`  现有分布: ${withDist}`)
}

main()
