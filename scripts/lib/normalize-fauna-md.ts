/**
 * 《中国动物志》抓取正文规范化（兼容层）。
 * 实际流水线见 ./intro/pipeline.ts；新步骤请加到 INTRO_STEPS。
 */

import { processIntro } from './intro'

export {
  INTRO_PIPELINE_VERSION,
  INTRO_STEPS,
  processIntro,
  normalizeFaunaInner,
} from './intro'
export { convertMeasureTables } from './measure-table'
export { FAUNA_ENRICH_PACK } from './fauna-pack'

const MARK_START = '<!-- fauna-sinica:start -->'
const MARK_END = '<!-- fauna-sinica:end -->'

export function normalizeFaunaMarkdownFile(raw: string): string {
  if (raw.includes(MARK_START) && raw.includes(MARK_END)) {
    return raw.replace(
      new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`),
      (_m, inner: string) => `${MARK_START}\n${processIntro(inner.trim())}${MARK_END}`,
    )
  }
  if (!raw.startsWith('---\n')) return processIntro(raw)
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return processIntro(raw)
  const fm = raw.slice(0, end + 5)
  const body = raw.slice(end + 5)
  return `${fm}\n${processIntro(body.trim())}`
}
