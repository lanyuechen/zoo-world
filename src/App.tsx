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
        {data && (
          <p className="footer-meta">
            已收录 {data.meta.speciesCount.toLocaleString()} 种
            {(data.meta.withAnimalProtection ?? 0) > 0 && (
              <>
                {' '}
                · 国家重点保护动物 {(data.meta.withAnimalProtection ?? 0).toLocaleString()} 种
              </>
            )}
            {(data.meta.withPlantProtection ?? 0) > 0 && (
              <>
                {' '}
                · 国家重点保护植物 {(data.meta.withPlantProtection ?? 0).toLocaleString()} 种
              </>
            )}
          </p>
        )}
        <p className="footer-sources-label">数据来源：</p>
        <ul className="footer-sources">
          <li>
            <a href="https://www.sp2000.org.cn" target="_blank" rel="noreferrer">
              中国生物物种名录（Species 2000 中国节点）
            </a>
          </li>
          <li>
            <a
              href={
                data?.meta.protection?.wildlife?.sourceUrl ||
                'http://www.forestry.gov.cn/lyj/1/gkgfxwj/20210201/546057.html'
              }
              target="_blank"
              rel="noreferrer"
            >
              国家重点保护野生动物名录（2021）
            </a>
          </li>
          <li>
            <a
              href={
                data?.meta.protection?.plant?.sourceUrl ||
                'https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm'
              }
              target="_blank"
              rel="noreferrer"
            >
              国家重点保护野生植物名录（2021）
            </a>
          </li>
        </ul>
      </footer>
    </div>
  )
}
