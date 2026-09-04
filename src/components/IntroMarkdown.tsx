import type { ReactNode } from 'react'

/** 轻量 Markdown 渲染（介绍正文：标题 / 段落 / 表 / 列表 / 引用 / 加粗） */
export default function IntroMarkdown({ source }: { source: string }) {
  const blocks = splitBlocks(source.trim())
  return (
    <div className="intro-body intro-md">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

type Block =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'strong-line'; text: string }

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() })
      i += 1
      continue
    }
    if (line.startsWith('> ')) {
      const parts: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        parts.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'quote', text: parts.join('\n') })
      continue
    }
    if (line.trim().startsWith('|') && lines[i + 1] && /\|?\s*:?---/.test(lines[i + 1])) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      const parsed = parseTable(tableLines)
      if (parsed) blocks.push(parsed)
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2).trim())
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      blocks.push({ type: 'strong-line', text: line.trim().slice(2, -2) })
      i += 1
      continue
    }
    // paragraph: consume until blank
    const parts: string[] = []
    while (i < lines.length && lines[i].trim()) {
      if (
        lines[i].startsWith('## ') ||
        lines[i].startsWith('> ') ||
        lines[i].startsWith('- ') ||
        lines[i].trim().startsWith('|')
      ) {
        break
      }
      parts.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'p', text: parts.join('\n').trim() })
  }
  return blocks
}

function parseTable(lines: string[]): Block | null {
  if (lines.length < 2) return null
  const split = (l: string) =>
    l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
  const headers = split(lines[0])
  let start = 1
  if (lines[1] && /---/.test(lines[1])) start = 2
  const rows = lines.slice(start).map(split).filter((r) => r.some(Boolean))
  return { type: 'table', headers, rows }
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(<strong key={k++}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.type) {
    case 'h2':
      return (
        <h3 key={i} className="intro-h">
          {b.text}
        </h3>
      )
    case 'p':
      return (
        <p key={i} className="intro-p">
          {inline(b.text)}
        </p>
      )
    case 'quote':
      return (
        <blockquote key={i} className="intro-quote">
          {inline(b.text)}
        </blockquote>
      )
    case 'ul':
      return (
        <ul key={i} className="intro-ul">
          {b.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      )
    case 'strong-line':
      return (
        <p key={i} className="intro-label">
          <strong>{b.text}</strong>
        </p>
      )
    case 'table':
      return (
        <div key={i} className="intro-table-wrap">
          <table className="intro-table">
            <thead>
              <tr>
                {b.headers.map((h, j) => (
                  <th key={j}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {b.headers.map((_, c) => (
                    <td key={c}>{row[c] || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
