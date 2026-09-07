/**
 * 《中国动物志数据库》左侧分类树（zTree async）。
 * 页面：http://www.zoology.csdb.cn/dba/fauna
 * 接口：GET /search/taxtree/rest/showChildren?taxtreeId=…&id=…
 *
 * 叶节点 isParent=false，id 即 taxon UUID，可直接拉 description/view。
 */
import fs from 'node:fs'
import path from 'node:path'

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
  binomial: string
  label: string
}

export interface FaunaLeafIndex {
  taxtreeId: string
  builtAt: string
  leafCount: number
  /** binomialKey → taxonId（同名多叶时保留先出现的） */
  byBinomial: Record<string, string>
  leaves: FaunaLeaf[]
  /** 未完成时为 true；enrich 可用部分索引，但应尽量等 done */
  partial?: boolean
}

/** 断点：队列 + 已收集叶 + 已展开父节点 */
export interface FaunaTreeCheckpoint {
  taxtreeId: string
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

/** 树节点显示名："Chrysolophus pictus 红腹锦鸡(金鸡)" → 二项式 */
export function binomialFromTreeLabel(label: string): string {
  const plain = stripHtml(label)
  const m = plain.match(/^([A-Za-z][A-Za-z0-9-]*)\s+([a-z][a-z0-9-]*)\b/)
  if (!m) return ''
  return binomialKey(`${m[1]} ${m[2]}`)
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
      if (k.isParent) {
        if (!visited.has(k.id) && !queued.has(k.id)) {
          queued.add(k.id)
          queue.push(k.id)
        }
      } else {
        const label = stripHtml(k.name || '')
        const binomial = binomialFromTreeLabel(k.name || '')
        if (binomial && k.id && !seenLeafIds.has(k.id)) {
          seenLeafIds.add(k.id)
          leaves.push({ taxonId: k.id, binomial, label })
        }
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
