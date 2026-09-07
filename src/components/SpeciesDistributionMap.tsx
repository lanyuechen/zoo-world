import { useEffect, useMemo, useState } from 'react'
import { occurrencesFromDetail, type GbifChinaOccurrences } from '../lib/gbif'
import { normalizeProvince, sortProvinces } from '../lib/provinces'
import type { SpeciesDetail } from '../types/species'

const LNG_MIN = 73
const LNG_MAX = 135
const LAT_MIN = 17
const LAT_MAX = 54
const W = 720
const H = 520
const PAD = 12

type Ring = [number, number][]
type Polygon = Ring[]
type MultiPolygon = Polygon[]

interface GeoFeature {
  type: 'Feature'
  properties: { name?: string; adcode?: number | string }
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: Polygon | MultiPolygon
  }
}

interface GeoCollection {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

function project(lat: number, lng: number): { x: number; y: number } {
  const x = PAD + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * (W - PAD * 2)
  const y = PAD + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (H - PAD * 2)
  return { x, y }
}

function ringToPath(ring: Ring): string {
  if (!ring.length) return ''
  return ring
    .map(([lng, lat], i) => {
      const { x, y } = project(lat, lng)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
    .concat(' Z')
}

function geometryToPath(geometry: GeoFeature['geometry']): string {
  const polys: Polygon[] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Polygon]
      : (geometry.coordinates as MultiPolygon)
  return polys.map((poly) => poly.map(ringToPath).join(' ')).join(' ')
}

interface Props {
  scientificName: string
  detail: SpeciesDetail | null | undefined
}

export default function SpeciesDistributionMap({ scientificName, detail }: Props) {
  const [geo, setGeo] = useState<GeoCollection | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}data/maps/china-provinces.json`)
      .then((r) => {
        if (!r.ok) throw new Error('底图加载失败')
        return r.json() as Promise<GeoCollection>
      })
      .then((g) => {
        if (!cancelled) setGeo(g)
      })
      .catch(() => {
        if (!cancelled) setGeo(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loading = detail === undefined
  const data: GbifChinaOccurrences | null = useMemo(() => {
    if (loading) return null
    return occurrencesFromDetail(scientificName, detail)
  }, [scientificName, detail, loading])
  const provinces = sortProvinces(data?.provinces || [])
  const provinceSet = useMemo(() => new Set(provinces), [provinces.join('|')])

  const paths = useMemo(() => {
    if (!geo) return []
    return geo.features.map((f, i) => {
      const name = f.properties.name || ''
      const short = normalizeProvince(name)
      return {
        key: String(f.properties.adcode ?? (name || i)),
        name,
        d: geometryToPath(f.geometry),
        active: short ? provinceSet.has(short) : false,
      }
    })
  }, [geo, provinceSet])

  return (
    <section className="distribution-map-block">
      <h2>分布</h2>
      {provinces.length > 0 ? (
        <p className="distribution-provinces">{provinces.join('、')}</p>
      ) : (
        !loading && <p className="empty">暂无省级分布信息</p>
      )}

      <div className="distribution-map-frame" aria-label="中国分布点位图">
        <svg
          className="distribution-map"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${scientificName} 在中国的分布`}
        >
          <rect x="0" y="0" width={W} height={H} className="map-bg" />

          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              className={p.active ? 'map-province map-province-active' : 'map-province'}
            >
              {p.name ? <title>{p.name}</title> : null}
            </path>
          ))}

          {!loading &&
            data?.points.map((p) => {
              const { x, y } = project(p.lat, p.lng)
              return <circle key={String(p.key)} cx={x} cy={y} r={2.8} className="map-point" />
            })}
        </svg>

        {loading && <p className="empty map-status map-status-overlay">载入分布点…</p>}
        {!loading && data && data.points.length === 0 && (
          <p className="empty map-status map-status-overlay">暂无中国境内坐标记录。</p>
        )}
      </div>

      {data && data.points.length > 0 && (
        <p className="distribution-map-meta">
          展示 {data.points.length.toLocaleString()} 个中国境内坐标点 ·{' '}
          <a href={data.sourceUrl} target="_blank" rel="noreferrer">
            在 GBIF 查看
          </a>
        </p>
      )}
    </section>
  )
}
