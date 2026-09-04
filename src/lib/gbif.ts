import { normalizeProvince, sortProvinces } from './provinces'

const GBIF_API = 'https://api.gbif.org/v1'
const dataBase = `${import.meta.env.BASE_URL}data/`

export interface GbifOccurrencePoint {
  lat: number
  lng: number
  key: number | string
  year?: number | null
}

export interface GbifChinaOccurrences {
  count: number
  points: GbifOccurrencePoint[]
  provinces: string[]
  sourceUrl: string
  fromCache?: boolean
}

interface GbifSearchResult {
  key: number
  decimalLatitude?: number
  decimalLongitude?: number
  year?: number
  stateProvince?: string
}

interface GbifSearchResponse {
  count: number
  results: GbifSearchResult[]
  facets?: { field: string; counts: { name: string; count: number }[] }[]
}

function slugify(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function loadCachedPoints(scientificName: string): Promise<GbifChinaOccurrences | null> {
  const slug = slugify(scientificName)
  if (!slug) return null
  const bucket = slug[0] || '_'
  try {
    const res = await fetch(`${dataBase}gbif-points/${bucket}/${slug}.json`)
    if (!res.ok) return null
    const raw = (await res.json()) as {
      scientificName: string
      count: number
      provinces: string[]
      points: { lat: number; lng: number; key?: string }[]
      sourceUrl?: string
    }
    return {
      count: raw.count,
      points: (raw.points || []).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        key: p.key || `${p.lat},${p.lng}`,
      })),
      provinces: sortProvinces(raw.provinces || []),
      sourceUrl:
        raw.sourceUrl ||
        `https://www.gbif.org/occurrence/search?country=CN&has_coordinate=true&q=${encodeURIComponent(scientificName)}`,
      fromCache: true,
    }
  } catch {
    return null
  }
}

/** 中国境内、有坐标的 occurrence（不做分类主干，仅分布/地图） */
export async function fetchGbifChinaOccurrences(
  scientificName: string,
  limit = 300,
): Promise<GbifChinaOccurrences> {
  const cached = await loadCachedPoints(scientificName)
  if (cached && cached.points.length > 0) return cached

  const params = new URLSearchParams({
    country: 'CN',
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    scientificName,
    limit: String(limit),
    facet: 'stateProvince',
    facetLimit: '50',
  })
  const url = `${GBIF_API}/occurrence/search?${params}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GBIF 请求失败（${res.status}）`)
  const data = (await res.json()) as GbifSearchResponse

  const points: GbifOccurrencePoint[] = []
  const provinceSet = new Set<string>()

  for (const r of data.results || []) {
    const lat = r.decimalLatitude
    const lng = r.decimalLongitude
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    if (lat < 3 || lat > 55 || lng < 70 || lng > 140) continue
    points.push({
      lat,
      lng,
      key: r.key,
      year: typeof r.year === 'number' ? r.year : null,
    })
    const p = normalizeProvince(r.stateProvince)
    if (p) provinceSet.add(p)
  }

  const facet = data.facets?.find(
    (f) => f.field === 'STATE_PROVINCE' || f.field === 'stateProvince',
  )
  if (facet) {
    for (const c of facet.counts) {
      const p = normalizeProvince(c.name)
      if (p) provinceSet.add(p)
    }
  }

  const portal = new URLSearchParams({
    country: 'CN',
    has_coordinate: 'true',
    has_geospatial_issue: 'false',
    q: scientificName,
  })

  return {
    count: data.count ?? points.length,
    points,
    provinces: sortProvinces(provinceSet),
    sourceUrl: `https://www.gbif.org/occurrence/search?${portal}`,
  }
}
