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
            专注记录中国本土野生动物的科普查阅工具。整合《中国动物志》、中国生物物种名录、权威物种数据库公开资料，收录兽类、鸟类、两栖爬行、鱼类、昆虫等本土物种信息。完整保存拉丁学名、异名、亚种、指名亚种、保护等级、形态特征、分布与生境、文献来源。支持中文名、拉丁名检索，本地离线数据库，无需网络即可查阅物种档案，面向自然爱好者、学生与科普研究者，助力认识我国丰富的生物多样性。
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
