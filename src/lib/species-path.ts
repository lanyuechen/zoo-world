/** 物种详情 JSON 相对路径（与 scripts/lib/species-json-path 一致） */

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
