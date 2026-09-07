/**
 * 将 content/species 中有正文的 Markdown 迁到 public/species，
 * 删除空壳 md，并从运行时分片去掉 intro 字段（改由按需加载 md）。
 *
 *   npx tsx scripts/migrate-intro-to-public.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractIntroFromMarkdown, speciesMdRelPath } from './lib/species-md-path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OLD_DIR = path.join(ROOT, 'content', 'species')
const PUBLIC_ROOT = path.join(ROOT, 'public')
const SPECIES_DATA = path.join(PUBLIC_ROOT, 'data', 'species')
const META_PATH = path.join(PUBLIC_ROOT, 'data', 'meta.json')

function walkMd(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkMd(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

function main() {
  if (!fs.existsSync(OLD_DIR)) {
    console.error('未找到 content/species，跳过文件迁移')
  } else {
    const files = walkMd(OLD_DIR)
    let kept = 0
    let skipped = 0
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8')
      const intro = extractIntroFromMarkdown(raw)
      if (!intro) {
        skipped += 1
        continue
      }
      const relFromOld = path.relative(OLD_DIR, file).split(path.sep).join('/')
      const dest = path.join(PUBLIC_ROOT, 'species', relFromOld)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, raw)
      kept += 1
    }
    console.log(`Markdown：保留有正文 ${kept}，丢弃空壳 ${skipped}`)
    fs.rmSync(OLD_DIR, { recursive: true, force: true })
    const contentRoot = path.join(ROOT, 'content')
    if (fs.existsSync(contentRoot) && fs.readdirSync(contentRoot).length === 0) {
      fs.rmSync(contentRoot, { recursive: true, force: true })
    }
    console.log('已删除 content/species')
  }

  let withIntro = 0
  if (fs.existsSync(path.join(PUBLIC_ROOT, 'species'))) {
    withIntro = walkMd(path.join(PUBLIC_ROOT, 'species')).filter((f) =>
      extractIntroFromMarkdown(fs.readFileSync(f, 'utf8')),
    ).length
  }

  let cleared = 0
  let pathFixed = 0
  for (const name of fs.readdirSync(SPECIES_DATA).filter((x) => x.endsWith('.json'))) {
    const fp = path.join(SPECIES_DATA, name)
    const list = JSON.parse(fs.readFileSync(fp, 'utf8')) as {
      intro?: string
      mdPath?: string
      phylum: { latin: string }
      class: { latin: string }
      order: { latin: string }
      family: { latin: string }
      genus: { latin: string }
      slug: string
    }[]
    let dirty = false
    for (const s of list) {
      if (s.intro) {
        s.intro = ''
        cleared += 1
        dirty = true
      }
      const nextPath = speciesMdRelPath(s)
      if (s.mdPath !== nextPath) {
        s.mdPath = nextPath
        pathFixed += 1
        dirty = true
      }
    }
    if (dirty) fs.writeFileSync(fp, JSON.stringify(list))
  }
  console.log(`分片：清空 intro ${cleared}，修正 mdPath ${pathFixed}`)

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
    meta.withIntro = withIntro
    meta.introSource = {
      mode: 'public-markdown',
      path: 'public/species/{门}/…/{slug}.md',
      migratedAt: new Date().toISOString(),
      withIntro,
    }
    fs.writeFileSync(META_PATH, JSON.stringify(meta))
  }
  console.log(`meta.withIntro = ${withIntro}`)
  console.log('完成')
}

main()
