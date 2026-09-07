/**
 * 《中国动物志数据库》左侧分类树（zTree async）。
 * 页面：http://www.zoology.csdb.cn/dba/fauna
 * 接口：GET /search/taxtree/rest/showChildren?taxtreeId=…&id=…
 *
 * 「叶」= 种 / 亚种（学名至少含属 + 种加词），不论 isParent。
 * 种下常有亚种：种本身也入库，同时继续展开子节点。上级阶元只入队不入库。
 * id 即 taxon UUID，可直接拉 description/view。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 索引语义版本：种+亚种均入库；学名 key 含亚种加词。旧断点不可续跑，需 --force */
export const FAUNA_LEAF_INDEX_VERSION = 2

export const FAUNA_BASE = 'http://www.zoology.csdb.cn'
/** /dba/fauna 页内写死的动物志分类树 ID */
export const FAUNA_TAX_TREE_ID = '3076e0105dab4bf2993c28f83b2acc11'

/** BFS 队列里表示根节点（无 id 参数） */
export const TREE_ROOT_TOKEN = ''

export interface FaunaTreeNode {
  id: string
  name: string
  isParent?: boolean
  title?: string
  click?: string
  url?: string | null
}

export interface FaunaLeaf {
  taxonId: string
  /** 规范化完整学名（种：属+种加词；亚种：再含亚种加词） */
  binomial: string
  label: string
}

export interface FaunaLeafIndex {
  taxtreeId: string
  /** FAUNA_LEAF_INDEX_VERSION；缺省视为 1（仅 isParent=false） */
  schemaVersion?: number
  builtAt: string
  leafCount: number
  /** 完整学名 key → taxonId（同名多叶时保留先出现的；种先于亚种入队故种优先占 binomial） */
  byBinomial: Record<string, string>
  leaves: FaunaLeaf[]
  /** 未完成时为 true；enrich 可用部分索引，但应尽量等 done */
  partial?: boolean
}

/** 断点：队列 + 已收集叶 + 已展开父节点 */
export interface FaunaTreeCheckpoint {
  taxtreeId: string
  schemaVersion?: number
  updatedAt: string
  reqs: number
  /** 待展开父节点 id；空字符串 = 根 */
  queue: string[]
  /** 已成功展开过的父节点（含根 ""） */
  visited: string[]
  leaves: FaunaLeaf[]
  done: boolean
}

export function stripHtml(html: string): string {
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

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** 表格单元格：去掉内部标签；br → 空格（均值与范围同行） */
function htmlTableCellToText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).replace(/\|/g, '\\|')
}

/**
 * HTML &lt;table&gt; → Markdown 表。须在剥离其它标签之前调用。
 */
export function htmlTablesToMarkdown(html: string): string {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    const rows: string[][] = []
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let tr: RegExpExecArray | null
    while ((tr = trRe.exec(inner))) {
      const cells: string[] = []
      const tdRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi
      let td: RegExpExecArray | null
      while ((td = tdRe.exec(tr[1]))) {
        cells.push(htmlTableCellToText(td[1]))
      }
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return '\n\n'
    const cols = Math.max(...rows.map((r) => r.length))
    const norm = rows.map((r) => {
      const x = r.slice(0, cols)
      while (x.length < cols) x.push('')
      return x
    })
    return [
      '',
      `| ${norm[0].join(' | ')} |`,
      `| ${norm[0].map(() => '---').join(' | ')} |`,
      ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`),
      '',
    ].join('\n')
  })
}

/**
 * 描述 HTML → Markdown：保留段落换行与加粗/斜体等简单格式；&lt;table&gt; → Markdown 表。
 * 标签名大小写不敏感；未识别标签剥离，文本保留。
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  let t = html.replace(/\r\n/g, '\n').replace(/\r/g, '')

  // 表格优先（否则 tr/td 被剥掉后列会粘成一行）
  t = htmlTablesToMarkdown(t)

  // 块级 → 换行
  t = t.replace(/<\/p>/gi, '\n\n')
  t = t.replace(/<p(?:\s[^>]*)?>/gi, '')
  t = t.replace(/<\/div>/gi, '\n')
  t = t.replace(/<div(?:\s[^>]*)?>/gi, '')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/h([1-6])>/gi, '\n\n')
  t = t.replace(/<h([1-6])(?:\s[^>]*)?>/gi, (_, n) => `${'#'.repeat(Number(n))} `)

  // 简单行内格式（由内向外可多轮；此处处理常见一层）
  for (let i = 0; i < 3; i++) {
    const prev = t
    t = t.replace(/<(b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
      const body = String(inner).replace(/^\s+|\s+$/g, '')
      return body ? `**${body}**` : ''
    })
    t = t.replace(/<(i|em)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
      const body = String(inner).replace(/^\s+|\s+$/g, '')
      return body ? `*${body}*` : ''
    })
    if (t === prev) break
  }

  // 下划线不进 Markdown，仅保留文本
  t = t.replace(/<\/?u(?:\s[^>]*)?>/gi, '')

  // 其余标签去掉
  t = t.replace(/<[^>]+>/g, '')
  t = decodeBasicEntities(t)

  return t
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function binomialKey(s: string): string {
  const parts = normName(s).split(' ')
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || ''
}

/**
 * 树节点显示名 → 完整学名 key。
 * "Passer montanus [树]麻雀" → "passer montanus"
 * "Passer montanus dilutus 新疆亚种" → "passer montanus dilutus"
 * "Passer 麻雀属" / "Aves 鸟纲" → ""（上级阶元，不入库）
 */
export function scientificFromTreeLabel(label: string): string {
  const plain = stripHtml(label)
  const m = plain.match(/^([A-Za-z][A-Za-z0-9-]*(?:\s+[a-z][a-z0-9-]*)+)/)
  if (!m) return ''
  return normName(m[1])
}

/** 树节点 → 属+种二项式（不含亚种加词） */
export function binomialFromTreeLabel(label: string): string {
  return binomialKey(scientificFromTreeLabel(label))
}

/**
 * 名录学名 → 与树叶对齐的 key（去掉 subsp./ssp. 等标记）。
 * "Passer montanus subsp. dilutus" → "passer montanus dilutus"
 */
export function faunaScientificKey(scientificName: string): string {
  return normName(scientificName)
    .replace(/\b(subsp|ssp|var|f|forma|subvar)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 树节点 label 去掉学名后的中文尾巴 */
export function chineseTailFromTreeLabel(label: string): string {
  const plain = stripHtml(label).replace(/\s+/g, ' ').trim()
  return plain.replace(/^[A-Za-z][A-Za-z0-9-]*(?:\s+[a-z][a-z0-9-]*)+\s*/, '').trim()
}

/**
 * 从树叶中文尾巴提取亚种名（如「新疆亚种」）。
 * 若为「冷杉纩蚜指名亚种」且种加名为「冷杉纩蚜」，则得到「指名亚种」。
 */
export function infraChineseFromTreeTail(speciesChinese: string, leafChineseTail: string): string | null {
  let t = leafChineseTail
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/，\s*新亚种$/u, '亚种')
    .replace(/[,，].*$/u, '')
    .trim()
  if (!t) return null
  const speciesCn = speciesChinese.trim()
  if (speciesCn && t.startsWith(speciesCn)) {
    t = t.slice(speciesCn.length).trim()
  }
  const m = t.match(/([\u4e00-\u9fffA-Za-z0-9·\-]*亚种)$/u)
  if (m?.[1]) return m[1]
  if (/亚种/u.test(t)) return t
  return null
}

/** 种加名(亚种名)，例如 麻雀(新疆亚种) */
export function formatSubspeciesChinese(speciesChinese: string, infraChinese: string): string {
  return `${speciesChinese.trim()}(${infraChinese.trim()})`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'zoo-world-noncommercial-research/0.1 (local enrich script)',
      Accept: 'application/json,*/*',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

export async function fetchTreeChildren(
  parentId?: string,
  taxtreeId = FAUNA_TAX_TREE_ID,
): Promise<FaunaTreeNode[]> {
  const q = new URLSearchParams({ taxtreeId })
  if (parentId) q.set('id', parentId)
  const url = `${FAUNA_BASE}/search/taxtree/rest/showChildren?${q}`
  const list = await fetchJson<FaunaTreeNode[]>(url)
  return Array.isArray(list) ? list : []
}

export function defaultLeafIndexPath(stateDir: string): string {
  return path.join(stateDir, 'tax-tree-leaves.json')
}

export function defaultCheckpointPath(stateDir: string): string {
  return path.join(stateDir, 'tax-tree-checkpoint.json')
}

export function loadLeafIndex(file: string): FaunaLeafIndex | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FaunaLeafIndex
  } catch {
    return null
  }
}

export function saveLeafIndex(file: string, index: FaunaLeafIndex) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(index))
  fs.renameSync(tmp, file)
}

export function loadCheckpoint(file: string): FaunaTreeCheckpoint | null {
  if (!fs.existsSync(file)) return null
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as FaunaTreeCheckpoint
    if (!j || !Array.isArray(j.queue) || !Array.isArray(j.leaves)) return null
    return j
  } catch {
    return null
  }
}

export function saveCheckpoint(file: string, cp: FaunaTreeCheckpoint) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cp))
  fs.renameSync(tmp, file)
}

export function buildLeafIndex(
  leaves: FaunaLeaf[],
  opts?: { taxtreeId?: string; partial?: boolean },
): FaunaLeafIndex {
  const byBinomial: Record<string, string> = {}
  for (const leaf of leaves) {
    if (!byBinomial[leaf.binomial]) byBinomial[leaf.binomial] = leaf.taxonId
  }
  return {
    taxtreeId: opts?.taxtreeId ?? FAUNA_TAX_TREE_ID,
    schemaVersion: FAUNA_LEAF_INDEX_VERSION,
    builtAt: new Date().toISOString(),
    leafCount: leaves.length,
    byBinomial,
    leaves,
    ...(opts?.partial ? { partial: true } : {}),
  }
}

export async function crawlFaunaLeaves(opts: {
  delayMs?: number
  taxtreeId?: string
  /** 续跑起点；缺省从根开始 */
  checkpoint?: FaunaTreeCheckpoint | null
  onProgress?: (info: {
    reqs: number
    leaves: number
    queue: number
    checkpoint: FaunaTreeCheckpoint
  }) => void
  shouldStop?: () => boolean
}): Promise<{ leaves: FaunaLeaf[]; checkpoint: FaunaTreeCheckpoint }> {
  const delayMs = opts.delayMs ?? 80
  const taxtreeId = opts.taxtreeId ?? FAUNA_TAX_TREE_ID
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const prev = opts.checkpoint
  if (prev && (prev.schemaVersion ?? 1) < FAUNA_LEAF_INDEX_VERSION) {
    throw new Error(
      `checkpoint schemaVersion ${prev.schemaVersion ?? 1} < ${FAUNA_LEAF_INDEX_VERSION}；请 --force 重建`,
    )
  }
  const queue: string[] =
    prev && !prev.done && prev.queue.length
      ? [...prev.queue]
      : [TREE_ROOT_TOKEN]
  const visited = new Set<string>(prev?.visited || [])
  const queued = new Set<string>(queue)
  const leaves: FaunaLeaf[] = prev?.leaves ? [...prev.leaves] : []
  const seenLeafIds = new Set(leaves.map((l) => l.taxonId))
  let reqs = prev?.reqs || 0

  const snapshot = (): FaunaTreeCheckpoint => ({
    taxtreeId,
    schemaVersion: FAUNA_LEAF_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    reqs,
    queue: [...queue],
    visited: [...visited],
    leaves: [...leaves],
    done: queue.length === 0,
  })

  while (queue.length) {
    if (opts.shouldStop?.()) break

    const id = queue.shift()!
    queued.delete(id)
    if (visited.has(id)) continue

    const parentArg = id === TREE_ROOT_TOKEN ? undefined : id
    const kids = await fetchTreeChildren(parentArg, taxtreeId)
    visited.add(id)
    reqs += 1

    for (const k of kids) {
      const label = stripHtml(k.name || '')
      const binomial = scientificFromTreeLabel(k.name || '')
      // 种 / 亚种：有属+种加词即入库（种常为 isParent，因其下还有亚种）
      if (binomial && k.id && !seenLeafIds.has(k.id)) {
        seenLeafIds.add(k.id)
        leaves.push({ taxonId: k.id, binomial, label })
      }
      if (k.isParent && k.id && !visited.has(k.id) && !queued.has(k.id)) {
        queued.add(k.id)
        queue.push(k.id)
      }
    }

    opts.onProgress?.({
      reqs,
      leaves: leaves.length,
      queue: queue.length,
      checkpoint: snapshot(),
    })
    if (delayMs > 0) await sleep(delayMs)
  }

  return { leaves, checkpoint: snapshot() }
}
