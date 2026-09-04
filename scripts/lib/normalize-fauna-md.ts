/**
 * 《中国动物志》抓取正文规范化：标题、段落、量衡度表等。
 */

const SECTION_PREFIX: Record<string, string[]> = {
  形态描述: ['形态'],
  鉴别特征: ['鉴别特征'],
  生境信息: ['生境', '生态'],
  国内分布: ['国内分布', '分布'],
  国外分布: ['国外分布'],
  经济意义: ['经济意义'],
  引证信息: ['引证信息', '引证'],
  大小: ['大小'],
  生物学: ['生物学', '生态'],
}

function splitCells(line: string): string[] {
  const t = line.replace(/^\s+/, '').replace(/\s+$/, '')
  if (t.includes('\t')) return t.split(/\t+/).map((c) => c.trim()).filter(Boolean)
  return t.split(/\s{2,}|\s+/).map((c) => c.trim()).filter(Boolean)
}

function isMeasureHeader(cells: string[]): boolean {
  const joined = cells.join('')
  return (
    cells.includes('性别') &&
    (cells.includes('体重') || cells.includes('全长') || cells.includes('体长') || /嘴峰|翅|尾|跗/.test(joined))
  )
}

function isSexRow(cells: string[]): boolean {
  return cells.length >= 2 && /^[♂♀]/.test(cells[0])
}

function isRangeContinuation(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^\(.*\)$/.test(c) || /^（.*）$/.test(c))
}

function mergeRangeRow(base: string[], cont: string[]) {
  const offset = base.length - cont.length
  for (let c = 0; c < cont.length; c++) {
    const idx = offset + c
    if (idx > 0 && idx < base.length) base[idx] = `${base[idx]} ${cont[c]}`
  }
}

/** 将「量衡度 / 量度」空格表转为 Markdown 表 */
export function convertMeasureTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const labelMatch = line.match(/^(量衡度|量度)[：:．.\s]*(.*)$/)
    if (!labelMatch) {
      out.push(line)
      i += 1
      continue
    }

    const label = labelMatch[1]
    const rest = labelMatch[2].trim()
    const startIdx = i
    i += 1
    while (i < lines.length && !lines[i].trim()) i += 1

    let headerCells = i < lines.length ? splitCells(lines[i]) : []
    if (headerCells.length === 1 && headerCells[0] === '性别' && i + 1 < lines.length) {
      i += 1
      headerCells = ['性别', ...splitCells(lines[i])]
    }

    if (!isMeasureHeader(headerCells)) {
      out.push(line)
      i = startIdx + 1
      continue
    }

    i += 1
    const rows: string[][] = []
    while (i < lines.length) {
      const raw = lines[i]
      if (!raw.trim()) break
      if (raw.trim().startsWith('##')) break
      const cells = splitCells(raw)
      if (isSexRow(cells)) {
        rows.push(cells)
        i += 1
        if (i < lines.length) {
          const cont = splitCells(lines[i])
          if (isRangeContinuation(cont)) {
            mergeRangeRow(rows[rows.length - 1], cont)
            i += 1
          }
        }
        continue
      }
      if (isRangeContinuation(cells) && rows.length) {
        mergeRangeRow(rows[rows.length - 1], cells)
        i += 1
        continue
      }
      break
    }

    out.push('')
    out.push(`**${label}**${rest ? ` ${rest}` : ''}`)
    out.push('')
    if (rows.length) {
      const cols = headerCells.length
      const norm = (row: string[]) => {
        const r = row.slice(0, cols)
        while (r.length < cols) r.push('')
        return r
      }
      out.push(`| ${headerCells.join(' | ')} |`)
      out.push(`| ${headerCells.map(() => '---').join(' | ')} |`)
      for (const row of rows) out.push(`| ${norm(row).join(' | ')} |`)
      out.push('')
    }
  }
  return out.join('\n')
}

function stripSectionPrefix(title: string, body: string): string {
  const prefixes = SECTION_PREFIX[title] || [title]
  let t = body.trimStart()
  for (const p of prefixes) {
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s　:：]+`)
    if (re.test(t)) {
      t = t.replace(re, '')
      break
    }
  }
  return t
}

function paragraphize(text: string): string {
  if (text.includes('| ---')) return text
  if (/\n\s*\n/.test(text.trim())) {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  const compact = text.replace(/\s*\n\s*/g, '').trim()
  if (compact.length < 180) return compact

  const sentences = compact.split(/(?<=[。！？])/)
  const paras: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (!s) continue
    buf += s
    if (buf.length >= 160) {
      paras.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) paras.push(buf.trim())
  return paras.join('\n\n')
}

function normalizeSectionBody(title: string, body: string): string {
  if (title === '参考文献') return body.trim()
  let t = stripSectionPrefix(title, body)
  t = convertMeasureTables(t)

  // split around markdown tables so we don't paragraphize them
  const pieces: string[] = []
  const re = /(\*\*(?:量衡度|量度)\*\*[\s\S]*?(?:\n\|[\s\S]*?\n\| ---[\s\S]*?(?=\n\n|\n*$)))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    if (m.index > last) pieces.push(paragraphize(t.slice(last, m.index).trim()))
    pieces.push(m[1].trim())
    last = m.index + m[1].length
  }
  if (last < t.length) pieces.push(paragraphize(t.slice(last).trim()))
  return pieces.filter(Boolean).join('\n\n')
}

function splitByH2(text: string): { title: string | null; body: string }[] {
  const parts = text.split(/^## /m)
  const out: { title: string | null; body: string }[] = []
  if (!parts[0].trim() && parts.length > 1) {
    // starts with ##
  } else if (parts[0].length) {
    out.push({ title: null, body: parts[0] })
  }
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i].indexOf('\n')
    const title = (nl < 0 ? parts[i] : parts[i].slice(0, nl)).trim()
    const body = nl < 0 ? '' : parts[i].slice(nl + 1)
    out.push({ title, body })
  }
  return out
}

/** 规范化 fauna-sinica 标记块内部（不含标记本身） */
export function normalizeFaunaInner(inner: string): string {
  const text = inner.replace(/\r/g, '').trim()
  const blocks = splitByH2(text)
  const out: string[] = []

  for (const b of blocks) {
    if (b.title == null) {
      // preamble: # title, **latin**, maybe source quote misplaced
      const preamble = b.body.trim()
      if (preamble) out.push(preamble, '')
      continue
    }
    if (b.title === '参考文献') {
      out.push(`## ${b.title}`, '', b.body.trim(), '')
      continue
    }
    // source blockquotes may sit after last section without ##
    const body = b.body
    const srcMatch = body.match(/\n(> 来源：[\s\S]*)$/)
    let main = body
    let source = ''
    if (srcMatch) {
      main = body.slice(0, srcMatch.index)
      source = srcMatch[1].trim()
    }
    out.push(`## ${b.title}`, '', normalizeSectionBody(b.title, main), '')
    if (source) out.push(source, '')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const MARK_START = '<!-- fauna-sinica:start -->'
const MARK_END = '<!-- fauna-sinica:end -->'

export function normalizeFaunaMarkdownFile(raw: string): string {
  if (raw.includes(MARK_START) && raw.includes(MARK_END)) {
    return raw.replace(
      new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`),
      (_m, inner: string) => `${MARK_START}\n${normalizeFaunaInner(inner.trim())}${MARK_END}`,
    )
  }
  if (!raw.startsWith('---\n')) return normalizeFaunaInner(raw)
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return normalizeFaunaInner(raw)
  const fm = raw.slice(0, end + 5)
  const body = raw.slice(end + 5)
  return `${fm}\n${normalizeFaunaInner(body.trim())}`
}
