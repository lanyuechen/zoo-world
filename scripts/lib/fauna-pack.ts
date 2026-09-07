/**
 * 动物主题库 enrich 完整包（v2）：描述 + 异名 + 俗名 + 图片，带来源标记。
 * 旧版仅有 <!-- fauna-sinica --> 描述块；v2 用 <!-- zoo-pack:v2 --> 便于区分与补全。
 * 异名写入 public/data/species 骨架，不进 Markdown 正文。
 */
import fs from 'node:fs'
import path from 'node:path'
import { FAUNA_BASE, stripHtml } from './fauna-tax-tree'
import { normalizeFaunaInner } from './normalize-fauna-md'

export const PACK_START = '<!-- zoo-pack:v2:start -->'
export const PACK_END = '<!-- zoo-pack:v2:end -->'
export const LEGACY_FAUNA_START = '<!-- fauna-sinica:start -->'
export const LEGACY_FAUNA_END = '<!-- fauna-sinica:end -->'

/** 来源键：后期可增 cn-birds 等 */
export const SOURCE_FAUNA_SINICA = 'fauna-sinica' as const
export const SOURCE_LABELS: Record<string, string> = {
  [SOURCE_FAUNA_SINICA]: '中国动物志数据库',
}

export interface FaunaMediaItem {
  url: string
  source: string
  sourceKey: string
  label: string
  rightsHolder: string
  license?: string
}

export interface FaunaCitationName {
  scientificName: string
  status: string
  authorship: string
  citation: string
}

export interface FaunaDescSection {
  title: string
  body: string
  refs: string
  order: number
  source: string
}

export interface FaunaEnrichPack {
  taxonId: string
  sourceKey: typeof SOURCE_FAUNA_SINICA
  sourceLabel: string
  sections: FaunaDescSection[]
  synonyms: FaunaCitationName[]
  acceptedNames: FaunaCitationName[]
  commonNames: string[]
  media: FaunaMediaItem[]
}

interface DescItem {
  sourcesName?: string
  descriptiontype?: { descterm?: string; dtorder?: number }
  description?: { descontent?: string; referencejson?: string }
}

interface CitationItem {
  scientificname?: string
  namestatus?: string
  authorship?: string
  citationstr?: string
  sourcesName?: string
}

interface CommonNameItem {
  commonname?: string
  sourcesName?: string
}

interface MultimediaItem {
  path?: string
  title?: string
  medialabel?: string
  sourcesName?: string
  rightsholder?: string
  licenseImageurl?: string
  mediatype?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'zoo-world-noncommercial-research/0.1 (local enrich script)',
      Accept: 'application/json,*/*',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

function isFaunaSource(name: string): boolean {
  return name.includes('中国动物志') || name.includes('动物志')
}

export async function fetchFaunaEnrichPack(taxonId: string): Promise<FaunaEnrichPack> {
  const enc = encodeURIComponent(taxonId)
  const q = 'datasourceinfo=All'

  const [descList, citationWrap, commonWrap, mediaWrap] = await Promise.all([
    fetchJson<DescItem[]>(`${FAUNA_BASE}/search/description/view/${enc}?${q}`),
    fetchJson<{ list?: CitationItem[] }>(`${FAUNA_BASE}/search/citation/view/${enc}?${q}`),
    fetchJson<{ list?: CommonNameItem[] }>(`${FAUNA_BASE}/search/commonname/view/${enc}?${q}`),
    fetchJson<{ list?: MultimediaItem[] }>(`${FAUNA_BASE}/search/multimedia/view/${enc}?${q}`),
  ])

  const sections: FaunaDescSection[] = []
  for (const item of descList || []) {
    const src = item.sourcesName || ''
    if (!isFaunaSource(src)) continue
    const title = item.descriptiontype?.descterm?.trim() || '描述'
    const body = stripHtml(item.description?.descontent || '')
    if (!body) continue
    sections.push({
      title,
      body,
      refs: stripHtml(item.description?.referencejson || ''),
      order: Number(item.descriptiontype?.dtorder ?? 99),
      source: src || '中国动物志',
    })
  }
  sections.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh'))

  const synonyms: FaunaCitationName[] = []
  const acceptedNames: FaunaCitationName[] = []
  for (const c of citationWrap?.list || []) {
    if (c.sourcesName && !isFaunaSource(c.sourcesName)) continue
    const row: FaunaCitationName = {
      scientificName: (c.scientificname || '').trim(),
      status: (c.namestatus || '').trim(),
      authorship: (c.authorship || '').trim(),
      citation: stripHtml(c.citationstr || ''),
    }
    if (!row.scientificName) continue
    if (/synonym/i.test(row.status)) synonyms.push(row)
    else acceptedNames.push(row)
  }

  const commonNames: string[] = []
  const seenCn = new Set<string>()
  for (const c of commonWrap?.list || []) {
    if (c.sourcesName && !isFaunaSource(c.sourcesName)) continue
    const name = (c.commonname || '').trim()
    if (!name || seenCn.has(name)) continue
    seenCn.add(name)
    commonNames.push(name)
  }

  const media: FaunaMediaItem[] = []
  const seenUrl = new Set<string>()
  for (const m of mediaWrap?.list || []) {
    const url = (m.path || '').trim()
    if (!url || !/^https?:\/\//i.test(url) || seenUrl.has(url)) continue
    // 跳过 embed 页等非直链图
    if (/macaulaylibrary\.org\/asset\/.*\/embed/i.test(url)) continue
    seenUrl.add(url)
    const srcName = (m.sourcesName || '').trim()
    const sourceKey = isFaunaSource(srcName)
      ? SOURCE_FAUNA_SINICA
      : srcName
        ? 'other'
        : 'unspecified'
    media.push({
      url,
      source: srcName || (sourceKey === SOURCE_FAUNA_SINICA ? SOURCE_LABELS[SOURCE_FAUNA_SINICA] : '未标注来源'),
      sourceKey,
      label: stripHtml((m.medialabel || m.title || '').replace(/\t+/g, ' ')).slice(0, 200),
      rightsHolder: (m.rightsholder || '').trim(),
      license: (m.licenseImageurl || '').trim() || undefined,
    })
  }
  // 动物志图优先
  media.sort((a, b) => {
    const rank = (k: string) => (k === SOURCE_FAUNA_SINICA ? 0 : k === 'unspecified' ? 2 : 1)
    return rank(a.sourceKey) - rank(b.sourceKey)
  })

  return {
    taxonId,
    sourceKey: SOURCE_FAUNA_SINICA,
    sourceLabel: SOURCE_LABELS[SOURCE_FAUNA_SINICA],
    sections,
    synonyms,
    acceptedNames,
    commonNames,
    media,
  }
}

/** 构建 intro Markdown（不含俗名/图片/异名；那些走独立字段） */
export function buildZooPackIntro(
  chineseName: string,
  scientificName: string,
  pack: FaunaEnrichPack,
): string {
  void chineseName
  void scientificName
  const taxonUrl = `${FAUNA_BASE}/taxon/${pack.taxonId}`
  const lines: string[] = [
    `## 出处：[${pack.sourceLabel}](${taxonUrl})`,
    '',
  ]

  const seenRefs = new Set<string>()
  const descParts: string[] = []
  for (const s of pack.sections) {
    descParts.push(`### ${s.title}`, '', s.body, '')
    if (s.refs) seenRefs.add(s.refs)
  }
  const normalizedDesc = normalizeFaunaInner(descParts.join('\n')).trim()
  if (normalizedDesc) lines.push(normalizedDesc, '')

  if (seenRefs.size) {
    lines.push('### 参考文献', '')
    for (const r of seenRefs) lines.push(`- ${r}`)
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

export function hasZooPackV2(body: string): boolean {
  return body.includes(PACK_START) && body.includes(PACK_END)
}

export function hasLegacyFaunaOnly(body: string): boolean {
  return body.includes(LEGACY_FAUNA_START) && !hasZooPackV2(body)
}

/** 写入/替换 pack：v2 覆盖 v2；或升级替换旧 fauna-sinica；否则追加 */
export function upsertZooPack(existingBody: string, packBlock: string, force: boolean): string | null {
  const block = packBlock.trim()
  if (hasZooPackV2(existingBody)) {
    if (!force) return null
    return existingBody.replace(new RegExp(`${PACK_START}[\\s\\S]*?${PACK_END}`), block)
  }
  if (hasLegacyFaunaOnly(existingBody)) {
    // 旧不完整包 → 升级为 v2
    return existingBody.replace(
      new RegExp(`${LEGACY_FAUNA_START}[\\s\\S]*?${LEGACY_FAUNA_END}`),
      block,
    )
  }
  const trimmed = existingBody.trim()
  const isPlaceholder =
    !trimmed ||
    /^# .+\n\n\*\*[^*]+\*\*\n\n> 科普介绍待补充。\s*$/m.test(trimmed) ||
    trimmed === '> 科普介绍待补充。'
  if (isPlaceholder) return `\n${block}\n`
  return `${existingBody.trimEnd()}\n\n${block}\n`
}

export function yamlEscape(s: string): string {
  return JSON.stringify(s)
}

export function mergeSynonymList(existing: string[], fromPack: FaunaCitationName[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of [...existing, ...fromPack.map((x) => x.scientificName)]) {
    const t = s.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/** 在已有 frontmatter 文本上注入/更新 enrich 字段 */
export function patchFrontmatter(
  fm: string,
  patch: {
    commonNames: string[]
    media: FaunaMediaItem[]
    enrichPack: string
    enrichFetchedAt: string
    enrichSources: { key: string; label: string; taxonId: string }[]
  },
): string {
  let body = fm.replace(/^---\n/, '').replace(/\n---\n?$/, '\n')

  const setScalar = (key: string, value: string) => {
    const re = new RegExp(`^${key}:.*$`, 'm')
    if (re.test(body)) body = body.replace(re, `${key}: ${value}`)
    else body += `${key}: ${value}\n`
  }

  const setBlock = (key: string, block: string) => {
    const re = new RegExp(`^${key}:[\\s\\S]*?(?=^[a-zA-Z][\\w]*:|\\Z)`, 'm')
    if (re.test(body)) body = body.replace(re, `${block}\n`)
    else body += `${block}\n`
  }

  // 异名写入 sp2000 骨架 JSON，不写入 Markdown frontmatter（保持空或原样）
  setBlock(
    'commonNames',
    patch.commonNames.length === 0
      ? 'commonNames: []'
      : `commonNames:\n${patch.commonNames.map((x) => `  - ${yamlEscape(x)}`).join('\n')}`,
  )

  if (patch.media.length === 0) {
    setBlock('media', 'media: []')
  } else {
    const lines = ['media:']
    for (const m of patch.media) {
      lines.push(`  - url: ${yamlEscape(m.url)}`)
      lines.push(`    source: ${yamlEscape(m.source)}`)
      lines.push(`    sourceKey: ${yamlEscape(m.sourceKey)}`)
      lines.push(`    label: ${yamlEscape(m.label)}`)
      lines.push(`    rightsHolder: ${yamlEscape(m.rightsHolder)}`)
    }
    setBlock('media', lines.join('\n'))
  }

  setScalar('enrichPack', yamlEscape(patch.enrichPack))
  setScalar('enrichFetchedAt', yamlEscape(patch.enrichFetchedAt))
  {
    const lines = ['enrichSources:']
    for (const s of patch.enrichSources) {
      lines.push(`  - key: ${yamlEscape(s.key)}`)
      lines.push(`    label: ${yamlEscape(s.label)}`)
      lines.push(`    taxonId: ${yamlEscape(s.taxonId)}`)
    }
    setBlock('enrichSources', lines.join('\n'))
  }

  return `---\n${body.replace(/\n+$/, '\n')}---\n`
}

/** 将异名合并进 public/data/species/{phylum}.json 骨架（sp2000 运行时索引） */
export function mergeSynonymsIntoSpeciesShard(
  speciesDataDir: string,
  phylumLatin: string,
  scientificName: string,
  extraSynonyms: string[],
): { updated: boolean; synonyms: string[] } {
  const file = path.join(speciesDataDir, `${phylumLatin}.json`)
  if (!fs.existsSync(file) || !extraSynonyms.length) {
    return { updated: false, synonyms: [] }
  }
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    scientificName: string
    synonyms?: string[]
  }[]
  const want = scientificName.trim().toLowerCase()
  let updated = false
  let synonyms: string[] = []
  for (const s of list) {
    if ((s.scientificName || '').trim().toLowerCase() !== want) continue
    const merged = mergeSynonymList(s.synonyms || [], extraSynonyms.map((n) => ({
      scientificName: n,
      status: 'synonym',
      authorship: '',
      citation: '',
    })))
    const prev = JSON.stringify(s.synonyms || [])
    s.synonyms = merged
    synonyms = merged
    if (JSON.stringify(merged) !== prev) updated = true
    break
  }
  if (updated) {
    fs.writeFileSync(file, JSON.stringify(list))
  }
  return { updated, synonyms }
}
