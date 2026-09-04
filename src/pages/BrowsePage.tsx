import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  filterSpecies,
  loadPhylumSpecies,
  walkTaxonomy,
  type AppCatalogue,
} from '../lib/catalogue'
import type { SpeciesRecord } from '../types/species'

const RANK_ZH: Record<string, string> = {
  kingdom: '界',
  phylum: '门',
  class: '纲',
  order: '目',
  family: '科',
  genus: '属',
}

export default function BrowsePage() {
  const data = useOutletContext<AppCatalogue>()
  const params = useParams()
  const splat = params['*'] || ''
  const pathParts = splat
    .split('/')
    .map((p) => decodeURIComponent(p))
    .filter(Boolean)

  const node =
    pathParts.length === 0 ? data.taxonomy : walkTaxonomy(data.taxonomy, pathParts)

  const [species, setSpecies] = useState<SpeciesRecord[] | null>(null)
  const [loadingSpecies, setLoadingSpecies] = useState(false)

  const phylumLatin = pathParts[0]
  const atGenus = node?.rank === 'genus'

  useEffect(() => {
    if (!node || !phylumLatin || !atGenus) {
      setSpecies(null)
      return
    }
    let cancelled = false
    setLoadingSpecies(true)
    loadPhylumSpecies(phylumLatin)
      .then((list) => {
        if (cancelled) return
        const genus = pathParts[pathParts.length - 1]
        setSpecies(filterSpecies(list, pathParts.slice(0, -1), genus))
      })
      .finally(() => {
        if (!cancelled) setLoadingSpecies(false)
      })
    return () => {
      cancelled = true
    }
  }, [node, phylumLatin, atGenus, pathParts.join('/')])

  if (!node) {
    return (
      <div className="page">
        <p>未找到该分类阶元。</p>
        <Link to="/browse">返回动物界</Link>
      </div>
    )
  }

  const crumbs: { to: string; label: string }[] = [
    { to: '/browse', label: `${data.taxonomy.chinese} · ${data.taxonomy.latin}` },
  ]
  pathParts.forEach((latin, i) => {
    const n = walkTaxonomy(data.taxonomy, pathParts.slice(0, i + 1))
    crumbs.push({
      to: `/browse/${pathParts
        .slice(0, i + 1)
        .map(encodeURIComponent)
        .join('/')}`,
      label: n ? `${n.chinese || latin} · ${n.latin}` : latin,
    })
  })

  const children = node.children ?? []

  return (
    <div className="page browse-page">
      <nav className="crumbs" aria-label="分类路径">
        {crumbs.map((c, i) => (
          <span key={c.to}>
            {i > 0 && <span className="crumbs-sep">/</span>}
            {i === crumbs.length - 1 ? (
              <span className="crumbs-current">{c.label}</span>
            ) : (
              <Link to={c.to}>{c.label}</Link>
            )}
          </span>
        ))}
      </nav>

      <header className="taxon-head">
        <p className="taxon-rank">{RANK_ZH[node.rank] || node.rank}</p>
        <h1>{node.chinese || node.latin}</h1>
        <p className="taxon-latin">{node.latin}</p>
        <p className="taxon-count">{node.speciesCount.toLocaleString()} 种</p>
      </header>

      {children.length > 0 && (
        <ul className="taxon-children">
          {children.map((c) => {
            const nextPath = [...pathParts, c.latin].map(encodeURIComponent).join('/')
            return (
              <li key={c.latin}>
                <Link to={`/browse/${nextPath}`}>
                  <span className="child-rank">{RANK_ZH[c.rank]}</span>
                  <span className="child-zh">{c.chinese || '—'}</span>
                  <span className="child-la">{c.latin}</span>
                  <span className="child-count">{c.speciesCount.toLocaleString()}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {atGenus && (
        <>
          {loadingSpecies && <p className="loading">载入物种…</p>}
          {!loadingSpecies && species && (
            <ul className="species-list">
              {species.map((s) => (
                <li key={s.slug}>
                  <Link to={`/species/${encodeURIComponent(s.slug)}`}>
                    <span className="sp-zh">{s.chineseName || '（中文名待补）'}</span>
                    <span className="sp-la">{s.scientificName}</span>
                  </Link>
                </li>
              ))}
              {species.length === 0 && <li className="empty">该属暂无物种记录</li>}
            </ul>
          )}
        </>
      )}

      {!atGenus && children.length === 0 && <p className="empty">无下级分类</p>}
    </div>
  )
}
