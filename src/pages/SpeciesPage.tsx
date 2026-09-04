import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findSpeciesBySlug } from '../lib/catalogue'
import type { SpeciesRecord } from '../types/species'

export default function SpeciesPage() {
  const { slug = '' } = useParams()
  const [species, setSpecies] = useState<SpeciesRecord | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setSpecies(undefined)
    findSpeciesBySlug(decodeURIComponent(slug)).then((s) => {
      if (!cancelled) setSpecies(s ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (species === undefined) {
    return <p className="loading">载入物种…</p>
  }

  if (!species) {
    return (
      <div className="page">
        <p>未找到该物种。</p>
        <Link to="/search">去检索</Link>
      </div>
    )
  }

  const lineage = [
    {
      rank: '界',
      ...species.kingdom,
      path: [species.kingdom.latin],
    },
    {
      rank: '门',
      ...species.phylum,
      path: [species.kingdom.latin, species.phylum.latin],
    },
    {
      rank: '纲',
      ...species.class,
      path: [species.kingdom.latin, species.phylum.latin, species.class.latin],
    },
    {
      rank: '目',
      ...species.order,
      path: [
        species.kingdom.latin,
        species.phylum.latin,
        species.class.latin,
        species.order.latin,
      ],
    },
    {
      rank: '科',
      ...species.family,
      path: [
        species.kingdom.latin,
        species.phylum.latin,
        species.class.latin,
        species.order.latin,
        species.family.latin,
      ],
    },
    {
      rank: '属',
      ...species.genus,
      path: [
        species.kingdom.latin,
        species.phylum.latin,
        species.class.latin,
        species.order.latin,
        species.family.latin,
        species.genus.latin,
      ],
    },
  ]

  return (
    <div className="page species-page">
      <header className="species-head">
        <p className="taxon-rank">种</p>
        <h1>{species.chineseName || '（中文名待补）'}</h1>
        <p className="taxon-latin">{species.scientificName}</p>
      </header>

      <dl className="meta-grid">
        <div>
          <dt>主键（拉丁学名）</dt>
          <dd>
            <code>{species.scientificName}</code>
          </dd>
        </div>
        <div>
          <dt>异名</dt>
          <dd>{species.synonyms.length ? species.synonyms.join('；') : '待补充'}</dd>
        </div>
        <div>
          <dt>保护等级</dt>
          <dd>
            {species.status ? (
              <span
                className={
                  species.status.includes('一级')
                    ? 'status-badge status-i'
                    : species.status.includes('二级')
                      ? 'status-badge status-ii'
                      : 'status-badge'
                }
              >
                {species.status}
              </span>
            ) : (
              '待补充'
            )}
          </dd>
        </div>
        <div>
          <dt>红色名录</dt>
          <dd>
            {species.redList ? (
              <span
                className={`status-badge status-redlist status-redlist-${(species.redListCategory || '').toLowerCase()}`}
              >
                {species.redList}
              </span>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {species.kingdom.latin === 'Animalia' && (
          <div>
            <dt>三有名录</dt>
            <dd>
              {species.sanyou ? (
                <span className="status-badge status-sanyou">是 · 三有</span>
              ) : (
                '否'
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>国内分布</dt>
          <dd>
            {species.distribution.length ? species.distribution.join('、') : '待补充'}
          </dd>
        </div>
        <div>
          <dt>审核 / 数据源</dt>
          <dd>{species.reviewedBy || '—'}</dd>
        </div>
        <div>
          <dt>Markdown</dt>
          <dd>
            <code>content/{species.mdPath}</code>
          </dd>
        </div>
      </dl>

      <section className="lineage">
        <h2>分类位置</h2>
        <ol>
          {lineage.map((t) => (
            <li key={t.latin}>
              <span className="lin-rank">{t.rank}</span>
              <Link to={`/browse/${t.path.map(encodeURIComponent).join('/')}`}>
                {t.chinese || t.latin} <em>{t.latin}</em>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="intro-block">
        <h2>介绍</h2>
        {species.intro ? (
          <div className="intro-body">{species.intro}</div>
        ) : (
          <p className="empty">
            科普文本待补充。编辑对应 Markdown 正文后运行 npm run sync:content。
          </p>
        )}
      </section>

      <section className="media-block">
        <h2>影像</h2>
        <p className="empty">图片资源待补充。</p>
      </section>
    </div>
  )
}
