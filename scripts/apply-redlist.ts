/**
 * 按《中国生物多样性红色名录》（2020）写入 redList / redListCategory（物种详情 JSON）
 * - 动物：脊椎动物卷
 * - 植物：高等植物卷
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { forEachSkeleton, patchDetail, updateMeta } from './lib/species-detail-io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ANIMAL_LIST = path.join(ROOT, 'data', 'protection', 'china-redlist-vertebrates-2020.json')
const PLANT_LIST = path.join(ROOT, 'data', 'protection', 'china-redlist-plants-2020.json')

interface RedListSpecies {
  scientificName: string
  chineseName: string
  category: string
  label: string
}

interface RedListFile {
  title: string
  shortTitle: string
  version: string
  source: string
  sourceUrl: string
  species: RedListSpecies[]
}

interface SpeciesRecord {
  scientificName: string
  chineseName: string
  kingdom: { latin: string; chinese: string }
  redListCategory?: string | null
  redList?: string | null
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

function buildLookup(list: RedListFile) {
  const byLatin = new Map<string, RedListSpecies>()
  const byChinese = new Map<string, RedListSpecies>()
  for (const s of list.species) {
    byLatin.set(normName(s.scientificName), s)
    const zh = normZh(s.chineseName || '')
    if (zh) byChinese.set(zh, s)
  }
  return { byLatin, byChinese }
}

export function resolveRedList(
  record: Pick<SpeciesRecord, 'scientificName' | 'chineseName' | 'kingdom'>,
  animalLookup: ReturnType<typeof buildLookup>,
  plantLookup: ReturnType<typeof buildLookup>,
): { category: string; label: string } | null {
  const kingdom = record.kingdom?.latin
  const lookup = kingdom === 'Plantae' ? plantLookup : kingdom === 'Animalia' ? animalLookup : null
  if (!lookup) return null

  const latinKey = normName(record.scientificName)
  let hit = lookup.byLatin.get(latinKey)
  if (!hit) {
    const parts = latinKey.split(' ')
    if (parts.length >= 3) hit = lookup.byLatin.get(`${parts[0]} ${parts[1]}`)
  }
  if (!hit) {
    const zh = normZh(record.chineseName || '')
    if (zh) hit = lookup.byChinese.get(zh)
  }
  return hit ? { category: hit.category, label: hit.label } : null
}

export function loadRedListLookups() {
  const animalList = JSON.parse(fs.readFileSync(ANIMAL_LIST, 'utf8')) as RedListFile
  const plantList = JSON.parse(fs.readFileSync(PLANT_LIST, 'utf8')) as RedListFile
  return {
    animalList,
    plantList,
    animalLookup: buildLookup(animalList),
    plantLookup: buildLookup(plantList),
  }
}

function main() {
  for (const p of [ANIMAL_LIST, PLANT_LIST]) {
    if (!fs.existsSync(p)) {
      console.error(`缺少名录：${p}（先运行 npm run build:redlist）`)
      process.exit(1)
    }
  }

  const { animalList, plantList, animalLookup, plantLookup } = loadRedListLookups()

  let animalMatched = 0
  let plantMatched = 0
  let animalTotal = 0
  let plantTotal = 0
  let written = 0
  const byCat: Record<string, number> = {}

  try {
    forEachSkeleton((rec) => {
      if (rec.kingdom?.latin === 'Animalia') animalTotal += 1
      if (rec.kingdom?.latin === 'Plantae') plantTotal += 1

      const hit = resolveRedList(rec, animalLookup, plantLookup)
      const nextCat = hit?.category ?? null
      const nextLabel = hit?.label ?? null

      if (hit) {
        byCat[hit.category] = (byCat[hit.category] || 0) + 1
        if (rec.kingdom.latin === 'Animalia') animalMatched += 1
        else if (rec.kingdom.latin === 'Plantae') plantMatched += 1
      }

      if (
        patchDetail(
          rec,
          { redListCategory: nextCat, redList: nextLabel },
          { createIfMissing: !!hit },
        )
      ) {
        written += 1
      }
    })
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }

  updateMeta((meta) => {
    meta.withRedList = animalMatched + plantMatched
    meta.withAnimalRedList = animalMatched
    meta.withPlantRedList = plantMatched
    meta.redList = {
      animal: {
        list: animalList.title,
        version: animalList.version,
        source: animalList.source,
        sourceUrl: animalList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: animalMatched,
        listSpecies: animalList.species.length,
        kingdomSpecies: animalTotal,
        target: 'species-detail-json',
      },
      plant: {
        list: plantList.title,
        version: plantList.version,
        source: plantList.source,
        sourceUrl: plantList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: plantMatched,
        listSpecies: plantList.species.length,
        kingdomSpecies: plantTotal,
        target: 'species-detail-json',
      },
    }
    const notes = Array.isArray(meta.notes) ? (meta.notes as string[]) : []
    const note = '动植物红色名录等级依据《中国生物多样性红色名录》（2020）写入物种详情'
    if (!notes.includes(note)) notes.push(note)
    meta.notes = notes
  })

  console.log('《中国生物多样性红色名录》匹配完成（写入物种详情 JSON）')
  console.log(`  脊椎动物卷条目: ${animalList.species.length} → 库内命中 ${animalMatched} / 动物 ${animalTotal}`)
  console.log(`  高等植物卷条目: ${plantList.species.length} → 库内命中 ${plantMatched} / 植物 ${plantTotal}`)
  console.log(`  详情文件更新: ${written}`)
  console.log('  等级分布:', byCat)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
