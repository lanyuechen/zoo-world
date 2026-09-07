import type { SpeciesDetail } from '../types/species'
import { speciesJsonRelPath } from './species-path'

export function speciesJsonUrl(
  s: {
    jsonPath?: string
    phylum: { latin: string }
    class: { latin: string }
    order: { latin: string }
    family: { latin: string }
    genus: { latin: string }
    slug: string
  },
): string {
  const rel = s.jsonPath || speciesJsonRelPath(s)
  return `${import.meta.env.BASE_URL}${rel}`
}

/** 按需拉取物种富数据 JSON；无文件返回 null */
export async function fetchSpeciesDetail(
  s: Parameters<typeof speciesJsonUrl>[0],
): Promise<SpeciesDetail | null> {
  const res = await fetch(speciesJsonUrl(s))
  if (!res.ok) return null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/html')) return null
  try {
    return (await res.json()) as SpeciesDetail
  } catch {
    return null
  }
}
