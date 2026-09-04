/**
 * 清理 enrich:fauna 误匹配写入的介绍（种加词撞车等）。
 *
 * 规则：
 * 1) 同一 taxonId 挂到多个不同学名 → 全部删除 fauna 块
 * 2) 非鸟类正文却引用「鸟纲」→ 删除
 * 3) 非哺乳类正文却引用「兽纲/哺乳纲」动物志卷且 class 明显不符时可扩展
 *
 *   npx tsx scripts/cleanup-fauna-mismatches.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MD_ROOT = path.join(ROOT, 'public', 'species')
const STATE_DIR = path.join(ROOT, 'data', 'fauna')
const MARK_START = '<!-- fauna-sinica:start -->'
const MARK_END = '<!-- fauna-sinica:end -->'

function walkMd(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkMd(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}

function fmField(raw: string, key: string): string {
  const m = raw.match(new RegExp(`${key}:\\s*"([^"]*)"`))
  return m?.[1] || ''
}

function fmClassLatin(raw: string): string {
  const m = raw.match(/class:[\s\S]*?latin:\s*"([^"]+)"/)
  return m?.[1] || ''
}

function taxonIdOf(raw: string): string | null {
  const m = raw.match(/zoology\.csdb\.cn\/taxon\/(\{[^}]+\})/)
  return m?.[1] || null
}

function binomialKey(s: string): string {
  const parts = s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || ''
}

function stripFaunaBlock(raw: string): string {
  if (!raw.includes(MARK_START)) return raw
  return (
    raw
      .replace(new RegExp(`\\n*${MARK_START}[\\s\\S]*?${MARK_END}\\n*`, 'g'), '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

/** 仅剩 frontmatter、无正文时删除文件（符合「只保留有 intro 的 md」） */
function shouldDeleteAfterStrip(raw: string): boolean {
  if (raw.includes(MARK_START)) return false
  if (!raw.startsWith('---')) return false
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return false
  return !raw.slice(end + 5).trim()
}

function loadProgressFiles(): { path: string; data: Progress }[] {
  const out: { path: string; data: Progress }[] = []
  if (!fs.existsSync(STATE_DIR)) return out
  for (const f of fs.readdirSync(STATE_DIR)) {
    if (f === 'progress.json' || /^progress-shard-\d+-of-\d+\.json$/.test(f)) {
      const p = path.join(STATE_DIR, f)
      try {
        out.push({ path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) as Progress })
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

interface Progress {
  done: Record<string, unknown>
  missed: Record<string, string>
  errors: Record<string, string>
}

function main() {
  const files = walkMd(MD_ROOT)
  const byTaxon = new Map<string, { file: string; scientificName: string }[]>()
  const suspicious = new Set<string>()

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.includes(MARK_START)) continue
    const scientificName = fmField(raw, 'scientificName')
    const classLatin = fmClassLatin(raw)
    const tid = taxonIdOf(raw)
    if (tid) {
      const list = byTaxon.get(tid) || []
      list.push({ file, scientificName })
      byTaxon.set(tid, list)
    }
    // 非鸟却引用鸟纲志
    if (classLatin && classLatin !== 'Aves' && /鸟纲/.test(raw)) {
      suspicious.add(file)
    }
    // 非哺乳却大段「雷鸟/尾羽」等且 class 为哺乳——已被鸟纲规则覆盖
  }

  for (const [, list] of byTaxon) {
    // 同一 taxon 挂到不同「属+种」才算撞车；种与其亚种共用一条志文不算
    const binomials = new Set(list.map((x) => binomialKey(x.scientificName)))
    if (binomials.size > 1) {
      for (const x of list) suspicious.add(x.file)
    }
  }

  const clearedNames: string[] = []
  let deletedFiles = 0
  for (const file of suspicious) {
    const raw = fs.readFileSync(file, 'utf8')
    const name = fmField(raw, 'scientificName')
    const next = stripFaunaBlock(raw)
    if (next === raw) continue
    if (shouldDeleteAfterStrip(next)) {
      fs.unlinkSync(file)
      deletedFiles += 1
      console.log('✗ 删除空壳', path.relative(ROOT, file), name)
    } else {
      fs.writeFileSync(file, next)
      console.log('✗ 清除误匹配', path.relative(ROOT, file), name)
    }
    clearedNames.push(name)
  }

  // 从进度中移除，便于严格匹配下重抓 / 记为未完成
  const progressFiles = loadProgressFiles()
  for (const { path: pp, data } of progressFiles) {
    let dirty = false
    for (const name of clearedNames) {
      if (data.done?.[name]) {
        delete data.done[name]
        dirty = true
      }
      if (data.missed?.[name]) {
        delete data.missed[name]
        dirty = true
      }
      if (data.errors?.[name]) {
        delete data.errors[name]
        dirty = true
      }
    }
    if (dirty) fs.writeFileSync(pp, JSON.stringify(data, null, 2))
  }

  console.log(`完成：清除 ${clearedNames.length} 个误匹配介绍（其中删除空壳 ${deletedFiles}）`)
}

main()
