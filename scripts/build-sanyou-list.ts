/**
 * 从维基百科重建 data/protection/sanyou-wildlife-2023.json
 * 依据《有重要生态、科学、社会价值的陆生野生动物名录》（2023）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Converter } from 'opencc-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'data', 'protection', 'sanyou-wildlife-2023.json')
const API =
  'https://zh.wikipedia.org/w/api.php?action=parse&page=%E5%9B%BD%E5%AE%B6%E4%BF%9D%E6%8A%A4%E7%9A%84%E6%9C%89%E7%9B%8A%E7%9A%84%E6%88%96%E8%80%85%E6%9C%89%E9%87%8D%E8%A6%81%E7%BB%8F%E6%B5%8E%E3%80%81%E7%A7%91%E5%AD%A6%E7%A0%94%E7%A9%B6%E4%BB%B7%E5%80%BC%E7%9A%84%E9%99%86%E7%94%9F%E9%87%8E%E7%94%9F%E5%8A%A8%E7%89%A9%E5%90%8D%E5%BD%95&prop=wikitext&format=json'

const toSimplified = Converter({ from: 'tw', to: 'cn' })

function cleanZh(s: string) {
  return toSimplified(s.replace(/[\[\]*]/g, '').trim())
}
function cleanLatin(s: string) {
  return s.replace(/['\[\]]/g, '').replace(/\s+/g, ' ').trim()
}

async function main() {
  console.log('拉取维基百科三有名录…')
  const res = await fetch(API, {
    headers: { 'User-Agent': 'zoo-world-sanyou-builder/1.0 (non-commercial)' },
  })
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`)
  const json = (await res.json()) as { parse: { wikitext: { '*': string } } }
  const t = json.parse.wikitext['*']

  // 仅取 2023 调整后名录表（标题含 2023）之后的条目
  const tableStart = t.indexOf('有重要生态、科学、社会价值的陆生野生动物名录（2023年调整）')
  const body = tableStart >= 0 ? t.slice(tableStart) : t

  const species: { chineseName: string; scientificName: string; note?: string }[] = []
  const re =
    /\|\s*\d+\s*\|\|[^\n]*?\[\[([^\]|]+)(?:\|[^\]]+)?\]\][^\n]*\|\|\s*''([^']+)''\s*\|\|([^\n]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const note = m[3]
      .replace(/''/g, '')
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
      .trim()
    species.push({
      chineseName: cleanZh(m[1]),
      scientificName: cleanLatin(m[2]),
      note: note || undefined,
    })
  }

  const byKey = new Map<string, (typeof species)[0]>()
  for (const s of species) {
    const k = s.scientificName.toLowerCase()
    if (!byKey.has(k)) byKey.set(k, s)
    // 备注中的原拉丁学名作为异名键
    if (s.note) {
      for (const am of s.note.matchAll(/(?:原拉丁学名|原名)\s*([A-Z][a-z]+(?:\s+[a-z.-]+)+)/g)) {
        const alias = cleanLatin(am[1]).toLowerCase()
        if (alias && !byKey.has(alias)) byKey.set(alias, s)
      }
    }
  }

  const out = {
    title: '有重要生态、科学、社会价值的陆生野生动物名录',
    shortTitle: '三有名录',
    version: '2023',
    source: '国家林业和草原局公告（2023年第17号）',
    sourceUrl: 'https://www.forestry.gov.cn/lyj/1/gsgg/20230630/509640.html',
    compiledFrom:
      'https://zh.wikipedia.org/wiki/国家保护的有益的或者有重要经济、科学研究价值的陆生野生动物名录',
    compiledAt: new Date().toISOString(),
    notes: [
      '现行有效版本为2023年6月公布施行',
      '简称「三有名录」：有重要生态、科学、社会价值的陆生野生动物',
      '已列入国家重点保护名录的物种一般不再列入本名录',
    ],
    species: [...byKey.values()]
      .filter((s, i, arr) => arr.findIndex((x) => x.scientificName === s.scientificName) === i)
      .sort((a, b) => a.scientificName.localeCompare(b.scientificName)),
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
  console.log(`写入 ${OUT}\n  物种 ${out.species.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
