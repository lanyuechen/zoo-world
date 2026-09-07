/**
 * Intro Markdown 处理流水线。
 * 抓取写入与后期对已有 JSON 再处理共用此入口；新增步骤加到 INTRO_STEPS 即可。
 *
 * v5：量衡度无空格粘连表按列名拆分数据行（均值+范围）。
 */
import { convertMeasureTables } from '../measure-table'

/** intro 处理流水线版本；变更处理语义时递增，便于筛旧数据重跑 */
export const INTRO_PIPELINE_VERSION = 'v5'

export type IntroProcessContext = {
  scientificName?: string
  chineseName?: string
  pipelineVersion: string
}

export type IntroStep = {
  id: string
  description: string
  run: (md: string, ctx: IntroProcessContext) => string
}

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

/** 保留换行；只整理行尾空白与过多空行 */
function paragraphize(text: string): string {
  if (!text.trim()) return ''
  if (text.includes('| ---')) return text
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeSectionBody(title: string, body: string): string {
  if (title === '参考文献') return ''
  let t = stripSectionPrefix(title, body)
  t = convertMeasureTables(t)

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

type HeadingBlock = { level: 2 | 3 | null; title: string | null; body: string }

function splitByHeadings(text: string): HeadingBlock[] {
  const lines = text.split('\n')
  const out: HeadingBlock[] = []
  let cur: HeadingBlock = { level: null, title: null, body: '' }

  const push = () => {
    if (cur.title != null || cur.body.trim()) out.push(cur)
  }

  for (const line of lines) {
    const h2 = line.match(/^## (.+)$/)
    const h3 = line.match(/^### (.+)$/)
    if (h2 || h3) {
      push()
      cur = {
        level: h2 ? 2 : 3,
        title: (h2 || h3)![1].trim(),
        body: '',
      }
      continue
    }
    cur.body += (cur.body ? '\n' : '') + line
  }
  push()
  return out
}

const stepNormalizeEol: IntroStep = {
  id: 'normalize-eol',
  description: '统一换行符',
  run: (md) => md.replace(/\r\n/g, '\n').replace(/\r/g, ''),
}

/** 表格规范化（量衡度等）；后续还可继续加强不规范表修复 */
const stepMeasureTables: IntroStep = {
  id: 'measure-tables',
  description: '量衡度空格/粘连表 → Markdown 表（按列名拆分无空格数据）',
  run: (md) => convertMeasureTables(md.trim()),
}

const stepSections: IntroStep = {
  id: 'sections',
  description: '章节切分、去参考文献、段首前缀、保留段内换行',
  run: (md) => {
    const blocks = splitByHeadings(md.trim())
    const out: string[] = []
    for (const b of blocks) {
      if (b.title == null) {
        const preamble = paragraphize(b.body)
        if (preamble) out.push(preamble, '')
        continue
      }
      if (b.title === '参考文献') continue
      const mark = b.level === 2 ? '##' : '###'
      const body = b.body
      const srcMatch = body.match(/\n(> 来源：[\s\S]*)$/)
      let main = body
      let source = ''
      if (srcMatch) {
        main = body.slice(0, srcMatch.index)
        source = srcMatch[1].trim()
      }
      out.push(`${mark} ${b.title}`, '', normalizeSectionBody(b.title, main), '')
      if (source) out.push(source, '')
    }
    return out.join('\n')
  },
}

const stepFixDecimals: IntroStep = {
  id: 'fix-decimals',
  description: '数字间中文点号（．）→ 英文小数点',
  run: (md) =>
    md
      // 19．6 / 19 ． 6 → 19.6（不含句号「。」）
      .replace(/(?<=[\d０-９])\s*．\s*(?=[\d０-９])/g, '.')
      // 全角数字转半角，便于后续一致
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)),
}

const PUNCT_ONLY =
  /^[\s;；。．、，,.\-—–…·•*_~`'"“”‘’（）()【】[\]{}<>！!？?：:/\\|]+$/

const stepDropNoiseLines: IntroStep = {
  id: 'drop-noise-lines',
  description: '去除仅含标点的无意义行（如 ; / ；）',
  run: (md) =>
    md
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        if (!t) return true
        if (
          t.startsWith('#') ||
          t.startsWith('|') ||
          t.startsWith('>') ||
          t.startsWith('- ') ||
          t.startsWith('* ') ||
          t.startsWith('**')
        ) {
          return true
        }
        return !PUNCT_ONLY.test(t)
      })
      .join('\n'),
}

const stepTidyBlankLines: IntroStep = {
  id: 'tidy-blank-lines',
  description: '去除多余空行',
  run: (md) =>
    md
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '\n'),
}

/** 有序步骤；往后加处理只需 append */
export const INTRO_STEPS: IntroStep[] = [
  stepNormalizeEol,
  stepMeasureTables,
  stepSections,
  stepFixDecimals,
  stepDropNoiseLines,
  stepTidyBlankLines,
]

export function processIntro(
  md: string,
  ctx: Partial<IntroProcessContext> = {},
): string {
  if (!md?.trim()) return ''
  const fullCtx: IntroProcessContext = {
    pipelineVersion: INTRO_PIPELINE_VERSION,
    ...ctx,
  }
  let out = md
  for (const step of INTRO_STEPS) {
    out = step.run(out, fullCtx)
  }
  return out
}

/** 兼容旧名 */
export function normalizeFaunaInner(inner: string): string {
  return processIntro(inner)
}
