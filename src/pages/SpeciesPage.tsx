import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import SpeciesDistributionMap from '../components/SpeciesDistributionMap'
import IntroMarkdown from '../components/IntroMarkdown'
import TaxonCrumbs from '../components/TaxonCrumbs'
import { findSpeciesBySlug, type AppCatalogue } from '../lib/catalogue'
import { fetchSpeciesIntro } from '../lib/intro-md'
import type { SpeciesRecord } from '../types/species'

export default function SpeciesPage() {
  const data = useOutletContext<AppCatalogue>()
  const { slug = '' } = useParams()
  const [species, setSpecies] = useState<SpeciesRecord | null | undefined>(undefined)
  const [intro, setIntro] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setSpecies(undefined)
    setIntro(undefined)
    findSpeciesBySlug(decodeURIComponent(slug)).then((s) => {
      if (!cancelled) setSpecies(s ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (!species) {
      setIntro(undefined)
      return
    }
    let cancelled = false
    setIntro(undefined)
    fetchSpeciesIntro(species).then((text) => {
      if (!cancelled) setIntro(text)
    })
    return () => {
      cancelled = true
    }
  }, [species])

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

  const crumbs = [
    { to: '/browse', chinese: data.taxonomy.chinese, latin: data.taxonomy.latin },
    ...lineage.map((t) => ({
      to: `/browse/${t.path.map(encodeURIComponent).join('/')}`,
      chinese: t.chinese || t.latin,
      latin: t.latin,
    })),
    {
      to: `/species/${encodeURIComponent(species.slug)}`,
      chinese: species.chineseName || '（中文名待补）',
      latin: species.scientificName,
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

  return (
    <div className="page species-page">
      <TaxonCrumbs items={crumbs} />

      <header className="species-head">
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

      <section className="intro-block">
        <h2>介绍</h2>
        {intro === undefined ? (
          <p className="loading">载入介绍…</p>
        ) : intro ? (
          <IntroMarkdown source={intro} />
        ) : (
          <p className="empty">科普文本待补充。</p>
        )}
      </section>

      <SpeciesDistributionMap
        scientificName={species.scientificName}
        knownProvinces={species.distribution}
      />

      <section className="media-block">
        <h2>影像</h2>
        <p className="empty">图片资源待补充。</p>
      </section>
    </div>
  )
}
