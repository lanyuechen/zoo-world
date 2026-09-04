import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { loadBoot, type AppCatalogue } from './lib/catalogue'
import './styles/app.css'

export default function App() {
  const [data, setData] = useState<AppCatalogue | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBoot()
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-mark">草木虫鱼</span>
          <span className="brand-name">中国生物大百科</span>
        </Link>
        <nav className="site-nav">
          <NavLink to="/browse">分类浏览</NavLink>
          <NavLink to="/search">检索</NavLink>
          <NavLink to="/province">分布</NavLink>
        </nav>
      </header>

      <main className="site-main">
        {error && (
          <div className="banner-error">
            <p>{error}</p>
            <p>
              将名录 Excel 放入 <code>data/raw/</code> 后执行{' '}
              <code>npm run import:excel</code>
            </p>
          </div>
        )}
        {!error && !data && <p className="loading">正在载入名录…</p>}
        {data && <Outlet context={data} />}
      </main>

      <footer className="site-footer">
        <p>
          分类主干取自
          <a href="https://www.sp2000.org.cn" target="_blank" rel="noreferrer">
            中国生物物种名录（Species 2000 中国节点）
          </a>
          ，仅作非商业科普检索。拉丁学名为主键。
        </p>
        {data && (
          <p className="footer-meta">已收录 {data.meta.speciesCount.toLocaleString()} 种</p>
        )}
      </footer>
    </div>
  )
}
