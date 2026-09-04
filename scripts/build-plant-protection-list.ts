/**
 * 从维基百科重建 data/protection/national-key-wildplants-2021.json
 * 依据现行《国家重点保护野生植物名录》（2021）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'data', 'protection', 'national-key-wildplants-2021.json')
const API =
  'https://zh.wikipedia.org/w/api.php?action=parse&page=%E5%9B%BD%E5%AE%B6%E9%87%8D%E7%82%B9%E4%BF%9D%E6%8A%A4%E9%87%8E%E7%94%9F%E6%A4%8D%E7%89%A9%E5%90%8D%E5%BD%95&prop=wikitext&format=json'

const toSimplified = Converter({ from: 'tw', to: 'cn' })

function cleanZh(s: string) {
  return toSimplified(s.replace(/[\[\]*]/g, '').replace(/^\s*\*\s*/, '').trim())
}
function cleanLatin(s: string) {
  return s
    .replace(/['\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ë/g, 'e')
    .replace(/ü/g, 'u')
    .trim()
}
function levelOf(s: string): 'Ⅰ' | 'Ⅱ' {
  if (/一级|Ⅰ/.test(s)) return 'Ⅰ'
  return 'Ⅱ'
}
function statusLabel(level: 'Ⅰ' | 'Ⅱ', note?: string) {
  const base =
    level === 'Ⅰ' ? '国家一级重点保护野生植物' : '国家二级重点保护野生植物'
  return note ? `${base}（${note}）` : base
}

function extractWikiLinks(note: string): string[] {
  const out: string[] = []
  for (const m of note.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    out.push(cleanZh(m[1]))
  }
  return out
}

function extractExclLatin(latinCell: string): string[] {
  const excl: string[] = []
  const m = latinCell.match(/excl\.\s*(.+?)\)/i)
  if (!m) return excl
  for (const part of m[1].split(/&|和|,|，/)) {
    const name = cleanLatin(part.replace(/^A\.\s*/, 'Alsophila ').trim())
    if (name) excl.push(name)
  }
  return excl
}

async function main() {
  console.log('拉取维基百科植物名录…')
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
    aquatic?: boolean
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

  // 表格中未套模板的物种行
  const reRow =
    /^\|[^\n]*\|\|\s*''([^']+)''\s*\|\|\s*(?:align=center\|)?(一级|二级|Ⅰ|Ⅱ)(?:\|\|([^\n]*))?/gm
  while ((m = reRow.exec(t))) {
    const latin = cleanLatin(m[1])
    if (/\bspp\b/i.test(latin) || /\bsect\b/i.test(latin)) continue
    const zhMatch = m[0].match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/)
    const note = (m[3] || '').replace(/\[\[|\]\]/g, '').trim() || undefined
    const level = levelOf(m[2])
    species.push({
      chineseName: zhMatch ? cleanZh(zhMatch[1]) : '',
      scientificName: latin,
      level,
      status: statusLabel(level, note),
      note,
    })
  }

  type TaxonRule = {
    chineseName: string
    genus?: string
    taxon?: string
    section?: string
    level: 'Ⅰ' | 'Ⅱ'
    status: string
    match: 'genus' | 'family' | 'section'
    excludeChinese?: string[]
    excludeLatin?: string[]
    note?: string
  }

  const taxonRules: TaxonRule[] = []
  const reSpp =
    /^\|([^\n]*)\|\|([^\n]*spp[^\n]*)\|\|\s*(?:align=center\|)?(一级|二级|Ⅰ|Ⅱ)\|\|([^\n]*)/gim
  while ((m = reSpp.exec(t))) {
    const zhCell = m[1]
    const latinCell = m[2]
    const level = levelOf(m[3])
    const noteRaw = m[4] || ''
    const note = noteRaw.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim()

    const zhName = cleanZh(
      (zhCell.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [])
        .map((x) => x.replace(/\[\[|\]\]/g, '').split('|')[0])
        .join(''),
    )

    const excludeChinese = extractWikiLinks(noteRaw).filter((x) =>
      /除外|未列入|不列入/.test(noteRaw) ? true : false,
    )
    // 更精确：备注里「除外 / 未列入 / 不列入」相关链接
    const exclZh: string[] = []
    if (/除外|未列入|不列入/.test(noteRaw)) {
      exclZh.push(...extractWikiLinks(noteRaw))
    }
    const excludeLatin = extractExclLatin(latinCell)

    if (/\bsect\b/i.test(latinCell)) {
      const sect = latinCell.match(/''?([A-Za-z]+(?:\s+[a-z]+)?)''?\s+sect\.\s*''?([A-Za-z]+)''?/i)
      taxonRules.push({
        chineseName: zhName,
        genus: sect?.[1] ? cleanLatin(sect[1]) : undefined,
        section: sect?.[2] ? cleanLatin(sect[2]) : undefined,
        level,
        status: statusLabel(level, note || undefined),
        match: 'section',
        excludeChinese: exclZh.length ? exclZh : undefined,
        excludeLatin: excludeLatin.length ? excludeLatin : undefined,
        note: note || undefined,
      })
      continue
    }

    if (/aceae\s*spp/i.test(latinCell)) {
      const fam = latinCell.match(/([A-Z][a-z]+aceae)/)
      taxonRules.push({
        chineseName: zhName,
        taxon: fam?.[1],
        level,
        status: statusLabel(level, note || undefined),
        match: 'family',
        excludeChinese: exclZh.length ? exclZh : undefined,
        excludeLatin: excludeLatin.length ? excludeLatin : undefined,
        note: note || undefined,
      })
      continue
    }

    const genus = latinCell.match(/''([A-Za-z]+)''\s*spp/i)?.[1] || latinCell.match(/([A-Z][a-z]+)\s*spp/i)?.[1]
    if (genus) {
      taxonRules.push({
        chineseName: zhName,
        genus: cleanLatin(genus),
        level,
        status: statusLabel(level, note || undefined),
        match: 'genus',
        excludeChinese: exclZh.length ? exclZh : undefined,
        excludeLatin: excludeLatin.length ? excludeLatin : undefined,
        note: note || undefined,
      })
    }
  }

  const byKey = new Map<string, (typeof species)[0]>()
  for (const s of species) {
    if (!s.scientificName) continue
    const k = s.scientificName.toLowerCase()
    const prev = byKey.get(k)
    if (!prev || (s.level === 'Ⅰ' && prev.level !== 'Ⅰ')) byKey.set(k, s)
  }

  // 同物异名补充（名录备注中常见）
  const synonymExtras: { from: string; to: string }[] = [
    { from: 'Taiwania flousiana', to: 'Taiwania cryptomerioides' },
  ]
  for (const syn of synonymExtras) {
    const target = byKey.get(syn.to.toLowerCase())
    if (target && !byKey.has(syn.from.toLowerCase())) {
      byKey.set(syn.from.toLowerCase(), {
        ...target,
        scientificName: syn.from,
        note: `异名，见 ${syn.to}`,
      })
    }
  }

  const out = {
    title: '国家重点保护野生植物名录',
    version: '2021',
    source: '国家林业和草原局、农业农村部公告（2021年第15号）',
    sourceUrl: 'https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm',
    compiledFrom: 'https://zh.wikipedia.org/wiki/国家重点保护野生植物名录',
    compiledAt: new Date().toISOString(),
    notes: [
      '现行有效版本为2021年9月公布施行（国务院2021年8月7日批准）',
      '等级：一级/Ⅰ、二级/Ⅱ',
      '“类”条目按属/科所有种扩及；组（sect.）规则因库内无组级数据暂不自动扩及全属',
      '除外 / 未列入物种在匹配时跳过对应阶元规则',
    ],
    species: [...byKey.values()].sort((a, b) =>
      a.scientificName.localeCompare(b.scientificName),
    ),
    taxonRules,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
  console.log(
    `写入 ${OUT}\n  物种 ${out.species.length}（Ⅰ ${out.species.filter((s) => s.level === 'Ⅰ').length} / Ⅱ ${out.species.filter((s) => s.level === 'Ⅱ').length}）\n  阶元规则 ${out.taxonRules.length}（属 ${out.taxonRules.filter((r) => r.match === 'genus').length} / 科 ${out.taxonRules.filter((r) => r.match === 'family').length} / 组 ${out.taxonRules.filter((r) => r.match === 'section').length}）`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
