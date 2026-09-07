/**
 * 从 GBIF 中国 occurrence 直接回填物种详情 locations / provinces（无中间文件）。
 *
 * 准备：将 GBIF SIMPLE_CSV 解压到 data/gbif/raw/
 * （可选先申请下载）
 *
 *   GBIF_USER=... GBIF_PASSWORD=... GBIF_EMAIL=... npm run enrich:gbif -- --request
 *   npm run enrich:gbif
 *   npm run enrich:gbif -- --name="Chrysolophus pictus"   # 单种：Occurrence API，无需 CSV
 *
 * 写完后：npm run species:publish
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeProvince, sortProvinces } from './lib/province-aliases'
import {
  forEachSkeleton,
  loadDetail,
  patchDetail,
  resolveJsonPath,
  updateMeta,
  type SkeletonSpecies,
} from './lib/species-detail-io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data', 'gbif', 'raw')
const OUT_DIR = path.join(ROOT, 'data', 'gbif')
const PROVINCE_INDEX = path.join(ROOT, 'public', 'data', 'province-index.json')
const SAMPLE_POINTS = 200

const args = process.argv.slice(2)
const DO_REQUEST = args.includes('--request')
const ONLY_NAME = args.find((a) => a.startsWith('--name='))?.slice('--name='.length) || ''

interface Agg {
  scientificName: string
  count: number
  provinces: Set<string>
  points: { lat: number; lng: number; key?: string | number; year?: number | null }[]
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

function isChinaPoint(lat: number, lng: number): boolean {
  return lat >= 3 && lat <= 55 && lng >= 70 && lng <= 140
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

async function requestDownload() {
  const user = process.env.GBIF_USER || ''
  const password = process.env.GBIF_PASSWORD || ''
  const email = process.env.GBIF_EMAIL || ''
  if (!user || !password || !email) {
    console.error('申请下载需设置 GBIF_USER、GBIF_PASSWORD、GBIF_EMAIL')
    process.exit(1)
  }
  const body = {
    creator: user,
    notificationAddresses: [email],
    sendNotification: true,
    format: 'SIMPLE_CSV',
    predicate: {
      type: 'and',
      predicates: [
        { type: 'equals', key: 'COUNTRY', value: 'CN' },
        { type: 'equals', key: 'HAS_COORDINATE', value: 'true' },
        { type: 'equals', key: 'HAS_GEOSPATIAL_ISSUE', value: 'false' },
      ],
    },
  }
  const res = await fetch('https://api.gbif.org/v1/occurrence/download/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`申请失败 ${res.status}: ${text}`)
    process.exit(1)
  }
  const downloadKey = text.replace(/"/g, '').trim()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const meta = {
    downloadKey,
    requestedAt: new Date().toISOString(),
    statusUrl: `https://api.gbif.org/v1/occurrence/download/${downloadKey}`,
    downloadUrl: `https://api.gbif.org/v1/occurrence/download/request/${downloadKey}`,
    notes: ['完成后将 zip 解压 CSV 到 data/gbif/raw/，再运行 npm run enrich:gbif'],
  }
  fs.writeFileSync(path.join(OUT_DIR, 'last-download-request.json'), JSON.stringify(meta, null, 2))
  console.log('已申请下载:', downloadKey)
  console.log('状态:', meta.statusUrl)
  console.log('就绪后解压到 data/gbif/raw/，再执行：npm run enrich:gbif')
}

async function processFile(file: string, map: Map<string, Agg>, catalogueKeys: Set<string>) {
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let header: string[] | null = null
  let delim = '\t'
  let idx: Record<string, number> = {}
  let n = 0
  let skippedOffCatalogue = 0

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
    const key = normName(name)
    // 只聚合名录内种，避免 GBIF 全量把内存撑爆
    if (!catalogueKeys.has(key)) {
      skippedOffCatalogue += 1
      continue
    }
    const lat = Number(get('decimalLatitude'))
    const lng = Number(get('decimalLongitude'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (!isChinaPoint(lat, lng)) continue

    let agg = map.get(key)
    if (!agg) {
      agg = { scientificName: name, count: 0, provinces: new Set(), points: [] }
      map.set(key, agg)
    }
    agg.count += 1
    const prov = normalizeProvince(get('stateProvince'))
    if (prov) agg.provinces.add(prov)
    if (agg.points.length < SAMPLE_POINTS) {
      const yearRaw = get('year')
      const year = yearRaw ? Number(yearRaw) : null
      agg.points.push({
        lat,
        lng,
        key: get('gbifID') || undefined,
        year: Number.isFinite(year as number) ? year : null,
      })
    }
    n += 1
    if (n % 500000 === 0) console.log(`  …已读有效 ${n.toLocaleString()} 行 @ ${path.basename(file)}`)
  }
  console.log(
    `  ${path.basename(file)}: 有效坐标 ${n.toLocaleString()}；跳过非名录行 ${skippedOffCatalogue.toLocaleString()}；聚合物种 ${map.size}`,
  )
}

async function fetchOneSpeciesApi(scientificName: string): Promise<Agg> {
  const agg: Agg = {
    scientificName,
    count: 0,
    provinces: new Set(),
    points: [],
  }
  let offset = 0
  const limit = 300
  while (agg.points.length < SAMPLE_POINTS) {
    const params = new URLSearchParams({
      country: 'CN',
      hasCoordinate: 'true',
      hasGeospatialIssue: 'false',
      scientificName,
      limit: String(limit),
      offset: String(offset),
    })
    const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`)
    if (!res.ok) throw new Error(`GBIF API ${res.status}`)
    const json = (await res.json()) as {
      count?: number
      results?: {
        decimalLatitude?: number
        decimalLongitude?: number
        gbifID?: string | number
        year?: number
        stateProvince?: string
      }[]
    }
    const results = json.results || []
    if (!results.length) break
    agg.count = json.count ?? agg.count
    for (const r of results) {
      const lat = Number(r.decimalLatitude)
      const lng = Number(r.decimalLongitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (!isChinaPoint(lat, lng)) continue
      const prov = normalizeProvince(r.stateProvince || '')
      if (prov) agg.provinces.add(prov)
      if (agg.points.length < SAMPLE_POINTS) {
        agg.points.push({
          lat,
          lng,
          key: r.gbifID,
          year: typeof r.year === 'number' ? r.year : null,
        })
      }
    }
    offset += results.length
    if (offset >= (json.count || 0) || results.length < limit) break
  }
  return agg
}

function writeBack(byLatin: Map<string, Agg>) {
  if (!fs.existsSync(path.join(ROOT, 'public', 'species'))) {
    console.error('缺少 public/species，请先 npm run species:fetch')
    process.exit(1)
  }

  let matched = 0
  let updated = 0
  let withLocations = 0
  let withProvinces = 0
  const provinceIndex: Record<string, string[]> = {}

  const addProvinceSlug = (prov: string, slug: string) => {
    if (!provinceIndex[prov]) provinceIndex[prov] = []
    if (!provinceIndex[prov].includes(slug)) provinceIndex[prov].push(slug)
  }

  forEachSkeleton((rec: SkeletonSpecies) => {
    const hit = byLatin.get(normName(rec.scientificName))
    const existing = loadDetail(resolveJsonPath(rec))

    if (!hit) {
      for (const p of existing?.provinces || []) addProvinceSlug(p, rec.slug)
      if (existing?.provinces?.length) withProvinces += 1
      if (existing?.locations?.length) withLocations += 1
      return
    }

    matched += 1
    const gbifProvinces = sortProvinces(hit.provinces)
    const gbifLocations = hit.points.filter((p) => isChinaPoint(p.lat, p.lng))
    const provinces = sortProvinces([...(existing?.provinces || []), ...gbifProvinces])
    const locations = gbifLocations.length
      ? gbifLocations
      : ((existing?.locations as typeof gbifLocations) || []).filter((p) =>
          isChinaPoint(p.lat, p.lng),
        )

    if (provinces.length) withProvinces += 1
    if (locations.length) withLocations += 1
    for (const p of provinces) addProvinceSlug(p, rec.slug)

    if (
      patchDetail(
        rec,
        { provinces, locations },
        { createIfMissing: provinces.length > 0 || locations.length > 0 },
      )
    ) {
      updated += 1
    }
  })

  fs.writeFileSync(PROVINCE_INDEX, JSON.stringify(provinceIndex))
  updateMeta((meta) => {
    meta.withDistribution = withProvinces
    meta.withGbifLocations = withLocations
    meta.gbif = {
      source: 'GBIF',
      sourceUrl: 'https://www.gbif.org',
      filter: 'country=CN, hasCoordinate=true, hasGeospatialIssue=false',
      appliedAt: new Date().toISOString(),
      matchedSpecies: matched,
      updatedSpecies: updated,
      listSpecies: byLatin.size,
      target: 'species-detail-json',
      role: '辅助分布与地图；非主分类',
    }
    const notes = Array.isArray(meta.notes) ? (meta.notes as string[]) : []
    const note = 'GBIF 中国 occurrence 由 enrich:gbif 直接写入物种详情'
    if (!notes.includes(note)) notes.push(note)
    meta.notes = notes
  })

  console.log('enrich:gbif 完成（已写入物种详情 JSON）')
  console.log(`  GBIF 聚合物种: ${byLatin.size}`)
  console.log(`  库内命中: ${matched}（详情更新 ${updated}）`)
  console.log(`  有省份: ${withProvinces}；有坐标点: ${withLocations}`)
  console.log('下一步：npm run species:publish')
}

async function main() {
  if (DO_REQUEST) {
    await requestDownload()
    return
  }

  if (ONLY_NAME) {
    console.log(`Occurrence API 拉取：${ONLY_NAME}`)
    const agg = await fetchOneSpeciesApi(ONLY_NAME)
    console.log(`  记录约 ${agg.count}，抽样点 ${agg.points.length}，省 ${agg.provinces.size}`)
    const map = new Map<string, Agg>()
    map.set(normName(ONLY_NAME), agg)
    writeBack(map)
    return
  }

  const files = findCsvFiles(RAW_DIR)
  if (!files.length) {
    console.error(
      `未找到 CSV：${RAW_DIR}\n` +
        '请将 GBIF SIMPLE_CSV 解压到此目录，或：\n' +
        '  GBIF_USER=... GBIF_PASSWORD=... GBIF_EMAIL=... npm run enrich:gbif -- --request\n' +
        '单种可：npm run enrich:gbif -- --name="Chrysolophus pictus"',
    )
    process.exit(1)
  }

  const catalogueKeys = new Set<string>()
  const skeletonCount = forEachSkeleton((rec) => {
    catalogueKeys.add(normName(rec.scientificName))
  })
  console.log(`名录键 ${catalogueKeys.size.toLocaleString()}（骨架行 ${skeletonCount.toLocaleString()}）`)

  const map = new Map<string, Agg>()
  for (const f of files) {
    console.log('读取', f)
    await processFile(f, map, catalogueKeys)
  }
  writeBack(map)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
