/**
 * 处理 GBIF 中国 occurrence SIMPLE_CSV，聚合省级分布与抽样点位。
 *
 * 输入：data/gbif/raw/*.csv（或 *.txt，制表符分隔的 SIMPLE_CSV）
 * 输出：
 *   data/gbif/china-species-summary.json
 *   public/data/gbif-points/{首字母}/{slug}.json（每物种最多 SAMPLE_POINTS 点）
 *
 * 不做分类主干覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeProvince, sortProvinces } from './lib/province-aliases'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data', 'gbif', 'raw')
const SUMMARY_PATH = path.join(ROOT, 'data', 'gbif', 'china-species-summary.json')
const POINTS_DIR = path.join(ROOT, 'public', 'data', 'gbif-points')
const SAMPLE_POINTS = 200

interface Agg {
  scientificName: string
  count: number
  provinces: Set<string>
  points: { lat: number; lng: number; key?: string }[]
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

function binomial(scientificName: string, speciesCol: string): string | null {
  const fromSpecies = (speciesCol || '').trim()
  if (fromSpecies && /^[A-Z][a-z]+ [a-z-]+/.test(fromSpecies)) return fromSpecies
  const parts = (scientificName || '').trim().split(/\s+/)
  if (parts.length >= 2 && /^[A-Za-z]/.test(parts[0]) && /^[a-z-]/.test(parts[1])) {
    return `${parts[0]} ${parts[1]}`
  }
  return null
}

function slugify(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function findCsvFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(csv|tsv|txt)$/i.test(f))
    .map((f) => path.join(dir, f))
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) || []).length
  const commas = (headerLine.match(/,/g) || []).length
  return tabs >= commas ? '\t' : ','
}

function parseLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t')
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQ = !inQ
    } else if (c === delim && !inQ) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

async function processFile(file: string, map: Map<string, Agg>) {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let header: string[] | null = null
  let delim = '\t'
  let idx: Record<string, number> = {}
  let n = 0

  for await (const line of rl) {
    if (!line) continue
    if (!header) {
      delim = detectDelimiter(line)
      header = parseLine(line, delim).map((h) => h.replace(/^\uFEFF/, '').trim())
      idx = Object.fromEntries(header.map((h, i) => [h, i]))
      continue
    }
    const cols = parseLine(line, delim)
    const get = (k: string) => cols[idx[k]] ?? ''
    const name = binomial(get('scientificName'), get('species'))
    if (!name) continue
    const lat = Number(get('decimalLatitude'))
    const lng = Number(get('decimalLongitude'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lat < 3 || lat > 55 || lng < 70 || lng > 140) continue

    const key = normName(name)
    let agg = map.get(key)
    if (!agg) {
      agg = { scientificName: name, count: 0, provinces: new Set(), points: [] }
      map.set(key, agg)
    }
    agg.count += 1
    const prov = normalizeProvince(get('stateProvince'))
    if (prov) agg.provinces.add(prov)
    if (agg.points.length < SAMPLE_POINTS) {
      agg.points.push({ lat, lng, key: get('gbifID') || undefined })
    }
    n += 1
    if (n % 500000 === 0) console.log(`  …已读 ${n.toLocaleString()} 行 @ ${path.basename(file)}`)
  }
  console.log(`  ${path.basename(file)}: ${n.toLocaleString()} 条有效坐标`)
}

async function main() {
  const files = findCsvFiles(RAW_DIR)
  if (!files.length) {
    console.error(`未找到 CSV：${RAW_DIR}\n请将 GBIF SIMPLE_CSV 解压到此目录后重试。`)
    process.exit(1)
  }

  const map = new Map<string, Agg>()
  for (const f of files) {
    console.log('处理', f)
    await processFile(f, map)
  }

  const species = [...map.values()]
    .map((a) => ({
      scientificName: a.scientificName,
      occurrenceCount: a.count,
      provinces: sortProvinces(a.provinces),
      samplePoints: a.points,
    }))
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName))

  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true })
  const summary = {
    title: 'GBIF 中国区域 occurrence 子集汇总',
    filter: 'country=CN, hasCoordinate=true, hasGeospatialIssue=false',
    role: '辅助分布与地图；非主分类',
    source: 'GBIF',
    sourceUrl: 'https://www.gbif.org',
    compiledAt: new Date().toISOString(),
    speciesCount: species.length,
    species: species.map(({ scientificName, occurrenceCount, provinces }) => ({
      scientificName,
      occurrenceCount,
      provinces,
    })),
  }
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary))
  console.log(`写入 ${SUMMARY_PATH}（${species.length} 种）`)

  if (fs.existsSync(POINTS_DIR)) fs.rmSync(POINTS_DIR, { recursive: true })
  fs.mkdirSync(POINTS_DIR, { recursive: true })
  let written = 0
  for (const s of species) {
    if (!s.samplePoints.length) continue
    const slug = slugify(s.scientificName)
    const bucket = slug[0] || '_'
    const dir = path.join(POINTS_DIR, bucket)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, `${slug}.json`),
      JSON.stringify({
        scientificName: s.scientificName,
        count: s.occurrenceCount,
        provinces: s.provinces,
        points: s.samplePoints,
        source: 'GBIF',
        sourceUrl: 'https://www.gbif.org',
      }),
    )
    written += 1
  }
  console.log(`写入抽样点位 ${written} 个文件 → ${POINTS_DIR}`)
  console.log('下一步：npm run apply:gbif')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
