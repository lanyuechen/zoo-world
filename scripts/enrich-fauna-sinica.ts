/**
 * 从中国动物主题数据库抓取完整介绍包，写入物种 JSON（非 Markdown）。
 *
 * 依赖分类树叶索引；须先：npm run enrich:fauna:tree
 * 输出：public/species/.../{slug}.json
 *   - intro：带出处的 Markdown 字符串
 *   - commonNames / media / synonyms 分字段
 *   - 保护字段若骨架侧已无，保留详情中已有值
 *
 *   npm run enrich:fauna -- --name="Chrysolophus pictus" --force
 *   npm run enrich:fauna -- --resume --retry-missed --concurrency=2
 *
 * 队列优先级：未抓取 → miss → 报错
 * multimedia 失败可降级写入描述，详情标 mediaPending 便于后续补图
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  binomialKey,
  defaultLeafIndexPath,
  faunaScientificKey,
  loadLeafIndex,
  normName,
  type FaunaLeafIndex,
} from './lib/fauna-tax-tree'
import {
  buildZooPackIntro,
  FAUNA_ENRICH_PACK,
  fetchFaunaEnrichPack,
} from './lib/fauna-pack'
import { INTRO_PIPELINE_VERSION } from './lib/intro'
import { speciesJsonRelPath } from './lib/species-json-path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC_ROOT = path.join(ROOT, 'public')
const SPECIES_DATA = path.join(PUBLIC_ROOT, 'data', 'species')
const STATE_DIR = path.join(ROOT, 'data', 'fauna')

const args = process.argv.slice(2)
function argVal(name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const LIMIT = Number(argVal('limit') || 0) || 0
const PHYLUM = argVal('phylum') || ''
const ONLY_NAME = argVal('name') || ''
const RESUME = args.includes('--resume')
const FORCE = args.includes('--force')
const DELAY_MS = Number(argVal('delay') || 250)
const CONCURRENCY = Math.max(1, Number(argVal('concurrency') || 1) || 1)
const SHARD_RAW = argVal('shard') || ''
const SHARD = (() => {
  if (!SHARD_RAW) return null as null | { i: number; n: number }
  const m = SHARD_RAW.match(/^(\d+)\/(\d+)$/)
  if (!m) {
    console.error('--shard 格式应为 i/n，例如 0/4')
    process.exit(1)
  }
  const i = Number(m[1])
  const n = Number(m[2])
  if (!(n >= 2) || !(i >= 0 && i < n)) {
    console.error('--shard 要求 0 <= i < n，且 n >= 2')
    process.exit(1)
  }
  return { i, n }
})()

const STATE_PATH = SHARD
  ? path.join(STATE_DIR, `progress-shard-${SHARD.i}-of-${SHARD.n}.json`)
  : path.join(STATE_DIR, 'progress.json')

interface Progress {
  done: Record<
    string,
    { taxonId: string; at: string; sections: number; pack: string; mediaPending?: boolean }
  >
  missed: Record<string, string>
  errors: Record<string, string>
  /** multimedia 降级待补图的学名 → 原因 */
  mediaPending?: Record<string, string>
}

interface SkeletonRecord {
  scientificName: string
  chineseName: string
  kingdom: { latin: string; chinese: string }
  phylum: { latin: string; chinese: string }
  class: { latin: string; chinese: string }
  order: { latin: string; chinese: string }
  family: { latin: string; chinese: string }
  genus: { latin: string; chinese: string }
  reviewedBy: string
  jsonPath: string
  slug: string
  // 兼容尚未瘦身的胖骨架
  status?: string | null
  sanyou?: boolean | null
  tags?: string[]
  redListCategory?: string | null
  redList?: string | null
  synonyms?: string[]
  mdPath?: string
}

interface SpeciesDetailFile {
  scientificName: string
  chineseName: string
  slug: string
  synonyms: string[]
  commonNames: string[]
  intro: string
  media: {
    url: string
    source: string
    sourceKey: string
    label: string
    rightsHolder: string
    license?: string
  }[]
  status: string | null
  sanyou: boolean | null
  tags: string[]
  redListCategory: string | null
  redList: string | null
  locations: { lat: number; lng: number; key?: string | number; year?: number | null }[]
  provinces: string[]
  enrichPack?: string
  enrichFetchedAt?: string
  enrichSources?: { key: string; label: string; taxonId?: string }[]
  introPipeline?: string
  introProcessedAt?: string
  /** multimedia 接口失败已降级；后续可单独补媒体 */
  mediaPending?: boolean
  mediaFetchError?: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function hashMod(s: string, n: number): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % n
}

/** 去掉 subsp./ssp. 等阶元标记，便于与树叶学名对齐 */
function findFaunaTaxonId(scientificName: string, leafIndex: FaunaLeafIndex): string | null {
  const candidates = [normName(scientificName), faunaScientificKey(scientificName)]
  for (const key of candidates) {
    if (key.includes(' ') && leafIndex.byBinomial[key]) return leafIndex.byBinomial[key]
  }
  // 仅种级名（属+种加词）回退；亚种未入树时不要误用种条目
  const species = binomialKey(scientificName)
  if (!species.includes(' ')) return null
  if (faunaScientificKey(scientificName) === species) return leafIndex.byBinomial[species] || null
  return null
}

function loadTargets(): { record: SkeletonRecord; file: string; phylum: string }[] {
  const out: { record: SkeletonRecord; file: string; phylum: string }[] = []
  if (!fs.existsSync(SPECIES_DATA)) return out
  for (const name of fs.readdirSync(SPECIES_DATA).filter((x) => x.endsWith('.json'))) {
    const list = JSON.parse(fs.readFileSync(path.join(SPECIES_DATA, name), 'utf8')) as SkeletonRecord[]
    for (const s of list) {
      if (!s.scientificName || !s.slug) continue
      // 仅动物界（胖骨架带 kingdom，瘦骨架也有）
      if (s.kingdom?.latin && s.kingdom.latin !== 'Animalia') continue
      const jsonPath =
        s.jsonPath ||
        speciesJsonRelPath({
          phylum: s.phylum,
          class: s.class,
          order: s.order,
          family: s.family,
          genus: s.genus,
          slug: s.slug,
        })
      out.push({
        record: { ...s, jsonPath },
        file: path.join(PUBLIC_ROOT, jsonPath),
        phylum: s.phylum.latin,
      })
    }
  }
  return out
}

function loadProgress(): Progress {
  const empty: Progress = { done: {}, missed: {}, errors: {}, mediaPending: {} }
  if (!RESUME || !fs.existsSync(STATE_PATH)) return empty
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }
  } catch {
    return empty
  }
}

function saveProgress(p: Progress) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const out: Progress = SHARD
    ? {
        done: Object.fromEntries(
          Object.entries(p.done).filter(([name]) => hashMod(name, SHARD.n) === SHARD.i),
        ),
        missed: Object.fromEntries(
          Object.entries(p.missed).filter(([name]) => hashMod(name, SHARD.n) === SHARD.i),
        ),
        errors: Object.fromEntries(
          Object.entries(p.errors).filter(([name]) => hashMod(name, SHARD.n) === SHARD.i),
        ),
        mediaPending: Object.fromEntries(
          Object.entries(p.mediaPending || {}).filter(([name]) => hashMod(name, SHARD.n) === SHARD.i),
        ),
      }
    : p
  fs.writeFileSync(STATE_PATH, JSON.stringify(out, null, 2))
}

function readDetail(file: string): SpeciesDetailFile | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SpeciesDetailFile
  } catch {
    return null
  }
}

function mergeUnique(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of [...a, ...b]) {
    const t = x.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

async function processOne(
  target: { record: SkeletonRecord; file: string; phylum: string },
  indexLabel: string,
  progress: Progress,
  leafIndex: FaunaLeafIndex,
): Promise<'ok' | 'miss' | 'skip' | 'err'> {
  const s = target.record
  const label = `${indexLabel} ${s.scientificName}`
  try {
    const existing = readDetail(target.file)
    if (!FORCE && existing?.enrichPack === FAUNA_ENRICH_PACK && existing.intro) {
      console.log(`· skip ${label}`)
      return 'skip'
    }

    const taxonId = findFaunaTaxonId(s.scientificName, leafIndex)
    if (!taxonId) {
      progress.missed[s.scientificName] = 'not_in_fauna_tree'
      console.log(`· miss ${label}`)
      return 'miss'
    }

    const pack = await fetchFaunaEnrichPack(taxonId)
    await sleep(DELAY_MS)
    if (!pack.sections.length && !pack.media.length && !pack.synonyms.length) {
      progress.missed[s.scientificName] = `empty_pack:${taxonId}`
      console.log(`· miss(empty) ${label}`)
      return 'miss'
    }

    const mediaPending = pack.mediaStatus === 'degraded'
    const intro = buildZooPackIntro(s.chineseName, s.scientificName, pack)
    const detail: SpeciesDetailFile = {
      scientificName: s.scientificName,
      chineseName: s.chineseName,
      slug: s.slug,
      synonyms: mergeUnique(existing?.synonyms || s.synonyms || [], pack.synonyms.map((x) => x.scientificName)),
      commonNames: mergeUnique(existing?.commonNames || [], pack.commonNames),
      intro,
      // 媒体降级时保留已有图片，避免被清空
      media: mediaPending ? existing?.media || [] : pack.media,
      status: existing?.status ?? s.status ?? null,
      sanyou: existing?.sanyou ?? s.sanyou ?? null,
      tags: existing?.tags?.length ? existing.tags : s.tags || [],
      redListCategory: existing?.redListCategory ?? s.redListCategory ?? null,
      redList: existing?.redList ?? s.redList ?? null,
      locations: existing?.locations || [],
      provinces: existing?.provinces || [],
      enrichPack: FAUNA_ENRICH_PACK,
      enrichFetchedAt: new Date().toISOString(),
      enrichSources: [{ key: pack.sourceKey, label: pack.sourceLabel, taxonId: pack.taxonId }],
      introPipeline: INTRO_PIPELINE_VERSION,
      introProcessedAt: new Date().toISOString(),
    }
    if (mediaPending) {
      detail.mediaPending = true
      detail.mediaFetchError = pack.mediaError || 'multimedia_fetch_failed'
    } else {
      delete detail.mediaPending
      delete detail.mediaFetchError
    }

    fs.mkdirSync(path.dirname(target.file), { recursive: true })
    fs.writeFileSync(target.file, JSON.stringify(detail, null, 2) + '\n')

    // 确保骨架有 jsonPath（若仍是胖记录则不在此瘦身全文件，避免大改）
    progress.done[s.scientificName] = {
      taxonId,
      at: new Date().toISOString(),
      sections: pack.sections.length,
      pack: FAUNA_ENRICH_PACK,
      ...(mediaPending ? { mediaPending: true } : {}),
    }
    if (!progress.mediaPending) progress.mediaPending = {}
    if (mediaPending) {
      progress.mediaPending[s.scientificName] = pack.mediaError || 'multimedia_fetch_failed'
    } else {
      delete progress.mediaPending[s.scientificName]
    }
    delete progress.missed[s.scientificName]
    delete progress.errors[s.scientificName]
    console.log(
      `✓ ${label} → json desc=${pack.sections.length} syn=${detail.synonyms.length} cn=${detail.commonNames.length} img=${detail.media.length}` +
        (mediaPending ? ' mediaPending' : ''),
    )
    return 'ok'
  } catch (e) {
    progress.errors[s.scientificName] = e instanceof Error ? e.message : String(e)
    console.warn(`✗ ${label}`, e)
    return 'err'
  }
}

async function main() {
  const targetsAll = loadTargets()
  if (!targetsAll.length) {
    console.error('未找到动物界骨架分片。')
    process.exit(1)
  }

  const leafIndexPath = defaultLeafIndexPath(STATE_DIR)
  const leafIndex = loadLeafIndex(leafIndexPath)
  if (!leafIndex?.leafCount || Object.keys(leafIndex.byBinomial).length === 0) {
    console.error(`缺少分类树叶索引：${leafIndexPath}`)
    process.exit(1)
  }
  console.log(
    `分类树叶索引：${leafIndex.leafCount} 叶${leafIndex.partial ? '（partial）' : ''}（${leafIndex.builtAt}）`,
  )

  const progress = loadProgress()

  function queuePriority(scientificName: string): number {
    // 0 未抓取 → 1 miss → 2 报错
    if (progress.errors[scientificName]) return 2
    if (progress.missed[scientificName]) return 1
    return 0
  }

  let targets = targetsAll.filter((t) => {
    if (PHYLUM && t.phylum !== PHYLUM) return false
    if (ONLY_NAME && binomialKey(t.record.scientificName) !== binomialKey(ONLY_NAME)) return false
    if (SHARD && hashMod(t.record.scientificName, SHARD.n) !== SHARD.i) return false
    if (RESUME && progress.done[t.record.scientificName]?.pack === FAUNA_ENRICH_PACK && !FORCE) return false
    if (
      RESUME &&
      progress.missed[t.record.scientificName] &&
      !FORCE &&
      !args.includes('--retry-missed')
    )
      return false
    if (!FORCE && fs.existsSync(t.file)) {
      const d = readDetail(t.file)
      if (d?.enrichPack === FAUNA_ENRICH_PACK && d.intro) return false
    }
    return true
  })

  targets.sort((a, b) => {
    const pa = queuePriority(a.record.scientificName)
    const pb = queuePriority(b.record.scientificName)
    if (pa !== pb) return pa - pb
    return a.record.scientificName.localeCompare(b.record.scientificName)
  })

  if (LIMIT > 0) targets = targets.slice(0, LIMIT)

  const priCount = { fresh: 0, missed: 0, errors: 0 }
  for (const t of targets) {
    const p = queuePriority(t.record.scientificName)
    if (p === 0) priCount.fresh += 1
    else if (p === 1) priCount.missed += 1
    else priCount.errors += 1
  }

  console.log(
    `待处理 ${targets.length}（未抓取 ${priCount.fresh} → miss ${priCount.missed} → 报错 ${priCount.errors}；` +
      `delay=${DELAY_MS}ms, concurrency=${CONCURRENCY}` +
      `${SHARD ? `, shard=${SHARD.i}/${SHARD.n}` : ''}` +
      `${PHYLUM ? `, phylum=${PHYLUM}` : ''}` +
      `${ONLY_NAME ? `, name=${ONLY_NAME}` : ''}）`,
  )

  let ok = 0
  let miss = 0
  let err = 0
  let skipped = 0
  let cursor = 0

  async function worker() {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= targets.length) return
      const result = await processOne(targets[i], `${i + 1}/${targets.length}`, progress, leafIndex)
      if (result === 'ok') ok += 1
      else if (result === 'miss') miss += 1
      else if (result === 'skip') skipped += 1
      else err += 1
      if ((ok + miss + err + skipped) % 10 === 0) saveProgress(progress)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  saveProgress(progress)
  console.log(`完成：写入 ${ok}，未命中 ${miss}，跳过 ${skipped}，错误 ${err}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
