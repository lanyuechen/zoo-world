/**
 * 规范化已抓取的《中国动物志》Markdown。
 * 默认只处理指定学名；确认无误后再 --all。
 *
 *   npm run normalize:fauna -- --name="Aix galericulata"
 *   npm run normalize:fauna -- --all
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeFaunaMarkdownFile } from './lib/normalize-fauna-md'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(ROOT, 'content', 'species')

const args = process.argv.slice(2)
const ONLY = args.find((a) => a.startsWith('--name='))?.slice('--name='.length)
const ALL = args.includes('--all')

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

function scientificFromFm(raw: string): string {
  return raw.match(/scientificName:\s*"([^"]+)"/)?.[1] || ''
}

function main() {
  if (!ONLY && !ALL) {
    console.error('请指定 --name="学名" 或确认后使用 --all')
    process.exit(1)
  }
  const files = walk(CONTENT_DIR).filter((f) => {
    const raw = fs.readFileSync(f, 'utf8')
    if (!raw.includes('<!-- fauna-sinica:start -->')) return false
    if (ALL) return true
    return scientificFromFm(raw).toLowerCase() === ONLY!.toLowerCase()
  })
  if (!files.length) {
    console.error('未找到目标 Markdown')
    process.exit(1)
  }
  let n = 0
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8')
    const next = normalizeFaunaMarkdownFile(raw)
    if (next !== raw) {
      fs.writeFileSync(f, next)
      n += 1
      console.log('✓', path.relative(ROOT, f))
    } else {
      console.log('· 无变化', path.relative(ROOT, f))
    }
  }
  console.log(`完成：更新 ${n} / ${files.length}`)
  console.log('请运行：npm run merge:intro')
}

main()
