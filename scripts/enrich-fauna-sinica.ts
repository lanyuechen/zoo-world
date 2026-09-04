/**
 * 从中国动物主题数据库《中国动物志》抓取描述，写入动物界 Markdown 正文。
 *
 * 无需 API Key（走站点公开检索 / 描述接口）。
 * 主分类仍以 Species 2000 为准；本脚本只补充 intro。
 *
 * 用法：
 *   npm run enrich:fauna -- --limit=20
 *   npm run enrich:fauna -- --phylum=Chordata
 *   npm run enrich:fauna -- --name="Aix galericulata"
 *   npm run enrich:fauna -- --resume
 *   npm run enrich:fauna -- --force   # 覆盖已有动物志块
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeFaunaInner } from './lib/normalize-fauna-md'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(ROOT, 'content', 'species')
const STATE_DIR = path.join(ROOT, 'data', 'fauna')
const STATE_PATH = path.join(STATE_DIR, 'progress.json')
const BASE = 'http://www.zoology.csdb.cn'
const FAUNA_SOURCE_LABEL = '中国动物志数据库'
const FAUNA_DESC_LABEL = '中国动物志'
const MARK_START = '<!-- fauna-sinica:start -->'
const MARK_END = '<!-- fauna-sinica:end -->'

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
const DELAY_MS = Number(argVal('delay') || 350)

interface Progress {
  done: Record<string, { taxonId: string; at: string; sections: number }>
  missed: Record<string, string>
  errors: Record<string, string>
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function normName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function binomialKey(s: string): string {
  const parts = normName(s).split(' ')
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'zoo-world-noncommercial-research/0.1 (local enrich script)',
      Accept: 'text/html,application/json,*/*',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url)
  return JSON.parse(text) as T
}

/** 在检索页中找《中国动物志数据库》且学名精确匹配的 taxonId */
async function findFaunaTaxonId(scientificName: string): Promise<string | null> {
  const q = encodeURIComponent(scientificName)
  const want = binomialKey(scientificName)
  for (let offset = 0; offset <= 30; offset += 10) {
    const html = await fetchText(`${BASE}/search/wordall?offset=${offset}&search=${q}`)
    const linkRe = /href="(\/taxon\/\{[^"]+\})"/g
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(html))) {
      const href = m[1]
      const after = html.slice(m.index, Math.min(html.length, m.index + 2800))
      const before = html.slice(Math.max(0, m.index - 900), m.index + 200)
      const src = after.match(/来源:<\/label>\s*<span>([^<]+)<\/span>/)?.[1]?.trim() || ''
      if (!src.includes('动物志')) continue
      const nameHtml = before.match(/<i><font size="3">([\s\S]*?)<\/font><\/i>/)?.[1] || ''
      const name = stripHtml(nameHtml)
      const nameKey = binomialKey(name)
      const ctxKey = binomialKey(stripHtml(before + after.slice(0, 400)))
      if (nameKey === want || ctxKey.includes(want) || (!nameKey && after.includes(scientificName.split(' ')[0]))) {
        return href.replace('/taxon/', '')
      }
    }
    if (!html.includes('offset=' + (offset + 10)) && offset > 0) break
    if (!/href="\/taxon\/\{/.test(html)) break
    await sleep(DELAY_MS)
  }
  return null
}

interface DescItem {
  sourcesName?: string
  specialist?: string
  descriptiontype?: { descterm?: string; dtorder?: number }
  description?: {
    descontent?: string
    referencejson?: string
    describer?: string
    rightsholder?: string
  }
}

async function fetchFaunaDescriptions(taxonId: string): Promise<
  { title: string; body: string; refs: string; order: number }[]
> {
  const url = `${BASE}/search/description/view/${encodeURIComponent(taxonId)}?datasourceinfo=All`
  const list = await fetchJson<DescItem[]>(url)
  const sections: { title: string; body: string; refs: string; order: number }[] = []
  for (const item of list || []) {
    const src = item.sourcesName || ''
    if (!src.includes(FAUNA_DESC_LABEL) && !src.includes('动物志')) continue
    const title = item.descriptiontype?.descterm?.trim() || '描述'
    const body = stripHtml(item.description?.descontent || '')
    if (!body) continue
    const refs = stripHtml(item.description?.referencejson || '')
    sections.push({
      title,
      body,
      refs,
      order: Number(item.descriptiontype?.dtorder ?? 99),
    })
  }
  sections.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh'))
  return sections
}

function buildFaunaMarkdown(
  chineseName: string,
  scientificName: string,
  taxonId: string,
  sections: { title: string; body: string; refs: string }[],
): string {
  const lines: string[] = [
    MARK_START,
    `# ${chineseName || scientificName}`,
    '',
    `**${scientificName}**`,
    '',
  ]
  const seenRefs = new Set<string>()
  for (const s of sections) {
    lines.push(`## ${s.title}`, '', s.body, '')
    if (s.refs) seenRefs.add(s.refs)
  }
  if (seenRefs.size) {
    lines.push('## 参考文献', '')
    for (const r of seenRefs) lines.push(`- ${r}`)
    lines.push('')
  }
  lines.push(
    `> 来源：${FAUNA_SOURCE_LABEL}（《中国动物志》）。中国动物主题数据库：${BASE}/taxon/${taxonId}`,
  )
  const inner = normalizeFaunaInner(lines.slice(1).join('\n'))
  return `${MARK_START}\n${inner}${MARK_END}\n`
}

function splitFrontmatter(raw: string): { fm: string; body: string } | null {
  if (!raw.startsWith('---\n')) return null
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return null
  return { fm: raw.slice(0, end + 5), body: raw.slice(end + 5) }
}

function upsertBody(existingBody: string, faunaBlock: string, force: boolean): string | null {
  const hasMark = existingBody.includes(MARK_START) && existingBody.includes(MARK_END)
  if (hasMark) {
    if (!force) return null
    return existingBody.replace(
      new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`),
      faunaBlock.trim(),
    )
  }
  const trimmed = existingBody.trim()
  const isPlaceholder =
    !trimmed ||
    /^# .+\n\n\*\*[^*]+\*\*\n\n> 科普介绍待补充。\s*$/m.test(trimmed) ||
    trimmed === '> 科普介绍待补充。'
  if (isPlaceholder) return `\n${faunaBlock}`
  // 已有人工正文：追加动物志块
  return `${existingBody.trimEnd()}\n\n${faunaBlock}`
}

function walkAnimalMarkdown(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (name.endsWith('.md')) out.push(p)
    }
  }
  walk(dir)
  return out
}

function readScientificName(fm: string): { scientificName: string; chineseName: string; kingdom: string; phylum: string } {
  const scientificName = fm.match(/scientificName:\s*"([^"]+)"/)?.[1] || ''
  const chineseName = fm.match(/chineseName:\s*"([^"]*)"/)?.[1] || ''
  const kingdom = fm.match(/kingdom:[\s\S]*?latin:\s*"([^"]+)"/)?.[1] || ''
  const phylum = fm.match(/phylum:[\s\S]*?latin:\s*"([^"]+)"/)?.[1] || ''
  return { scientificName, chineseName, kingdom, phylum }
}

function loadProgress(): Progress {
  if (RESUME && fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Progress
  }
  return { done: {}, missed: {}, errors: {} }
}

function saveProgress(p: Progress) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(p, null, 2))
}

async function main() {
  const files = walkAnimalMarkdown(CONTENT_DIR)
  if (!files.length) {
    console.error('未找到 Markdown。请先 npm run import:excel')
    process.exit(1)
  }

  const progress = loadProgress()
  let targets = files.filter((f) => {
    const raw = fs.readFileSync(f, 'utf8')
    const parts = splitFrontmatter(raw)
    if (!parts) return false
    const meta = readScientificName(parts.fm)
    if (meta.kingdom && meta.kingdom !== 'Animalia') return false
    if (PHYLUM && meta.phylum !== PHYLUM) return false
    if (ONLY_NAME && binomialKey(meta.scientificName) !== binomialKey(ONLY_NAME)) return false
    if (!meta.scientificName) return false
    if (RESUME && progress.done[meta.scientificName] && !FORCE) return false
    if (!FORCE && parts.body.includes(MARK_START)) return false
    return true
  })

  if (LIMIT > 0) targets = targets.slice(0, LIMIT)
  console.log(
    `待处理 ${targets.length} 个动物 Markdown（delay=${DELAY_MS}ms` +
      `${PHYLUM ? `, phylum=${PHYLUM}` : ''}` +
      `${ONLY_NAME ? `, name=${ONLY_NAME}` : ''}）`,
  )

  let ok = 0
  let miss = 0
  let err = 0
  let skipped = 0

  for (let i = 0; i < targets.length; i++) {
    const file = targets[i]
    const raw = fs.readFileSync(file, 'utf8')
    const parts = splitFrontmatter(raw)
    if (!parts) continue
    const meta = readScientificName(parts.fm)
    const label = `${i + 1}/${targets.length} ${meta.scientificName}`

    try {
      const taxonId = await findFaunaTaxonId(meta.scientificName)
      await sleep(DELAY_MS)
      if (!taxonId) {
        progress.missed[meta.scientificName] = 'not_in_fauna'
        miss += 1
        if ((i + 1) % 20 === 0) saveProgress(progress)
        console.log(`· miss ${label}`)
        continue
      }
      const sections = await fetchFaunaDescriptions(taxonId)
      await sleep(DELAY_MS)
      if (!sections.length) {
        progress.missed[meta.scientificName] = `no_sections:${taxonId}`
        miss += 1
        console.log(`· miss(no desc) ${label}`)
        continue
      }
      const block = buildFaunaMarkdown(
        meta.chineseName,
        meta.scientificName,
        taxonId,
        sections,
      )
      const nextBody = upsertBody(parts.body, block, FORCE)
      if (nextBody == null) {
        skipped += 1
        console.log(`· skip ${label}`)
        continue
      }
      fs.writeFileSync(file, `${parts.fm}${nextBody.startsWith('\n') ? nextBody : `\n${nextBody}`}`)
      progress.done[meta.scientificName] = {
        taxonId,
        at: new Date().toISOString(),
        sections: sections.length,
      }
      delete progress.missed[meta.scientificName]
      delete progress.errors[meta.scientificName]
      ok += 1
      console.log(`✓ ${label} → ${sections.length} 节`)
    } catch (e) {
      err += 1
      progress.errors[meta.scientificName] = e instanceof Error ? e.message : String(e)
      console.warn(`✗ ${label}`, e)
    }
    if ((i + 1) % 10 === 0) saveProgress(progress)
  }

  saveProgress(progress)
  console.log(`完成：写入 ${ok}，未命中 ${miss}，跳过 ${skipped}，错误 ${err}`)
  console.log(`进度文件：${STATE_PATH}`)
  console.log('写入后请运行：npm run sync:content')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
