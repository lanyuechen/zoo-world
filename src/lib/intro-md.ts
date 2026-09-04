import type { SpeciesRecord } from '../types/species'

function safePathSegment(name: string): string {
  const s = name.trim() || '_unknown'
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

/** 相对站点根（含 base）的 Markdown 路径，对应 public/species/... */
export function speciesMdRelPath(
  s: Pick<SpeciesRecord, 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'slug'>,
): string {
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

export function speciesMdUrl(
  s: Pick<SpeciesRecord, 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'slug'>,
): string {
  return `${import.meta.env.BASE_URL}${speciesMdRelPath(s)}`
}

/** 从 Markdown 抽出可展示的 intro；无正文返回空串 */
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

/** 按需拉取介绍；无文件或空正文返回 null */
export async function fetchSpeciesIntro(
  s: Pick<SpeciesRecord, 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'slug'>,
): Promise<string | null> {
  const res = await fetch(speciesMdUrl(s))
  if (!res.ok) return null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/html')) return null
  const raw = await res.text()
  const intro = extractIntroFromMarkdown(raw)
  return intro || null
}
