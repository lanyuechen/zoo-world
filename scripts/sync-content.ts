/**
 * 从 content/species/**/*.md 重建 public/data 分片索引
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(ROOT, 'content', 'species')
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
  const body = text.slice(end + 4).trim()

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

  const rel = path.relative(path.join(ROOT, 'content'), filePath).split(path.sep).join('/')
  const intro = body
    .replace(/^#.*$/m, '')
    .replace(/^\*\*.*\*\*\s*$/m, '')
    .replace(/^>\s*科普介绍待补充。\s*$/m, '')
    .trim()

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
    reviewedBy: String(data.reviewedBy || ''),
    mdPath: rel,
    slug: String(data.slug || scientificName.replace(/\s+/g, '_')),
    intro,
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

  for (const [phylum, list] of byPhylum) {
    fs.writeFileSync(
      path.join(SPECIES_DIR, `${safeSegment(phylum)}.json`),
      JSON.stringify(list),
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
    notes: [
      '主干分类索引唯一来源：《中国生物物种名录》',
      '收录动物界、植物界、真菌界；由 content/species Markdown 同步生成运行时索引',
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

  console.log(`完成：${species.length} 种（含分布 ${withDistribution}）`)
}

main()
