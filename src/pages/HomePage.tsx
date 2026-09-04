import { Link, useOutletContext } from 'react-router-dom'
import type { AppCatalogue } from '../lib/catalogue'

export default function HomePage() {
  const data = useOutletContext<AppCatalogue>()
  const kingdoms = data.taxonomy.children ?? []

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">非商业 · 本土物种名录</p>
          <h1 className="hero-brand">中国生物大百科</h1>
          <p className="hero-lead">
            以《中国生物物种名录》为唯一分类主干，收录在中国有自然分布记录的动物界、植物界与真菌界物种。拉丁学名做主键，中文名与分类阶元与名录对齐。
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/browse">
              从分类进入
            </Link>
            <Link className="btn btn-ghost" to="/search">
              学名 / 中文名检索
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-orb" />
          <div className="hero-grid" />
        </div>
      </section>

      <section className="section phylum-section">
        <h2>界</h2>
        <p className="section-desc">按名录界级概览，点击进入门 → 纲 → 目 → 科 → 属 → 种。</p>
        <ul className="phylum-list">
          {kingdoms.map((k) => (
            <li key={k.latin}>
              <Link to={`/browse/${encodeURIComponent(k.latin)}`}>
                <span className="phylum-zh">{k.chinese || '（中文名待补）'}</span>
                <span className="phylum-la">{k.latin}</span>
                <span className="phylum-count">{k.speciesCount.toLocaleString()} 种</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
