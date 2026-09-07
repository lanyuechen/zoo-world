/**
 * 《中国动物志》量衡度/量度表：空格或无空格粘连 → Markdown 表。
 * 表头按已知列名贪心切分；数据行按列对齐「均值 + (范围)」。
 */

/** 「性  别」「全  长」等字间空格压回 */
export function compactZhLabel(s: string): string {
  return s.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '')
}

/** 量衡度常见列名（长词优先；遇新列再补） */
const HEADER_TOKENS = [
  '上颊齿列长',
  '下颊齿列长',
  '后足长',
  '颅全长',
  '颅基长',
  '鼻骨长',
  '听泡长',
  '听泡宽',
  '后头宽',
  '眶间宽',
  '耳长',
  '翅长',
  '尾长',
  '体长',
  '全长',
  '体重',
  '嘴峰',
  '跗蹠',
  '跗跖',
  '翼长',
  '齿隙',
  '颧宽',
  '腭长',
  '性别',
  '翅',
  '尾',
  '脚',
]

const HEADER_PAIRS: [string, string][] = [
  ['性', '别'],
  ['体', '重'],
  ['全', '长'],
  ['体', '长'],
  ['嘴', '峰'],
  ['跗', '蹠'],
  ['跗', '跖'],
  ['翅', '长'],
  ['尾', '长'],
  ['耳', '长'],
]

/** 合并被单空格拆开的 Markdown 表头（全|长 → 全长） */
export function fixSplitMeasureHeaders(headers: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < headers.length; i++) {
    const a = compactZhLabel(headers[i] || '')
    const b = compactZhLabel(headers[i + 1] || '')
    if (HEADER_PAIRS.some(([x, y]) => a === x && b === y)) {
      out.push(a + b)
      i += 1
    } else {
      out.push(a)
    }
  }
  return out
}

/**
 * 从字符串开头按列名贪心切表头；余下为数据粘连串。
 * 至少 2 列且含「性别」才视为量衡表头。
 */
export function tokenizeMeasureHeaderPrefix(
  line: string,
): { headers: string[]; rest: string } | null {
  let t = compactZhLabel(line.trim()).replace(/\s+/g, '')
  if (!t) return null
  const headers: string[] = []
  while (t) {
    const hit = HEADER_TOKENS.find((h) => t.startsWith(h))
    if (!hit) break
    headers.push(hit)
    t = t.slice(hit.length)
  }
  if (headers.length < 2) return null
  if (!headers.includes('性别')) return null
  if (
    !headers.some((h) =>
      /体重|全长|体长|嘴峰|翅|尾|跗|耳|颅|鼻|腭|颧|眶|听|颊|齿隙|后足|后头/.test(h),
    )
  ) {
    return null
  }
  return { headers, rest: t }
}

/**
 * 表头行：去掉字间空格后按已知列名贪心切分（整行须全是表头）。
 * 含数字/雌雄符号时不当作纯表头行。
 */
export function tokenizeMeasureHeader(line: string): string[] | null {
  if (/[♂♀\d]/.test(line)) return null
  const parsed = tokenizeMeasureHeaderPrefix(line)
  if (!parsed || parsed.rest) return null
  return parsed.headers
}

/** 在粘连串中找下一处可解析为表头的「性别…」起点 */
function findNextHeaderIndex(s: string): number {
  let from = 0
  while (from < s.length) {
    const idx = s.indexOf('性别', from)
    if (idx < 0) return -1
    if (tokenizeMeasureHeaderPrefix(s.slice(idx))) return idx
    from = idx + 2
  }
  return -1
}

type MeasureTok =
  | { kind: 'sex'; text: string }
  | { kind: 'num'; text: string }
  | { kind: 'range'; text: string }

const SEX_RE = /^[♂♀]+[\(（]\d+[\)）]|^[♂♀]+/
const RANGE_RE =
  /^[\(（]-?\d+(?:\.\d+)?[—–\-−～~至到]-?\d+(?:\.\d+)?[\)）]/
const NUM_RE = /^-?\d+(?:\.\d+)?/

/** 把粘连数据串切成 性别 / 数值 / (范围) token */
export function tokenizeMeasureData(raw: string): MeasureTok[] {
  const t = raw.replace(/\s+/g, '')
  const toks: MeasureTok[] = []
  let i = 0
  while (i < t.length) {
    const slice = t.slice(i)
    const sex = slice.match(SEX_RE)
    if (sex) {
      toks.push({ kind: 'sex', text: sex[0] })
      i += sex[0].length
      continue
    }
    const range = slice.match(RANGE_RE)
    if (range) {
      toks.push({ kind: 'range', text: range[0] })
      i += range[0].length
      continue
    }
    const num = slice.match(NUM_RE)
    if (num) {
      toks.push({ kind: 'num', text: num[0] })
      i += num[0].length
      continue
    }
    i += 1
  }
  return toks
}

/**
 * 按表头列把 token 收成行：性别列 + 各量度「均值 (范围)」。
 */
export function rowsFromMeasureTokens(headers: string[], toks: MeasureTok[]): string[][] {
  const hasSex = headers[0] === '性别'
  const dataCols = hasSex ? headers.length - 1 : headers.length
  const rows: string[][] = []
  let i = 0

  const takeCell = (): string => {
    let cell = ''
    if (i < toks.length && toks[i].kind === 'num') {
      cell = toks[i].text
      i += 1
    }
    if (i < toks.length && toks[i].kind === 'range') {
      cell = cell ? `${cell} ${toks[i].text}` : toks[i].text
      i += 1
    }
    return cell
  }

  while (i < toks.length) {
    if (hasSex) {
      if (toks[i].kind !== 'sex') {
        // 行首残留范围/数字：并入上一行末列
        if (rows.length && (toks[i].kind === 'range' || toks[i].kind === 'num')) {
          const last = rows[rows.length - 1]
          const cur = toks[i].text
          last[last.length - 1] = last[last.length - 1]
            ? `${last[last.length - 1]} ${cur}`
            : cur
          i += 1
          continue
        }
        i += 1
        continue
      }
      const row = [toks[i].text]
      i += 1
      for (let c = 0; c < dataCols; c++) row.push(takeCell())
      rows.push(row)
    } else {
      const row: string[] = []
      for (let c = 0; c < dataCols; c++) row.push(takeCell())
      if (row.some(Boolean)) rows.push(row)
      else break
    }
  }
  return rows
}

export function splitMeasureCells(line: string): string[] {
  const asHeader = tokenizeMeasureHeader(line)
  if (asHeader) return asHeader

  const t = line.replace(/^\s+/, '').replace(/\s+$/, '')
  if (!t) return []
  if (t.includes('\t')) return t.split(/\t+/).map((c) => c.trim()).filter(Boolean)

  // 优先按 2+ 空格分列，避免把「♂♂ (5)」拆成两列；格内中文空格再压合
  const wide = t.split(/\s{2,}/).map((c) => compactZhLabel(c.trim())).filter(Boolean)
  if (wide.length >= 2) return wide

  const parts = t.split(/\s+/).map((c) => c.trim()).filter(Boolean)
  return mergeSexSample(parts)
}

/** ♂♂ (5) / ♀ (3) 被空格拆开时拼回 */
function mergeSexSample(parts: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i]
    const next = parts[i + 1]
    if (next && /^[♂♀]+$/.test(cur) && /^\(?\d+\)?$/.test(next)) {
      out.push(`${cur}${next.startsWith('(') || next.startsWith('（') ? next : `(${next})`}`)
      i += 1
      continue
    }
    out.push(cur)
  }
  return out
}

export function isMeasureHeader(cells: string[]): boolean {
  const fixed = fixSplitMeasureHeaders(cells)
  const joined = fixed.join('')
  return (
    (fixed.includes('性别') || joined.includes('性别')) &&
    (fixed.includes('体重') ||
      fixed.includes('全长') ||
      fixed.includes('体长') ||
      /嘴峰|翅|尾|跗|耳|颅|鼻|腭|颧|眶|听|颊|齿隙|后足|后头/.test(joined))
  )
}

export function isSexRow(cells: string[]): boolean {
  return cells.length >= 2 && /^[♂♀]/.test(cells[0])
}

export function isRangeContinuation(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^\(.*\)$/.test(c) || /^（.*）$/.test(c))
}

export function mergeRangeRow(base: string[], cont: string[]) {
  const offset = base.length - cont.length
  for (let c = 0; c < cont.length; c++) {
    const idx = offset + c
    if (idx > 0 && idx < base.length) base[idx] = `${base[idx]} ${cont[c]}`
  }
}

const LABEL_RE = /^(?:\*\*)?(量衡度|量度)(?:\*\*)?\s*[：:；;．.]?\s*(.*)$/
const SUBSECTION_RE = /^([\u4e00-\u9fff]{1,8})[：:]\s*$/

export function isMeasureLabelLine(line: string): boolean {
  return LABEL_RE.test(line.trim())
}

export type MeasureTable = {
  label: string
  note: string
  /** 如「外形」「头骨」 */
  section?: string
  headers: string[]
  rows: string[][]
}

function normalizeRows(headers: string[], rows: string[][]): string[][] {
  const cols = headers.length
  return rows.map((row) => {
    const r = row.slice(0, cols)
    while (r.length < cols) r.push('')
    return r
  })
}

/** 从「表头+粘连数据」文本解析一张或多张表（数据中可再嵌下一组表头） */
export function parseGluedMeasureTables(
  blob: string,
  opts?: { label?: string; note?: string; section?: string },
): MeasureTable[] {
  const label = opts?.label || '量衡度'
  const note = opts?.note || ''
  const section = opts?.section
  const tables: MeasureTable[] = []
  let s = blob.replace(/\s+/g, '')
  while (s) {
    const headAt = findNextHeaderIndex(s)
    if (headAt < 0) break
    if (headAt > 0) {
      // 表头前残留应并入上一表最后一格（如上一范围）
      if (tables.length) {
        const prev = tables[tables.length - 1]
        const extra = tokenizeMeasureData(s.slice(0, headAt))
        if (extra.length && prev.rows.length) {
          const last = prev.rows[prev.rows.length - 1]
          for (const tok of extra) {
            last[last.length - 1] = last[last.length - 1]
              ? `${last[last.length - 1]} ${tok.text}`
              : tok.text
          }
        }
      }
      s = s.slice(headAt)
    }
    const parsed = tokenizeMeasureHeaderPrefix(s)
    if (!parsed) break
    const { headers, rest } = parsed
    const nextHead = findNextHeaderIndex(rest)
    const dataPart = nextHead >= 0 ? rest.slice(0, nextHead) : rest
    const leftover = nextHead >= 0 ? rest.slice(nextHead) : ''
    const rows = normalizeRows(headers, rowsFromMeasureTokens(headers, tokenizeMeasureData(dataPart)))
    if (rows.length) {
      tables.push({
        label,
        note: tables.length === 0 ? note : '',
        section: tables.length === 0 ? section : undefined,
        headers,
        rows,
      })
    }
    s = leftover
  }
  return tables
}

/**
 * 从「量衡度：」起始行解析表格（旧：空格分列）。
 * @returns consumed 消耗的行数（含起始行）；失败时 table 为 null、consumed 为 0
 */
export function parseMeasureTableAt(
  lines: string[],
  start: number,
): {
  table: MeasureTable | null
  consumed: number
} {
  if (start >= lines.length) return { table: null, consumed: 0 }
  const labelMatch = lines[start].trim().match(LABEL_RE)
  if (!labelMatch) return { table: null, consumed: 0 }

  const label = labelMatch[1]
  let note = labelMatch[2].trim().replace(/^\*\*|\*\*$/g, '').trim()
  // Markdown 注记常在同行：**量衡度** （衡：g；量：mm）
  note = note.replace(/^\*\*|\*\*$/g, '').trim()
  let i = start
  let headerCells: string[] = []

  if (note && !/[（(]/.test(note)) {
    headerCells = splitMeasureCells(note)
    if (isMeasureHeader(headerCells)) {
      note = ''
      i += 1
    } else {
      // 可能是单位注记，落到下方粘连解析
      i += 1
    }
  } else {
    i += 1
  }

  // 尝试旧的空格表路径
  if (!headerCells.length) {
    let j = i
    while (j < lines.length && !lines[j].trim()) j += 1
    if (j < lines.length && !SUBSECTION_RE.test(lines[j].trim())) {
      headerCells = splitMeasureCells(lines[j])
      if (headerCells.length === 1 && headerCells[0] === '性别' && j + 1 < lines.length) {
        j += 1
        headerCells = ['性别', ...splitMeasureCells(lines[j])]
      }
      if (isMeasureHeader(headerCells) && !/[♂♀]/.test(lines[j])) {
        // 纯表头行 + 空格数据行
        i = j + 1
        headerCells = fixSplitMeasureHeaders(headerCells)
        const rows: string[][] = []
        while (i < lines.length) {
          const raw = lines[i]
          if (!raw.trim()) break
          if (/^#{1,6}\s/.test(raw.trim())) break
          if (isMeasureLabelLine(raw)) break
          if (SUBSECTION_RE.test(raw.trim())) break
          const cells = splitMeasureCells(raw)
          if (isSexRow(cells)) {
            rows.push(cells)
            i += 1
            if (i < lines.length) {
              const cont = splitMeasureCells(lines[i])
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
        if (rows.length) {
          return {
            table: {
              label,
              note,
              headers: headerCells,
              rows: normalizeRows(headerCells, rows),
            },
            consumed: Math.max(1, i - start),
          }
        }
      }
    }
  }

  return { table: null, consumed: 0 }
}

function formatTablesMarkdown(tables: MeasureTable[]): string[] {
  const out: string[] = []
  let wroteLabel = false
  for (const { label, note, section, headers, rows } of tables) {
    if (!wroteLabel) {
      out.push('')
      out.push(`**${label}**${note ? ` ${note}` : ''}`)
      out.push('')
      wroteLabel = true
    }
    if (section) {
      out.push(`*${section}*`)
      out.push('')
    }
    if (rows.length) {
      out.push(`| ${headers.join(' | ')} |`)
      out.push(`| ${headers.map(() => '---').join(' | ')} |`)
      for (const r of rows) out.push(`| ${r.join(' | ')} |`)
      out.push('')
    }
  }
  return out
}

/**
 * 解析以量衡度标签开头的整块（可含 外形：/头骨： 及无空格粘连表）。
 */
export function parseMeasureBlockAt(
  lines: string[],
  start: number,
): { tables: MeasureTable[]; consumed: number } {
  if (start >= lines.length) return { tables: [], consumed: 0 }
  const labelMatch = lines[start].trim().match(LABEL_RE)
  if (!labelMatch) return { tables: [], consumed: 0 }

  const label = labelMatch[1]
  let note = (labelMatch[2] || '').trim()
  // 去掉可能残留的加粗标记
  note = note.replace(/^\*+|\*+$/g, '').trim()

  // 先试旧空格表（单表）
  const legacy = parseMeasureTableAt(lines, start)
  if (legacy.table?.rows.length) {
    return { tables: [legacy.table], consumed: legacy.consumed }
  }

  let i = start + 1
  const all: MeasureTable[] = []
  let section: string | undefined

  const flushBlob = (blob: string, sec?: string) => {
    if (!blob.replace(/\s+/g, '')) return
    const tables = parseGluedMeasureTables(blob, { label, note: all.length ? '' : note, section: sec })
    for (const t of tables) all.push(t)
  }

  let blob = ''
  while (i < lines.length) {
    const raw = lines[i]
    const t = raw.trim()
    if (!t) {
      if (blob) {
        flushBlob(blob, section)
        blob = ''
      }
      i += 1
      // 空行后若是标题/新量衡度则结束
      if (i < lines.length) {
        const n = lines[i].trim()
        if (/^#{1,6}\s/.test(n) || isMeasureLabelLine(n)) break
      }
      continue
    }
    if (/^#{1,6}\s/.test(t)) break
    if (isMeasureLabelLine(t) && i > start) break

    const sub = t.match(SUBSECTION_RE)
    if (sub) {
      if (blob) {
        flushBlob(blob, section)
        blob = ''
      }
      section = sub[1]
      i += 1
      continue
    }

    // 纯表头行（无数据）
    const onlyHeader = tokenizeMeasureHeader(t)
    if (onlyHeader) {
      blob += onlyHeader.join('')
      i += 1
      continue
    }

    blob += t
    i += 1
  }
  if (blob) flushBlob(blob, section)

  if (!all.length) return { tables: [], consumed: 0 }
  // 仅第一张表保留 note
  if (all[0]) all[0].note = note
  for (let k = 1; k < all.length; k++) all[k].note = ''

  return { tables: all, consumed: Math.max(1, i - start) }
}

/** 将文中量衡度空格/粘连表转为 Markdown 表（供 enrich 规范化） */
export function convertMeasureTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const parsed = parseMeasureBlockAt(lines, i)
    if (parsed.tables.length) {
      out.push(...formatTablesMarkdown(parsed.tables))
      i += parsed.consumed
      continue
    }

    const labelMatch = lines[i].match(LABEL_RE)
    if (labelMatch) {
      const rest = (labelMatch[2] || '').trim().replace(/^\*+|\*+$/g, '').trim()
      out.push(`**${labelMatch[1]}**${rest ? ` ${rest}` : ''}`)
      i += 1
      continue
    }
    out.push(lines[i])
    i += 1
  }
  return out.join('\n')
}
