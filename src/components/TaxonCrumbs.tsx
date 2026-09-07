import { Link } from 'react-router-dom'

export interface CrumbItem {
  to: string
  chinese: string
  latin: string
}

function CrumbSep() {
  return (
    <svg
      className="crumbs-sep"
      viewBox="0 0 10 16"
      width="10"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 1.6 L7.2 8 L2 14.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function TaxonCrumbs({ items }: { items: CrumbItem[] }) {
  return (
    <nav className="crumbs" aria-label="分类路径">
      {items.map((c, i) => {
        const label = (
          <span className="crumb-label">
            <span className="crumb-zh">{c.chinese || c.latin}</span>
            <span className="crumb-la">{c.latin}</span>
          </span>
        )
        return (
          <span key={`${c.to}-${i}`} className="crumb">
            {i > 0 && <CrumbSep />}
            {i === items.length - 1 ? (
              <span className="crumbs-current">{label}</span>
            ) : (
              <Link to={c.to}>{label}</Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
