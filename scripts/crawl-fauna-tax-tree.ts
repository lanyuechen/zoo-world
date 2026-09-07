/**
 * 爬取《中国动物志数据库》左侧分类树中的种/亚种节点，边爬边落盘（可断点续跑）。
 * 种下有亚种时：种与亚种均入库。
 *
 *   npm run enrich:fauna:tree
 *   npm run enrich:fauna:tree -- --force          # 清空断点重来（schema 变更后必须）
 *   npm run enrich:fauna:tree -- --delay=60
 *
 * 文件：
 *   data/fauna/tax-tree-checkpoint.json  队列+叶（续跑）
 *   data/fauna/tax-tree-leaves.json      可供 enrich 使用的索引（爬中也写 partial）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildLeafIndex,
  crawlFaunaLeaves,
  defaultCheckpointPath,
  defaultLeafIndexPath,
  FAUNA_LEAF_INDEX_VERSION,
  loadCheckpoint,
  loadLeafIndex,
  saveCheckpoint,
  saveLeafIndex,
  type FaunaTreeCheckpoint,
} from './lib/fauna-tax-tree'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const STATE_DIR = path.join(ROOT, 'data', 'fauna')
const OUT = defaultLeafIndexPath(STATE_DIR)
const CHECKPOINT = defaultCheckpointPath(STATE_DIR)

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const DELAY_MS = Number(args.find((a) => a.startsWith('--delay='))?.slice(8) || 80)

let stopping = false
function armSignals() {
  const stop = (sig: string) => {
    if (stopping) return
    stopping = true
    console.log(`收到 ${sig}，将在当前节点后保存断点并退出…`)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
}

function persist(cp: FaunaTreeCheckpoint, final: boolean) {
  saveCheckpoint(CHECKPOINT, { ...cp, done: final ? cp.done : false })
  const index = buildLeafIndex(cp.leaves, {
    taxtreeId: cp.taxtreeId,
    partial: !final || !cp.done,
  })
  if (final && cp.done) {
    delete index.partial
  }
  saveLeafIndex(OUT, index)
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true })

  if (FORCE) {
    for (const f of [CHECKPOINT, OUT, `${OUT}.tmp`, `${CHECKPOINT}.tmp`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    console.log('--force：已清空断点与索引，从头爬取')
  }

  const existingDone = loadLeafIndex(OUT)
  const existingCp = !FORCE ? loadCheckpoint(CHECKPOINT) : null
  const staleSchema =
    (existingDone && (existingDone.schemaVersion ?? 1) < FAUNA_LEAF_INDEX_VERSION) ||
    (existingCp && (existingCp.schemaVersion ?? 1) < FAUNA_LEAF_INDEX_VERSION)

  if (!FORCE && staleSchema) {
    console.error(
      `索引/断点为旧语义（schemaVersion < ${FAUNA_LEAF_INDEX_VERSION}：种有亚种时未入库）。` +
        `请加 --force 重建：npm run enrich:fauna:tree -- --force`,
    )
    process.exit(1)
  }

  if (!FORCE && existingDone?.leafCount && !existingDone.partial) {
    const cp = existingCp
    if (!cp || cp.done) {
      console.log(`已有完整索引 ${OUT}（${existingDone.leafCount} 叶，${existingDone.builtAt}）。加 --force 重建。`)
      return
    }
  }

  let start: FaunaTreeCheckpoint | null = null
  if (!FORCE) {
    start = existingCp
    if (start?.done) {
      console.log(`断点已标记完成（${start.leaves.length} 叶）。加 --force 重建。`)
      persist(start, true)
      return
    }
    if (start?.leaves?.length || start?.queue?.length) {
      console.log(
        `续跑断点：leaves=${start.leaves.length} queue=${start.queue.length} reqs=${start.reqs}（${start.updatedAt}）`,
      )
    } else {
      start = null
    }
  }

  armSignals()
  console.log(`开始爬取动物志分类树（delay=${DELAY_MS}ms）`)
  console.log(`断点：${CHECKPOINT}`)
  console.log(`索引：${OUT}（边爬边写）`)

  let lastLog = 0
  let lastSave = 0

  const { leaves, checkpoint } = await crawlFaunaLeaves({
    delayMs: DELAY_MS,
    checkpoint: start,
    shouldStop: () => stopping,
    onProgress: ({ reqs, leaves: n, queue, checkpoint: cp }) => {
      const now = Date.now()
      if (reqs === 1 || now - lastLog > 5000) {
        lastLog = now
        console.log(`… reqs=${reqs} leaves=${n} queue=${queue}`)
      }
      if (now - lastSave > 10000) {
        lastSave = now
        persist(cp, false)
      }
    },
  })

  const finalCp = checkpoint
  persist(finalCp, true)

  if (stopping && !finalCp.done) {
    console.log(
      `已中断并保存：leaves=${leaves.length} queue=${finalCp.queue.length} → ${CHECKPOINT}`,
    )
    console.log(`部分索引已写入 ${OUT}（partial）。下次直接 npm run enrich:fauna:tree 续跑。`)
    process.exit(0)
  }

  const index = buildLeafIndex(leaves)
  console.log(
    `完成：${leaves.length} 个种/亚种节点，唯一学名 ${Object.keys(index.byBinomial).length}（schema v${FAUNA_LEAF_INDEX_VERSION}）`,
  )
  console.log(`写入 ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
