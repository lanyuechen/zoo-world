/**
 * 从维基百科条目重建 data/protection/national-key-wildlife-2021.json
 * 依据现行《国家重点保护野生动物名录》（2021）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'data', 'protection', 'national-key-wildlife-2021.json')
const API =
  'https://zh.wikipedia.org/w/api.php?action=parse&page=%E5%9B%BD%E5%AE%B6%E9%87%8D%E7%82%B9%E4%BF%9D%E6%8A%A4%E9%87%8E%E7%94%9F%E5%8A%A8%E7%89%A9%E5%90%8D%E5%BD%95&prop=wikitext&format=json'

const toSimplified = Converter({ from: 'tw', to: 'cn' })

function cleanZh(s: string) {
  return toSimplified(s.replace(/[\[\]*]/g, '').replace(/^\s*\*\s*/, '').trim())
}
function cleanLatin(s: string) {
  return s.replace(/['\[\]]/g, '').replace(/\s+/g, ' ').trim()
}
function levelOf(s: string): 'Ⅰ' | 'Ⅱ' {
  return /Ⅰ/.test(s) ? 'Ⅰ' : 'Ⅱ'
}
function statusLabel(level: 'Ⅰ' | 'Ⅱ', note?: string) {
  const base =
    level === 'Ⅰ' ? '国家一级重点保护野生动物' : '国家二级重点保护野生动物'
  return note ? `${base}（${note}）` : base
}

async function main() {
  console.log('拉取维基百科名录…')
  const res = await fetch(API, {
    headers: { 'User-Agent': 'zoo-world-protection-builder/1.0 (non-commercial)' },
  })
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`)
  const json = (await res.json()) as { parse: { wikitext: { '*': string } } }
  const t = json.parse.wikitext['*']

  const species: {
    chineseName: string
    scientificName: string
    level: 'Ⅰ' | 'Ⅱ'
    status: string
    note?: string
    aquatic: boolean
  }[] = []

  const reSp =
    /\{\{[Pp]rotect_speciesf?\s*\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)\}\}(?:\|\|([^\n|]*))?/g
  let m: RegExpExecArray | null
  while ((m = reSp.exec(t))) {
    const note = (m[4] || '').trim() || undefined
    const level = levelOf(m[3])
    species.push({
      chineseName: cleanZh(m[1]),
      scientificName: cleanLatin(m[2]),
      level,
      status: statusLabel(level, note),
      note,
      aquatic: /\{\{[Pp]rotect_speciesf\b/.test(m[0]),
    })
  }

  const genera: {
    chineseName: string
    genus: string
    level: 'Ⅰ' | 'Ⅱ'
    status: string
    note?: string
    match: 'genus'
  }[] = []
  const reGenus =
    /\{\{[Pp]rotect_genus_all\s*\|([^|{}]+)\|([^|{}]+)\|([^|{}]+)\}\}(?:\|\|([^\n|]*))?/g
  while ((m = reGenus.exec(t))) {
    const note = (m[4] || '').trim() || undefined
    const level = levelOf(m[3])
    genera.push({
      chineseName: cleanZh(m[1]),
      genus: cleanLatin(m[2]),
      level,
      status: statusLabel(level, note),
      note,
      match: 'genus',
    })
  }

  const higher = [
    {
      chineseName: '黑珊瑚目',
      taxon: 'Antipatharia',
      rank: 'order',
      level: 'Ⅱ' as const,
      status: statusLabel('Ⅱ'),
      match: 'order' as const,
    },
    {
      chineseName: '石珊瑚目',
      taxon: 'Scleractinia',
      rank: 'order',
      level: 'Ⅱ' as const,
      status: statusLabel('Ⅱ'),
      match: 'order' as const,
    },
    {
      chineseName: '苍珊瑚科',
      taxon: 'Helioporidae',
      rank: 'family',
      level: 'Ⅱ' as const,
      status: statusLabel('Ⅱ'),
      match: 'family' as const,
    },
    {
      chineseName: '红珊瑚科',
      taxon: 'Coralliidae',
      rank: 'family',
      level: 'Ⅰ' as const,
      status: statusLabel('Ⅰ'),
      match: 'family' as const,
    },
  ]

  const byKey = new Map<string, (typeof species)[0]>()
  for (const s of species) {
    const k = s.scientificName.toLowerCase()
    const prev = byKey.get(k)
    if (!prev || (s.level === 'Ⅰ' && prev.level !== 'Ⅰ')) byKey.set(k, s)
  }

  const out = {
    title: '国家重点保护野生动物名录',
    version: '2021',
    source: '国家林业和草原局、农业农村部公告（2021年第3号）',
    sourceUrl: 'http://www.forestry.gov.cn/lyj/1/gkgfxwj/20210201/546057.html',
    compiledFrom: 'https://zh.wikipedia.org/wiki/国家重点保护野生动物名录',
    compiledAt: new Date().toISOString(),
    notes: [
      '现行有效版本为2021年2月公布施行（国务院2021年1月4日批准）',
      '等级：Ⅰ=国家一级，Ⅱ=国家二级',
      '“类”条目按属/目/科所有种扩及名录中对应阶元下物种',
    ],
    species: [...byKey.values()].sort((a, b) =>
      a.scientificName.localeCompare(b.scientificName),
    ),
    taxonRules: [...genera, ...higher],
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
  console.log(
    `写入 ${OUT}\n  物种 ${out.species.length}（Ⅰ ${out.species.filter((s) => s.level === 'Ⅰ').length} / Ⅱ ${out.species.filter((s) => s.level === 'Ⅱ').length}）\n  阶元规则 ${out.taxonRules.length}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
