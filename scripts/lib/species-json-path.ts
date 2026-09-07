/** 物种路径与详情 JSON 加载（相对 public/） */

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

/** public/species/{门}/{纲}/{目}/{科}/{属}/{slug}.json */
export function speciesJsonRelPath(s: SpeciesPathParts): string {
  return [
    'species',
    safePathSegment(s.phylum.latin),
    safePathSegment(s.class.latin),
    safePathSegment(s.order.latin),
    safePathSegment(s.family.latin),
    safePathSegment(s.genus.latin),
    `${s.slug}.json`,
  ].join('/')
}

export function speciesJsonUrl(s: SpeciesPathParts): string {
  return `${import.meta.env.BASE_URL}${speciesJsonRelPath(s)}`
}

/** @deprecated 旧 Markdown 路径，迁移期兼容 */
export function speciesMdRelPath(s: SpeciesPathParts): string {
  return speciesJsonRelPath(s).replace(/\.json$/, '.md')
}
