import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SpeciesDistributionMap from '../components/SpeciesDistributionMap'
import IntroMarkdown from '../components/IntroMarkdown'
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

  const statusTags = [
    species.status
      ? {
          key: 'status',
          label: species.status,
          className: species.status.includes('一级')
            ? 'status-badge status-i'
            : species.status.includes('二级')
              ? 'status-badge status-ii'
              : 'status-badge',
        }
      : null,
    species.redList
      ? {
          key: 'redlist',
          label: species.redList,
          className: `status-badge status-redlist status-redlist-${(species.redListCategory || '').toLowerCase()}`,
        }
      : null,
    species.sanyou
      ? {
          key: 'sanyou',
          label: '三有',
          className: 'status-badge status-sanyou',
        }
      : null,
  ].filter(Boolean) as { key: string; label: string; className: string }[]

  const mdDisplayPath = (() => {
    const seg = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
    // 与磁盘一致：content/species/{门}/{纲}/{目}/{科}/{属}/{slug}.md
    return [
      'content/species',
      seg(species.phylum.latin),
      seg(species.class.latin),
      seg(species.order.latin),
      seg(species.family.latin),
      seg(species.genus.latin),
      `${species.slug}.md`,
    ].join('/')
  })()

  return (
    <div className="page species-page">
      <header className="species-head">
        <p className="taxon-rank">种</p>
        <h1>{species.chineseName || '（中文名待补）'}</h1>
        <p className="taxon-latin">
          {species.scientificName}
          {species.synonyms.length > 0 && (
            <span className="taxon-synonyms">（{species.synonyms.join('；')}）</span>
          )}
        </p>
        {statusTags.length > 0 && (
          <ul className="species-status-tags">
            {statusTags.map((tag) => (
              <li key={tag.key}>
                <span className={tag.className}>{tag.label}</span>
              </li>
            ))}
          </ul>
        )}
      </header>

      <dl className="meta-grid">
        <div>
          <dt>Markdown</dt>
          <dd>
            <code>{mdDisplayPath}</code>
          </dd>
        </div>
      </dl>

      <SpeciesDistributionMap
        scientificName={species.scientificName}
        knownProvinces={species.distribution}
      />

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
          <IntroMarkdown source={species.intro} />
        ) : (
          <p className="empty">
            科普文本待补充。编辑对应 Markdown 正文后运行 npm run merge:intro。
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
