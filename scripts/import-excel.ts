/**
 * 从《中国生物物种名录》Excel 导入 → Markdown + 分片运行时索引
 *
 * 收录动物界 / 植物界 / 真菌界。Excel 列：物种拉丁名 / 物种中文名 / 界~属 / 审核专家/数据源
 * 异名、国内分布、科普正文：Excel 中暂无，写入空占位。
 * 动物保护等级：导入后按《国家重点保护野生动物名录》（2021）匹配写入。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { loadProtectionLookup, resolveAnimalStatus } from './apply-animal-protection'
import { loadPlantProtectionLookup, resolvePlantStatus } from './apply-plant-protection'
import { loadRedListLookups, resolveRedList } from './apply-redlist'
import { applySanyouTags, loadSanyouLookup } from './apply-sanyou'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data', 'raw')
const CONTENT_SPECIES = path.join(ROOT, 'public', 'species')
const PUBLIC_DATA = path.join(ROOT, 'public', 'data')
const SPECIES_DIR = path.join(PUBLIC_DATA, 'species')

const COL = {
  scientificName: '物种拉丁名',
  chineseName: '物种中文名',
  kingdomLatin: '界拉丁名',
  kingdomZh: '界中文名',
  phylumLatin: '门拉丁名',
  phylumZh: '门中文名',
  classLatin: '纲拉丁名',
  classZh: '纲中文名',
  orderLatin: '目拉丁名',
  orderZh: '目中文名',
  familyLatin: '科拉丁名',
  familyZh: '科中文名',
  genusLatin: '属拉丁名',
  genusZh: '属中文名',
  reviewedBy: '审核专家/数据源',
} as const

type RankKey = 'domain' | 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus'

interface TaxonLabel {
  latin: string
  chinese: string
}

interface SpeciesRecord {
  scientificName: string
  chineseName: string
  synonyms: string[]
  kingdom: TaxonLabel
  phylum: TaxonLabel
  class: TaxonLabel
  order: TaxonLabel
  family: TaxonLabel
  genus: TaxonLabel
  distribution: string[]
  status: string | null
  sanyou: boolean | null
  tags: string[]
  redListCategory: string | null
  redList: string | null
  reviewedBy: string
  mdPath: string
  slug: string
  intro: string
}

interface TaxonomyNode {
  rank: RankKey
  latin: string
  chinese: string
  speciesCount: number
  children?: TaxonomyNode[]
}

function slugifyScientificName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function safeSegment(name: string): string {
  const s = name.trim() || '_unknown'
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

function cell(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (v == null) return ''
  return String(v).trim()
}

function label(row: Record<string, unknown>, latinKey: string, zhKey: string): TaxonLabel {
  return {
    latin: cell(row, latinKey) || '_unknown',
    chinese: cell(row, zhKey),
  }
}

function toMarkdown(s: SpeciesRecord): string {
  const yamlList = (arr: string[]) =>
    arr.length === 0 ? '[]' : `\n${arr.map((x) => `  - ${JSON.stringify(x)}`).join('\n')}`

  return `---
scientificName: ${JSON.stringify(s.scientificName)}
chineseName: ${JSON.stringify(s.chineseName)}
synonyms: ${yamlList(s.synonyms)}
kingdom:
  latin: ${JSON.stringify(s.kingdom.latin)}
  chinese: ${JSON.stringify(s.kingdom.chinese)}
phylum:
  latin: ${JSON.stringify(s.phylum.latin)}
  chinese: ${JSON.stringify(s.phylum.chinese)}
class:
  latin: ${JSON.stringify(s.class.latin)}
  chinese: ${JSON.stringify(s.class.chinese)}
order:
  latin: ${JSON.stringify(s.order.latin)}
  chinese: ${JSON.stringify(s.order.chinese)}
family:
  latin: ${JSON.stringify(s.family.latin)}
  chinese: ${JSON.stringify(s.family.chinese)}
genus:
  latin: ${JSON.stringify(s.genus.latin)}
  chinese: ${JSON.stringify(s.genus.chinese)}
distribution: ${yamlList(s.distribution)}
status: ${s.status == null ? 'null' : JSON.stringify(s.status)}
sanyou: ${s.sanyou == null ? 'null' : s.sanyou}
tags: ${yamlList(s.tags)}
redListCategory: ${s.redListCategory == null ? 'null' : JSON.stringify(s.redListCategory)}
redList: ${s.redList == null ? 'null' : JSON.stringify(s.redList)}
reviewedBy: ${JSON.stringify(s.reviewedBy)}
slug: ${JSON.stringify(s.slug)}
---

# ${s.chineseName || s.scientificName}

**${s.scientificName}**

> 科普介绍待补充。
`
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function readExcelRows(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath, { cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

function upsertChild(
  parent: TaxonomyNode,
  rank: RankKey,
  taxon: TaxonLabel,
): TaxonomyNode {
  if (!parent.children) parent.children = []
  let node = parent.children.find((c) => c.latin === taxon.latin)
  if (!node) {
    node = {
      rank,
      latin: taxon.latin,
      chinese: taxon.chinese,
      speciesCount: 0,
      children: [],
    }
    parent.children.push(node)
  } else if (!node.chinese && taxon.chinese) {
    node.chinese = taxon.chinese
  }
  return node
}

function sortTree(node: TaxonomyNode) {
  if (!node.children?.length) {
    delete node.children
    return
  }
  node.children.sort((a, b) => a.latin.localeCompare(b.latin))
  for (const c of node.children) sortTree(c)
}

function writeRuntimeIndexes(
  root: TaxonomyNode,
  species: SpeciesRecord[],
  metaExtra: Record<string, unknown>,
) {
  ensureDir(PUBLIC_DATA)
  fs.rmSync(SPECIES_DIR, { recursive: true, force: true })
  ensureDir(SPECIES_DIR)

  const byPhylum = new Map<string, SpeciesRecord[]>()
  const slugIndex: Record<string, string> = {}
  const kingdoms = new Set<string>()

  for (const s of species) {
    const key = s.phylum.latin
    if (!byPhylum.has(key)) byPhylum.set(key, [])
    byPhylum.get(key)!.push(s)
    slugIndex[s.slug] = key
    if (s.kingdom.latin) kingdoms.add(s.kingdom.latin)
  }

  for (const [phylum, list] of byPhylum) {
    list.sort((a, b) => a.scientificName.localeCompare(b.scientificName))
    fs.writeFileSync(
      path.join(SPECIES_DIR, `${safeSegment(phylum)}.json`),
      JSON.stringify(list),
      'utf8',
    )
  }

  const searchIndex = species.map((s) => [
    s.scientificName,
    s.chineseName,
    s.slug,
    s.phylum.latin,
  ])

  const meta = {
    title: '中国生物大百科',
    source: '中国生物物种名录（Species 2000 中国节点）',
    sourceUrl: 'https://www.sp2000.org.cn',
    speciesCount: species.length,
    kingdoms: [...kingdoms].sort(),
    phyla: [...byPhylum.keys()].sort(),
    ...metaExtra,
  }

  fs.writeFileSync(path.join(PUBLIC_DATA, 'meta.json'), JSON.stringify(meta), 'utf8')
  fs.writeFileSync(path.join(PUBLIC_DATA, 'taxonomy.json'), JSON.stringify(root), 'utf8')
  fs.writeFileSync(path.join(PUBLIC_DATA, 'search-index.json'), JSON.stringify(searchIndex), 'utf8')
  fs.writeFileSync(path.join(PUBLIC_DATA, 'slug-index.json'), JSON.stringify(slugIndex), 'utf8')

  fs.writeFileSync(
    path.join(PUBLIC_DATA, 'catalogue.json'),
    JSON.stringify({
      meta: {
        ...meta,
        split: true,
        message: '数据已拆分为 taxonomy.json / species/{phylum}.json / search-index.json',
      },
    }),
    'utf8',
  )
}

function main() {
  const writeMdStubs = process.argv.includes('--write-md-stubs')
  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .sort()

  if (files.length === 0) {
    console.error(`未找到 Excel：请将名录文件放入 ${RAW_DIR}`)
    process.exit(1)
  }

  console.log(`读取 ${files.length} 个 Excel…`)
  if (writeMdStubs) {
    console.warn('警告：--write-md-stubs 会写入空壳 Markdown，一般不需要')
    ensureDir(CONTENT_SPECIES)
  }

  const byKey = new Map<string, SpeciesRecord>()
  const root: TaxonomyNode = {
    rank: 'domain',
    latin: 'Biota',
    chinese: '生物',
    speciesCount: 0,
    children: [],
  }

  let rowCount = 0
  let mdWritten = 0

  for (const file of files) {
    const full = path.join(RAW_DIR, file)
    console.log(`  → ${file}`)
    const rows = readExcelRows(full)

    for (const row of rows) {
      rowCount += 1
      const scientificName = cell(row, COL.scientificName)
      if (!scientificName) continue

      const kingdom = label(row, COL.kingdomLatin, COL.kingdomZh)
      const phylum = label(row, COL.phylumLatin, COL.phylumZh)
      const classTaxon = label(row, COL.classLatin, COL.classZh)
      const order = label(row, COL.orderLatin, COL.orderZh)
      const family = label(row, COL.familyLatin, COL.familyZh)
      const genus = label(row, COL.genusLatin, COL.genusZh)
      const chineseName = cell(row, COL.chineseName)
      const reviewedBy = cell(row, COL.reviewedBy)
      const slug = slugifyScientificName(scientificName)

      const mdPath = [
        'species',
        safeSegment(phylum.latin),
        safeSegment(classTaxon.latin),
        safeSegment(order.latin),
        safeSegment(family.latin),
        safeSegment(genus.latin),
        `${slug}.md`,
      ].join('/')

      const record: SpeciesRecord = {
        scientificName,
        chineseName,
        synonyms: [],
        kingdom,
        phylum,
        class: classTaxon,
        order,
        family,
        genus,
        distribution: [],
        status: null,
        sanyou: null,
        tags: [],
        redListCategory: null,
        redList: null,
        reviewedBy,
        mdPath,
        slug,
        intro: '',
      }

      const key = scientificName.toLowerCase()
      if (byKey.has(key)) {
        const prev = byKey.get(key)!
        if (!prev.chineseName && chineseName) prev.chineseName = chineseName
        if (!prev.reviewedBy && reviewedBy) prev.reviewedBy = reviewedBy
        continue
      }
      byKey.set(key, record)

      const kingdomNode = upsertChild(root, 'kingdom', kingdom)
      const nPhylum = upsertChild(kingdomNode, 'phylum', phylum)
      const nClass = upsertChild(nPhylum, 'class', classTaxon)
      const nOrder = upsertChild(nClass, 'order', order)
      const nFamily = upsertChild(nOrder, 'family', family)
      const nGenus = upsertChild(nFamily, 'genus', genus)

      root.speciesCount += 1
      for (const n of [kingdomNode, nPhylum, nClass, nOrder, nFamily, nGenus]) {
        n.speciesCount += 1
      }

      if (writeMdStubs) {
        const abs = path.join(ROOT, 'public', mdPath)
        ensureDir(path.dirname(abs))
        fs.writeFileSync(abs, toMarkdown(record), 'utf8')
        mdWritten += 1
        if (mdWritten % 5000 === 0) console.log(`    已写 Markdown 空壳 ${mdWritten}…`)
      }
    }
  }

  sortTree(root)
  const species = [...byKey.values()].sort((a, b) =>
    a.scientificName.localeCompare(b.scientificName),
  )

  console.log('匹配国家重点保护名录、三有名录与红色名录…')
  const { list: animalList, lookup: animalLookup } = loadProtectionLookup()
  const { list: plantList, lookup: plantLookup } = loadPlantProtectionLookup()
  const { list: sanyouList, lookup: sanyouLookup } = loadSanyouLookup()
  const {
    animalList: redAnimalList,
    plantList: redPlantList,
    animalLookup: redAnimalLookup,
    plantLookup: redPlantLookup,
  } = loadRedListLookups()
  let animalProtected = 0
  let plantProtected = 0
  let sanyouCount = 0
  let animalRed = 0
  let plantRed = 0
  for (const s of species) {
    if (s.kingdom.latin === 'Animalia') {
      const status = resolveAnimalStatus(s, animalLookup)
      if (status) {
        s.status = status
        animalProtected += 1
      }
    } else {
      const status = resolvePlantStatus(s, plantLookup)
      if (status) {
        s.status = status
        plantProtected += 1
      }
    }
    const { sanyou, tags } = applySanyouTags(s, sanyouLookup)
    s.sanyou = sanyou
    s.tags = tags
    if (sanyou) sanyouCount += 1

    const red = resolveRedList(s, redAnimalLookup, redPlantLookup)
    if (red) {
      s.redListCategory = red.category
      s.redList = red.label
      if (s.kingdom.latin === 'Animalia') animalRed += 1
      else if (s.kingdom.latin === 'Plantae') plantRed += 1
    } else {
      s.redListCategory = null
      s.redList = null
    }
  }

  console.log('写入分片索引…')
  writeRuntimeIndexes(root, species, {
    importedAt: new Date().toISOString(),
    files,
    withDistribution: species.filter((s) => s.distribution.length > 0).length,
    withAnimalProtection: animalProtected,
    withPlantProtection: plantProtected,
    withProtection: animalProtected + plantProtected,
    withSanyou: sanyouCount,
    withAnimalRedList: animalRed,
    withPlantRedList: plantRed,
    withRedList: animalRed + plantRed,
    protection: {
      wildlife: {
        list: animalList.title,
        version: animalList.version,
        source: animalList.source,
        sourceUrl: animalList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: animalProtected,
        animalSpecies: species.filter((s) => s.kingdom.latin === 'Animalia').length,
      },
      plant: {
        list: plantList.title,
        version: plantList.version,
        source: plantList.source,
        sourceUrl: plantList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: plantProtected,
        plantSpecies: species.filter((s) => s.kingdom.latin === 'Plantae').length,
      },
    },
    sanyou: {
      list: sanyouList.title,
      shortTitle: sanyouList.shortTitle,
      version: sanyouList.version,
      source: sanyouList.source,
      sourceUrl: sanyouList.sourceUrl,
      appliedAt: new Date().toISOString(),
      matchedSpecies: sanyouCount,
      animalSpecies: species.filter((s) => s.kingdom.latin === 'Animalia').length,
      listSpecies: sanyouList.species.length,
    },
    redList: {
      animal: {
        list: redAnimalList.title,
        version: redAnimalList.version,
        source: redAnimalList.source,
        sourceUrl: redAnimalList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: animalRed,
        listSpecies: redAnimalList.species.length,
        kingdomSpecies: species.filter((s) => s.kingdom.latin === 'Animalia').length,
      },
      plant: {
        list: redPlantList.title,
        version: redPlantList.version,
        source: redPlantList.source,
        sourceUrl: redPlantList.sourceUrl,
        appliedAt: new Date().toISOString(),
        matchedSpecies: plantRed,
        listSpecies: redPlantList.species.length,
        kingdomSpecies: species.filter((s) => s.kingdom.latin === 'Plantae').length,
      },
    },
    notes: [
      '主干分类索引唯一来源：《中国生物物种名录》',
      '收录动物界、植物界、真菌界本土物种；拉丁学名为主键',
      '当前 Excel 不含异名、国内分布省份；相关字段留空待补',
      '动物保护等级依据《国家重点保护野生动物名录》（2021）匹配写入',
      '植物保护等级依据《国家重点保护野生植物名录》（2021）匹配写入',
      '动物「三有」标签依据《有重要生态、科学、社会价值的陆生野生动物名录》（2023）匹配',
      '动植物红色名录等级依据《中国生物多样性红色名录》（2020）匹配写入',
      '科普介绍写在 public/species/**/*.md，物种页按需加载（勿再 merge:intro）',
    ],
  })

  console.log('\n完成')
  console.log(`  Excel 行数: ${rowCount}`)
  console.log(`  唯一物种: ${species.length}`)
  console.log(`  国家重点保护动物（已匹配）: ${animalProtected}`)
  console.log(`  国家重点保护植物（已匹配）: ${plantProtected}`)
  console.log(`  三有名录（已匹配）: ${sanyouCount}`)
  console.log(`  红色名录动物（已匹配）: ${animalRed}`)
  console.log(`  红色名录植物（已匹配）: ${plantRed}`)
  console.log(`  Markdown 空壳: ${writeMdStubs ? mdWritten : '跳过（默认不写；需 --write-md-stubs）'}`)
  console.log(`  索引目录: ${PUBLIC_DATA}`)
}

main()
