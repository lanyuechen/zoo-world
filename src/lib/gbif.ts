import type { SpeciesDetail, SpeciesLocationPoint } from '../types/species'

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
}

/** 中国境内坐标框（与抓取/迁移一致） */
export function isChinaPoint(lat: number, lng: number): boolean {
  return lat >= 3 && lat <= 55 && lng >= 70 && lng <= 140
}

/** 从物种详情的 locations（仅国内）生成地图数据；不再请求 GBIF API / gbif-points */
export function occurrencesFromDetail(
  detail: Pick<SpeciesDetail, 'locations' | 'provinces'> | null | undefined,
): GbifChinaOccurrences {
  const locations = (detail?.locations || []).filter((p) => isChinaPoint(p.lat, p.lng))
  const points: GbifOccurrencePoint[] = locations.map((p: SpeciesLocationPoint) => ({
    lat: p.lat,
    lng: p.lng,
    key: p.key ?? `${p.lat},${p.lng}`,
    year: p.year ?? null,
  }))
  return {
    count: points.length,
    points,
    provinces: detail?.provinces || [],
  }
}
