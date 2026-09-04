/** Markdown 相对 public/ 的路径：species/{门}/{纲}/{目}/{科}/{属}/{slug}.md */

export function safePathSegment(name: string): string {
  const s = name.trim() || '_unknown'
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

export interface SpeciesPathParts {
  phylum: { latin: string }
  class: { latin: string }
  order: { latin: string }
  family: { latin: string }
  genus: { latin: string }
  slug: string
}

export function speciesMdRelPath(s: SpeciesPathParts): string {
  return [
    'species',
    safePathSegment(s.phylum.latin),
    safePathSegment(s.class.latin),
    safePathSegment(s.order.latin),
    safePathSegment(s.family.latin),
    safePathSegment(s.genus.latin),
    `${s.slug}.md`,
  ].join('/')
}

/** 从 Markdown 抽出可展示的 intro 正文；无正文返回空串 */
export function extractIntroFromMarkdown(raw: string): string {
  if (!raw.startsWith('---\n')) return ''
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return ''
  const body = raw.slice(end + 5)
  let intro = body
    .replace(/^# [^#\n].*$/m, '')
    .replace(/^\*\*[^*]+\*\*\s*$/m, '')
    .replace(/^>\s*科普介绍待补充。\s*$/m, '')
    .trim()
  if (intro.includes('<!-- fauna-sinica:start -->')) {
    intro = intro
      .replace(/<!-- fauna-sinica:start -->\s*/g, '')
      .replace(/\s*<!-- fauna-sinica:end -->/g, '')
      .replace(/^# [^#\n].*$/m, '')
      .replace(/^\*\*[^*]+\*\*\s*$/m, '')
      .trim()
  }
  return intro
}
