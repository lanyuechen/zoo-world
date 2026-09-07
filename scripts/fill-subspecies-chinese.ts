/**
 * 根据动物志分类树叶索引，为骨架中「中文名与种相同」的亚种补全名称。
 * 格式：种加名(亚种名)，例如 麻雀(新疆亚种)
 *
 * 依赖：npm run enrich:fauna:tree（tax-tree-leaves.json）
 *
 *   npm run enrich:subsp
 *   npm run enrich:subsp -- --dry-run
 *   npm run enrich:subsp -- --name="Passer montanus"
 *
 * 写入：public/data/species/*.json、search-index.json；若已有详情则同步 chineseName。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  binomialKey,
  chineseTailFromTreeLabel,
  defaultLeafIndexPath,
  faunaScientificKey,
  formatSubspeciesChinese,
  infraChineseFromTreeTail,
  loadLeafIndex,
} from './lib/fauna-tax-tree'
import {
  loadDetail,
  resolveJsonPath,
  writeDetail,
  type SkeletonSpecies,
} from './lib/species-detail-io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DATA = path.join(ROOT, 'public', 'data')
const SPECIES_DIR = path.join(PUBLIC_DATA, 'species')
const SEARCH_INDEX = path.join(PUBLIC_DATA, 'search-index.json')
const LEAF_INDEX = defaultLeafIndexPath(path.join(ROOT, 'data', 'fauna'))

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const ONLY_NAME = args.find((a) => a.startsWith('--name='))?.slice(7)?.trim() || ''

function isInfraspecific(scientificName: string): boolean {
  return /subsp\.|\bssp\.|\bvar\.|\bforma\b|(?:^|\s)f\./i.test(scientificName)
}

function alreadyFilled(chineseName: string): boolean {
  return /[（(][^）)]*亚种[）)]$/.test(chineseName.trim())
}

function loadAllSkeletons(): { file: string; list: SkeletonSpecies[] }[] {
  if (!fs.existsSync(SPECIES_DIR)) return []
  return fs
    .readdirSync(SPECIES_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      const file = path.join(SPECIES_DIR, n)
      const list = JSON.parse(fs.readFileSync(file, 'utf8')) as SkeletonSpecies[]
      return { file, list }
    })
}

function main() {
  const leafIndex = loadLeafIndex(LEAF_INDEX)
  if (!leafIndex?.leafCount) {
    console.error(`缺少分类树叶索引：${LEAF_INDEX}（先 npm run enrich:fauna:tree）`)
    process.exit(1)
  }
  if ((leafIndex.schemaVersion ?? 1) < 2) {
    console.error(`叶索引 schemaVersion < 2，请先 npm run enrich:fauna:tree -- --force`)
    process.exit(1)
  }

  const leavesByBinomial = new Map(leafIndex.leaves.map((l) => [l.binomial, l]))
  const shards = loadAllSkeletons()
  const all = shards.flatMap((s) => s.list)

  const speciesByBinomial = new Map<string, SkeletonSpecies>()
  for (const s of all) {
    if (isInfraspecific(s.scientificName)) continue
    const key = binomialKey(s.scientificName)
    if (key.includes(' ') && !speciesByBinomial.has(key)) speciesByBinomial.set(key, s)
  }

  let scanned = 0
  let updated = 0
  let skippedFilled = 0
  let missedLeaf = 0
  let missedInfraZh = 0
  let detailSynced = 0
  const changedFiles = new Set<string>()
  const previews: string[] = []

  for (const shard of shards) {
    let dirty = false
    for (const rec of shard.list) {
      if (!isInfraspecific(rec.scientificName)) continue
      if (ONLY_NAME && binomialKey(rec.scientificName) !== binomialKey(ONLY_NAME)) continue
      scanned++

      if (alreadyFilled(rec.chineseName)) {
        skippedFilled++
        continue
      }

      const parent = speciesByBinomial.get(binomialKey(rec.scientificName))
      if (!parent?.chineseName) continue
      // 仅补「仍与种同名」的亚种
      if (rec.chineseName.trim() !== parent.chineseName.trim()) continue

      const leaf = leavesByBinomial.get(faunaScientificKey(rec.scientificName))
      if (!leaf) {
        missedLeaf++
        continue
      }

      const infra = infraChineseFromTreeTail(
        parent.chineseName,
        chineseTailFromTreeLabel(leaf.label),
      )
      if (!infra) {
        missedInfraZh++
        continue
      }

      const next = formatSubspeciesChinese(parent.chineseName, infra)
      if (next === rec.chineseName) continue

      if (previews.length < 20) {
        previews.push(`${rec.scientificName}: ${rec.chineseName} → ${next}`)
      }

      if (!DRY) {
        rec.chineseName = next
        dirty = true
        updated++

        const jsonPath = resolveJsonPath(rec)
        const detail = loadDetail(jsonPath)
        if (detail) {
          detail.chineseName = next
          writeDetail(jsonPath, detail)
          detailSynced++
        }
      } else {
        updated++
      }
    }
    if (dirty) {
      fs.writeFileSync(shard.file, JSON.stringify(shard.list), 'utf8')
      changedFiles.add(shard.file)
    }
  }

  if (!DRY && changedFiles.size) {
    const searchIndex = shards.flatMap((s) =>
      s.list.map((r) => [r.scientificName, r.chineseName, r.slug, r.phylum.latin]),
    )
    fs.writeFileSync(SEARCH_INDEX, JSON.stringify(searchIndex), 'utf8')
  }

  console.log(
    DRY
      ? `dry-run：将更新 ${updated} / 扫描亚种 ${scanned}（叶索引 ${leafIndex.leafCount}）`
      : `完成：更新骨架 ${updated}，同步详情 ${detailSynced}，改写分片 ${changedFiles.size}`,
  )
  console.log(
    `跳过已补全 ${skippedFilled}，无树叶 ${missedLeaf}，树叶无亚种中文 ${missedInfraZh}`,
  )
  if (previews.length) {
    console.log('示例：')
    for (const line of previews) console.log(`  ${line}`)
  }
  if (!DRY && updated) {
    console.log(`search-index：${SEARCH_INDEX}`)
  }
}

main()
