import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadSearchIndex, searchInIndex } from '../lib/catalogue'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(params.get('q') || '')
  const [ready, setReady] = useState(false)
  const [results, setResults] = useState<[string, string, string, string][]>([])

  const q = params.get('q') || ''

  useEffect(() => {
    let cancelled = false
    loadSearchIndex().then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    loadSearchIndex().then((rows) => {
      if (cancelled) return
      setResults(q.trim() ? searchInIndex(rows, q, 100) : [])
    })
    return () => {
      cancelled = true
    }
  }, [q, ready])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = input.trim()
    setParams(next ? { q: next } : {})
  }

  return (
    <div className="page search-page">
      <header className="page-head">
        <h1>物种检索</h1>
        <p>支持拉丁学名、中文名；异名字段预留，数据补齐后自动可搜。</p>
      </header>

      <form className="search-form" onSubmit={onSubmit}>
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如：Panthera tigris / 虎"
          autoFocus
        />
        <button type="submit" className="btn btn-primary">
          检索
        </button>
      </form>

      {!ready && <p className="loading">正在载入检索索引…</p>}

      {ready && q && (
        <p className="result-meta">
          「{q}」→ {results.length} 条
          {results.length >= 100 ? '（显示前 100）' : ''}
        </p>
      )}

      <ul className="species-list">
        {results.map(([scientificName, chineseName, slug, phylum]) => (
          <li key={slug}>
            <Link to={`/species/${encodeURIComponent(slug)}`}>
              <span className="sp-zh">{chineseName || '（中文名待补）'}</span>
              <span className="sp-la">{scientificName}</span>
              <span className="sp-path">{phylum}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
