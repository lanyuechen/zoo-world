/**
 * 对已抓取物种 JSON 的 intro 再跑处理流水线（不重新请求动物志 API）。
 *
 *   npm run process:intro -- --name="Chrysolophus pictus"
 *   npm run process:intro -- --limit=20
 *   npm run process:intro -- --stale          # introPipeline ≠ 当前版本
 *   npm run process:intro -- --dry-run --name="Chrysolophus pictus"
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  INTRO_PIPELINE_VERSION,
  INTRO_STEPS,
  processIntro,
} from './lib/intro'
import { SPECIES_SHARD_DIR, detailAbsPath, type SkeletonSpecies } from './lib/species-detail-io'
import { binomialKey } from './lib/fauna-tax-tree'

const args = process.argv.slice(2)
function argVal(name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const ONLY_NAME = argVal('name') || ''
const PHYLUM = argVal('phylum') || ''
const LIMIT = Number(argVal('limit') || 0) || 0
const DRY = args.includes('--dry-run')
const FORCE = args.includes('--force')
/** 只处理 introPipeline 缺失或与当前版本不同的记录 */
const STALE = args.includes('--stale') || (!FORCE && !ONLY_NAME)

interface DetailFile {
  scientificName: string
  chineseName: string
  intro?: string
  introPipeline?: string
  introProcessedAt?: string
  [key: string]: unknown
}

function listSkeletonTargets(): { record: SkeletonSpecies; file: string }[] {
  if (!fs.existsSync(SPECIES_SHARD_DIR)) return []
  const out: { record: SkeletonSpecies; file: string }[] = []
  for (const f of fs.readdirSync(SPECIES_SHARD_DIR)) {
    if (!f.endsWith('.json')) continue
    const shard = JSON.parse(fs.readFileSync(path.join(SPECIES_SHARD_DIR, f), 'utf8')) as SkeletonSpecies[]
    if (!Array.isArray(shard)) continue
    for (const s of shard) {
      if (s.kingdom?.latin && s.kingdom.latin !== 'Animalia') continue
      const rel = (s.jsonPath || '').replace(/^\//, '')
      if (!rel) continue
      out.push({ record: s, file: detailAbsPath(rel) })
    }
  }
  return out
}

function needsProcess(d: DetailFile): boolean {
  if (!d.intro?.trim()) return false
  if (FORCE) return true
  if (ONLY_NAME && !STALE) return true
  return d.introPipeline !== INTRO_PIPELINE_VERSION
}

function main() {
  console.log(`intro 流水线 ${INTRO_PIPELINE_VERSION}（${INTRO_STEPS.length} 步）`)
  for (const s of INTRO_STEPS) console.log(`  - ${s.id}: ${s.description}`)
  if (DRY) console.log('（dry-run，不写盘）')

  let targets = listSkeletonTargets()
  if (PHYLUM) targets = targets.filter((t) => t.record.phylum.latin === PHYLUM)
  if (ONLY_NAME) {
    const key = binomialKey(ONLY_NAME)
    targets = targets.filter((t) => binomialKey(t.record.scientificName) === key)
  }

  let scanned = 0
  let changed = 0
  let skipped = 0
  let missing = 0

  for (const t of targets) {
    if (LIMIT > 0 && changed >= LIMIT) break
    scanned += 1
    if (!fs.existsSync(t.file)) {
      missing += 1
      continue
    }

    let raw: DetailFile
    try {
      raw = JSON.parse(fs.readFileSync(t.file, 'utf8')) as DetailFile
    } catch {
      missing += 1
      continue
    }

    if (!needsProcess(raw)) {
      skipped += 1
      continue
    }

    const next = processIntro(raw.intro || '', {
      scientificName: raw.scientificName,
      chineseName: raw.chineseName,
    })
    const contentSame = next === (raw.intro || '')
    const markSame = raw.introPipeline === INTRO_PIPELINE_VERSION
    if (contentSame && markSame) {
      skipped += 1
      continue
    }

    console.log(
      `${DRY ? '· would' : '✓'} ${raw.scientificName} ` +
        `${raw.introPipeline || '(none)'} → ${INTRO_PIPELINE_VERSION}` +
        (contentSame ? ' (mark only)' : ` (${(raw.intro || '').length}→${next.length} chars)`),
    )

    if (!DRY) {
      raw.intro = next
      raw.introPipeline = INTRO_PIPELINE_VERSION
      raw.introProcessedAt = new Date().toISOString()
      fs.writeFileSync(t.file, JSON.stringify(raw, null, 2) + '\n')
    }
    changed += 1
  }

  console.log(
    `完成：扫描 ${scanned}，${DRY ? '将更新' : '已更新'} ${changed}，跳过 ${skipped}，无文件 ${missing}`,
  )
}

main()
