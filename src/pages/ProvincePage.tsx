import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { filterByProvinceAcrossPhyla, type AppCatalogue } from '../lib/catalogue'
import { CHINA_PROVINCES } from '../lib/provinces'
import type { SpeciesRecord } from '../types/species'

export default function ProvincePage() {
  const data = useOutletContext<AppCatalogue>()
  const [province, setProvince] = useState<string>(CHINA_PROVINCES[0])
  const [results, setResults] = useState<SpeciesRecord[]>([])
  const [loading, setLoading] = useState(false)

  const phyla = data.meta.phyla ?? []
  const withDist = data.meta.withDistribution ?? 0

  useEffect(() => {
    if (withDist === 0) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    filterByProvinceAcrossPhyla(phyla, province, 200)
      .then((list) => {
        if (!cancelled) setResults(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [province, withDist, phyla.join('|')])

  return (
    <div className="page province-page">
      <header className="page-head">
        <h1>按省份筛选</h1>
        <p>
          名录 Excel 不含省份；可由 GBIF 中国子集填充（npm run apply:gbif）。已有分布：
          <strong> {withDist.toLocaleString()} </strong>种。
        </p>
      </header>

      <div className="province-picker">
        {CHINA_PROVINCES.map((p) => (
          <button
            key={p}
            type="button"
            className={p === province ? 'chip chip-active' : 'chip'}
            onClick={() => setProvince(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <p className="result-meta">
        {province}：{loading ? '载入中…' : `${results.length}${results.length >= 200 ? '+' : ''} 种`}
      </p>

      {!loading && results.length === 0 ? (
        <p className="empty">
          暂无该省分布记录。可在对应 Markdown 的 distribution 字段中补充后执行 npm run
          sync:content。
        </p>
      ) : (
        <ul className="species-list">
          {results.map((s) => (
            <li key={s.slug}>
              <Link to={`/species/${encodeURIComponent(s.slug)}`}>
                <span className="sp-zh">{s.chineseName || '（中文名待补）'}</span>
                <span className="sp-la">{s.scientificName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
