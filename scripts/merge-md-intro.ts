/**
 * 将 Markdown 正文 intro 合并进已有 public/data/species 分片（不删其它界）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(ROOT, 'content', 'species')
const SPECIES_DIR = path.join(ROOT, 'public', 'data', 'species')
const META_PATH = path.join(ROOT, 'public', 'data', 'meta.json')

function walkMd(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkMd(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

function parseIntro(raw: string): { scientificName: string; intro: string } | null {
  if (!raw.startsWith('---\n')) return null
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return null
  const fm = raw.slice(0, end + 5)
  const body = raw.slice(end + 5)
  const scientificName = fm.match(/scientificName:\s*"([^"]+)"/)?.[1]
  if (!scientificName) return null
  let intro = body
    .replace(/^# [^#\n].*$/m, '')
    .replace(/^\*\*[^*]+\*\*\s*$/m, '')
    .replace(/^>\s*科普介绍待补充。\s*$/m, '')
    .trim()
  // keep fauna block as intro content for display
  if (intro.includes('<!-- fauna-sinica:start -->')) {
    intro = intro
      .replace(/<!-- fauna-sinica:start -->\s*/g, '')
      .replace(/\s*<!-- fauna-sinica:end -->/g, '')
      .replace(/^# [^#\n].*$/m, '')
      .replace(/^\*\*[^*]+\*\*\s*$/m, '')
      .trim()
  }
  return { scientificName, intro }
}

function main() {
  const files = walkMd(CONTENT_DIR)
  const byName = new Map<string, string>()
  for (const f of files) {
    const parsed = parseIntro(fs.readFileSync(f, 'utf8'))
    if (parsed?.intro) byName.set(parsed.scientificName.toLowerCase(), parsed.intro)
  }
  console.log(`Markdown 有正文 ${byName.size} 种`)

  let updated = 0
  let withIntro = 0
  for (const file of fs.readdirSync(SPECIES_DIR).filter((x) => x.endsWith('.json'))) {
    const fp = path.join(SPECIES_DIR, file)
    const list = JSON.parse(fs.readFileSync(fp, 'utf8')) as {
      scientificName: string
      intro: string
    }[]
    let dirty = false
    for (const s of list) {
      const intro = byName.get(s.scientificName.toLowerCase())
      if (intro != null && intro !== s.intro) {
        s.intro = intro
        dirty = true
        updated += 1
      }
      if (s.intro) withIntro += 1
    }
    if (dirty) fs.writeFileSync(fp, JSON.stringify(list))
  }

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
    meta.withIntro = withIntro
    meta.faunaSinica = {
      source: '中国动物志数据库',
      sourceUrl: 'http://www.zoology.csdb.cn/dba/fauna',
      mergedAt: new Date().toISOString(),
      withIntroFromMarkdown: byName.size,
      updatedSpecies: updated,
    }
    fs.writeFileSync(META_PATH, JSON.stringify(meta))
  }
  console.log(`合并完成：更新 ${updated}，库内有 intro ${withIntro}`)
}

main()
