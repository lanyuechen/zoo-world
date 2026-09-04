import type { CatalogueMeta, SpeciesRecord, TaxonomyNode } from '../types/species'

export interface AppCatalogue {
  meta: CatalogueMeta
  taxonomy: TaxonomyNode
}

type SearchRow = [string, string, string, string] // scientificName, chineseName, slug, phylum

let boot: AppCatalogue | null = null
let searchIndex: SearchRow[] | null = null
let slugIndex: Record<string, string> | null = null
const phylumCache = new Map<string, SpeciesRecord[]>()

const dataBase = `${import.meta.env.BASE_URL}data/`

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`无法加载 ${url}`)
  return res.json() as Promise<T>
}

export async function loadBoot(): Promise<AppCatalogue> {
  if (boot) return boot
  const [meta, taxonomy] = await Promise.all([
    fetchJson<CatalogueMeta>(`${dataBase}meta.json`),
    fetchJson<TaxonomyNode>(`${dataBase}taxonomy.json`),
  ])
  boot = { meta, taxonomy }
  return boot
}

export async function loadSearchIndex(): Promise<SearchRow[]> {
  if (searchIndex) return searchIndex
  searchIndex = await fetchJson<SearchRow[]>(`${dataBase}search-index.json`)
  return searchIndex
}

async function loadSlugIndex(): Promise<Record<string, string>> {
  if (slugIndex) return slugIndex
  slugIndex = await fetchJson<Record<string, string>>(`${dataBase}slug-index.json`)
  return slugIndex
}

export async function loadPhylumSpecies(phylumLatin: string): Promise<SpeciesRecord[]> {
  if (phylumCache.has(phylumLatin)) return phylumCache.get(phylumLatin)!
  const file = phylumLatin.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
  const list = await fetchJson<SpeciesRecord[]>(`${dataBase}species/${file}.json`)
  phylumCache.set(phylumLatin, list)
  return list
}

export async function findSpeciesBySlug(slug: string): Promise<SpeciesRecord | undefined> {
  const map = await loadSlugIndex()
  const phylum = map[slug]
  if (!phylum) return undefined
  const list = await loadPhylumSpecies(phylum)
  return list.find((s) => s.slug === slug)
}

export function searchInIndex(rows: SearchRow[], query: string, limit = 80): SearchRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { row: SearchRow; score: number }[] = []
  for (const row of rows) {
    const latin = row[0].toLowerCase()
    const zh = (row[1] || '').toLowerCase()
    let score = 0
    if (latin === q || zh === q) score = 100
    else if (latin.startsWith(q) || zh.startsWith(q)) score = 80
    else if (latin.includes(q) || zh.includes(q)) score = 50
    if (score > 0) scored.push({ row, score })
  }
  scored.sort((a, b) => b.score - a.score || a.row[0].localeCompare(b.row[0]))
  return scored.slice(0, limit).map((x) => x.row)
}

export function filterSpecies(
  list: SpeciesRecord[],
  filters: {
    kingdom?: string
    phylum?: string
    class?: string
    order?: string
    family?: string
    genus?: string
  },
): SpeciesRecord[] {
  return list.filter((s) => {
    if (filters.kingdom && s.kingdom.latin !== filters.kingdom) return false
    if (filters.phylum && s.phylum.latin !== filters.phylum) return false
    if (filters.class && s.class.latin !== filters.class) return false
    if (filters.order && s.order.latin !== filters.order) return false
    if (filters.family && s.family.latin !== filters.family) return false
    if (filters.genus && s.genus.latin !== filters.genus) return false
    return true
  })
}

/** 沿路径收集各阶元拉丁名 */
export function pathRankFilters(
  root: TaxonomyNode,
  path: string[],
): Partial<Record<'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus', string>> {
  const filters: Partial<
    Record<'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus', string>
  > = {}
  let node: TaxonomyNode = root
  for (const latin of path) {
    const next = node.children?.find((c) => c.latin === latin)
    if (!next) break
    if (
      next.rank === 'kingdom' ||
      next.rank === 'phylum' ||
      next.rank === 'class' ||
      next.rank === 'order' ||
      next.rank === 'family' ||
      next.rank === 'genus'
    ) {
      filters[next.rank] = next.latin
    }
    node = next
  }
  return filters
}

export function walkTaxonomy(root: TaxonomyNode, path: string[]): TaxonomyNode | null {
  let node: TaxonomyNode = root
  for (const latin of path) {
    const next = node.children?.find((c) => c.latin === latin)
    if (!next) return null
    node = next
  }
  return node
}

export async function filterByProvinceAcrossPhyla(
  phyla: string[],
  province: string,
  limit = 200,
): Promise<SpeciesRecord[]> {
  const out: SpeciesRecord[] = []
  for (const phylum of phyla) {
    const list = await loadPhylumSpecies(phylum)
    for (const s of list) {
      if (s.distribution.includes(province)) {
        out.push(s)
        if (out.length >= limit) return out
      }
    }
  }
  return out
}
