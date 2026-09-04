/**
 * 从 public/species 下 Markdown 重建 public/data 分片索引。
 * 注意：仅有介绍的物种才有 md；全量名录请用 import:excel（--no-md / 默认不写空壳）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProtectionLookup, resolveAnimalStatus } from './apply-animal-protection'
import { loadPlantProtectionLookup, resolvePlantStatus } from './apply-plant-protection'
import { loadRedListLookups, resolveRedList } from './apply-redlist'
import { applySanyouTags, loadSanyouLookup } from './apply-sanyou'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(ROOT, 'public', 'species')
const PUBLIC_DATA = path.join(ROOT, 'public', 'data')
const SPECIES_DIR = path.join(PUBLIC_DATA, 'species')

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

type RankKey = 'domain' | 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus'

interface TaxonomyNode {
  rank: RankKey
  latin: string
  chinese: string
  speciesCount: number
  children?: TaxonomyNode[]
}

function walkMdFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walkMdFiles(full, acc)
    else if (name.endsWith('.md')) acc.push(full)
  }
  return acc
}

function parseSimpleYamlValue(raw: string): string {
  const t = raw.trim()
  if (t === 'null') return ''
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      return JSON.parse(t)
    } catch {
      return t.slice(1, -1)
    }
  }
  return t
}

function parseMarkdown(filePath: string): SpeciesRecord | null {
  const text = fs.readFileSync(filePath, 'utf8')
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  const fm = text.slice(4, end)
  void text.slice(end + 4) // body 由前端按需加载，不写入分片

  const lines = fm.split('\n')
  const data: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/)
    if (!m) {
      i += 1
      continue
    }
    const key = m[1]
    const rest = m[2]
    if (rest === '') {
      i += 1
      if (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        const arr: string[] = []
        while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
          arr.push(parseSimpleYamlValue(lines[i].replace(/^\s+-\s+/, '')))
          i += 1
        }
        data[key] = arr
        continue
      }
      if (i < lines.length && lines[i].match(/^\s+\w+:/)) {
        const obj: Record<string, string> = {}
        while (i < lines.length && lines[i].match(/^\s+\w+:/)) {
          const nm = lines[i].match(/^\s+(\w+):\s*(.*)$/)!
          obj[nm[1]] = parseSimpleYamlValue(nm[2])
          i += 1
        }
        data[key] = obj
        continue
      }
      data[key] = ''
      continue
    }
    if (rest === '[]') {
      data[key] = []
      i += 1
      continue
    }
    if (rest === 'null') {
      data[key] = null
      i += 1
      continue
    }
    data[key] = parseSimpleYamlValue(rest)
    i += 1
  }

  const taxon = (v: unknown): TaxonLabel => {
    const o = (v || {}) as TaxonLabel
    return { latin: o.latin || '_unknown', chinese: o.chinese || '' }
  }

  const scientificName = String(data.scientificName || '')
  if (!scientificName) return null

  const rel = path.relative(path.join(ROOT, 'public'), filePath).split(path.sep).join('/')

  return {
    scientificName,
    chineseName: String(data.chineseName || ''),
    synonyms: Array.isArray(data.synonyms) ? (data.synonyms as string[]) : [],
    kingdom: taxon(data.kingdom),
    phylum: taxon(data.phylum),
    class: taxon(data.class),
    order: taxon(data.order),
    family: taxon(data.family),
    genus: taxon(data.genus),
    distribution: Array.isArray(data.distribution) ? (data.distribution as string[]) : [],
    status: data.status == null || data.status === '' ? null : String(data.status),
    sanyou:
      data.sanyou === true || data.sanyou === 'true'
        ? true
        : data.sanyou === false || data.sanyou === 'false'
          ? false
          : null,
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    redListCategory:
      data.redListCategory == null || data.redListCategory === ''
        ? null
        : String(data.redListCategory),
    redList: data.redList == null || data.redList === '' ? null : String(data.redList),
    reviewedBy: String(data.reviewedBy || ''),
    mdPath: rel,
    slug: String(data.slug || scientificName.replace(/\s+/g, '_')),
    intro: '',
  }
}

function upsertChild(parent: TaxonomyNode, rank: RankKey, taxon: TaxonLabel): TaxonomyNode {
  if (!parent.children) parent.children = []
  let node = parent.children.find((c) => c.latin === taxon.latin)
  if (!node) {
    node = { rank, latin: taxon.latin, chinese: taxon.chinese, speciesCount: 0, children: [] }
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

function safeSegment(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

function main() {
  const files = walkMdFiles(CONTENT_DIR)
  if (files.length === 0) {
    console.error('未找到 Markdown，请先运行 npm run import:excel')
    process.exit(1)
  }

  console.log(`扫描 ${files.length} 个 Markdown…`)
  const byKey = new Map<string, SpeciesRecord>()
  const root: TaxonomyNode = {
    rank: 'domain',
    latin: 'Biota',
    chinese: '生物',
    speciesCount: 0,
    children: [],
  }

  for (const file of files) {
    const rec = parseMarkdown(file)
    if (!rec) continue
    byKey.set(rec.scientificName.toLowerCase(), rec)

    const kingdomNode = upsertChild(root, 'kingdom', rec.kingdom)
    const phylum = upsertChild(kingdomNode, 'phylum', rec.phylum)
    const cls = upsertChild(phylum, 'class', rec.class)
    const order = upsertChild(cls, 'order', rec.order)
    const family = upsertChild(order, 'family', rec.family)
    const genus = upsertChild(family, 'genus', rec.genus)
    root.speciesCount += 1
    for (const n of [kingdomNode, phylum, cls, order, family, genus]) n.speciesCount += 1
  }

  sortTree(root)
  const species = [...byKey.values()].sort((a, b) =>
    a.scientificName.localeCompare(b.scientificName),
  )

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
      const fromList = resolveAnimalStatus(s, animalLookup)
      if (fromList) {
        s.status = fromList
        animalProtected += 1
      }
    } else {
      const fromList = resolvePlantStatus(s, plantLookup)
      if (fromList) {
        s.status = fromList
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

  fs.mkdirSync(PUBLIC_DATA, { recursive: true })
  fs.rmSync(SPECIES_DIR, { recursive: true, force: true })
  fs.mkdirSync(SPECIES_DIR, { recursive: true })

  const byPhylum = new Map<string, SpeciesRecord[]>()
  const slugIndex: Record<string, string> = {}
  const kingdoms = new Set<string>()
  let withDistribution = 0

  for (const s of species) {
    if (!byPhylum.has(s.phylum.latin)) byPhylum.set(s.phylum.latin, [])
    byPhylum.get(s.phylum.latin)!.push(s)
    slugIndex[s.slug] = s.phylum.latin
    if (s.kingdom.latin) kingdoms.add(s.kingdom.latin)
    if (s.distribution.length > 0) withDistribution += 1
  }

  for (const [phylum, listRows] of byPhylum) {
    fs.writeFileSync(
      path.join(SPECIES_DIR, `${safeSegment(phylum)}.json`),
      JSON.stringify(listRows),
      'utf8',
    )
  }

  const meta = {
    title: '中国生物大百科',
    source: '中国生物物种名录（Species 2000 中国节点）',
    sourceUrl: 'https://www.sp2000.org.cn',
    syncedAt: new Date().toISOString(),
    speciesCount: species.length,
    kingdoms: [...kingdoms].sort(),
    phyla: [...byPhylum.keys()].sort(),
    withDistribution,
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
      '收录动物界、植物界、真菌界；介绍 Markdown 在 public/species（有正文才入库）',
      '动物保护等级依据《国家重点保护野生动物名录》（2021）匹配写入',
      '植物保护等级依据《国家重点保护野生植物名录》（2021）匹配写入',
      '动物「三有」标签依据《有重要生态、科学、社会价值的陆生野生动物名录》（2023）匹配',
      '动植物红色名录等级依据《中国生物多样性红色名录》（2020）匹配写入',
    ],
  }

  fs.writeFileSync(path.join(PUBLIC_DATA, 'meta.json'), JSON.stringify(meta), 'utf8')
  fs.writeFileSync(path.join(PUBLIC_DATA, 'taxonomy.json'), JSON.stringify(root), 'utf8')
  fs.writeFileSync(
    path.join(PUBLIC_DATA, 'search-index.json'),
    JSON.stringify(species.map((s) => [s.scientificName, s.chineseName, s.slug, s.phylum.latin])),
    'utf8',
  )
  fs.writeFileSync(path.join(PUBLIC_DATA, 'slug-index.json'), JSON.stringify(slugIndex), 'utf8')

  console.log(
    `完成：${species.length} 种（含分布 ${withDistribution}，保护动物 ${animalProtected}，保护植物 ${plantProtected}，三有 ${sanyouCount}，红色名录 ${animalRed + plantRed}）`,
  )
}

main()
