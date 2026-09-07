/**
 * 从骨架分片遍历物种，读写 public/species/.../{slug}.json 详情。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { speciesJsonRelPath } from './species-json-path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PUBLIC = path.join(ROOT, 'public')
export const SPECIES_SHARD_DIR = path.join(PUBLIC, 'data', 'species')
export const META_PATH = path.join(PUBLIC, 'data', 'meta.json')

export interface TaxonLabel {
  latin: string
  chinese: string
}

/** 骨架分片记录（slim） */
export interface SkeletonSpecies {
  scientificName: string
  chineseName: string
  kingdom: TaxonLabel
  phylum: TaxonLabel
  class: TaxonLabel
  order: TaxonLabel
  family: TaxonLabel
  genus: TaxonLabel
  reviewedBy?: string
  jsonPath?: string
  slug: string
}

export interface SpeciesDetailPatch {
  scientificName: string
  chineseName: string
  slug: string
  synonyms?: string[]
  commonNames?: string[]
  intro?: string
  media?: unknown[]
  status?: string | null
  sanyou?: boolean | null
  tags?: string[]
  redListCategory?: string | null
  redList?: string | null
  locations?: unknown[]
  provinces?: string[]
  [key: string]: unknown
}

export function resolveJsonPath(s: SkeletonSpecies): string {
  if (s.jsonPath) return s.jsonPath.replace(/^\//, '')
  return speciesJsonRelPath({
    phylum: s.phylum,
    class: s.class,
    order: s.order,
    family: s.family,
    genus: s.genus,
    slug: s.slug,
  })
}

export function detailAbsPath(jsonPath: string): string {
  return path.join(PUBLIC, jsonPath.replace(/^\//, ''))
}

export function loadDetail(jsonPath: string): SpeciesDetailPatch | null {
  const abs = detailAbsPath(jsonPath)
  if (!fs.existsSync(abs)) return null
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as SpeciesDetailPatch
  } catch {
    return null
  }
}

/** 无详情文件时建最小壳（仅写入保护类字段时用） */
export function emptyDetailFromSkeleton(s: SkeletonSpecies): SpeciesDetailPatch {
  return {
    scientificName: s.scientificName,
    chineseName: s.chineseName,
    slug: s.slug,
    synonyms: [],
    commonNames: [],
    intro: '',
    media: [],
    status: null,
    sanyou: null,
    tags: [],
    redListCategory: null,
    redList: null,
    locations: [],
    provinces: [],
  }
}

export function writeDetail(jsonPath: string, detail: SpeciesDetailPatch): void {
  const abs = detailAbsPath(jsonPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(detail, null, 2) + '\n', 'utf8')
}

/**
 * 更新详情字段。无文件且 patch 全为「空」时跳过创建。
 * @returns 是否写盘
 */
export function patchDetail(
  s: SkeletonSpecies,
  patch: Partial<SpeciesDetailPatch>,
  opts?: { createIfMissing?: boolean },
): boolean {
  const jsonPath = resolveJsonPath(s)
  let detail = loadDetail(jsonPath)
  const create = opts?.createIfMissing !== false

  if (!detail) {
    if (!create) return false
    const meaningful = Object.entries(patch).some(([, v]) => {
      if (v == null) return false
      if (Array.isArray(v) && v.length === 0) return false
      if (v === false) return true
      return true
    })
    if (!meaningful) return false
    detail = emptyDetailFromSkeleton(s)
  }

  let changed = false
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(detail[k]) !== JSON.stringify(v)) {
      detail[k] = v
      changed = true
    }
  }
  if (!changed) return false
  writeDetail(jsonPath, detail)
  return true
}

export function forEachSkeleton(
  fn: (s: SkeletonSpecies, index: number, totalHint: number) => void,
): number {
  if (!fs.existsSync(SPECIES_SHARD_DIR)) {
    throw new Error(`缺少物种分片：请先 npm run import:sp2000（${SPECIES_SHARD_DIR}）`)
  }
  const files = fs.readdirSync(SPECIES_SHARD_DIR).filter((f) => f.endsWith('.json'))
  let n = 0
  for (const file of files) {
    const rows = JSON.parse(
      fs.readFileSync(path.join(SPECIES_SHARD_DIR, file), 'utf8'),
    ) as SkeletonSpecies[]
    for (const s of rows) {
      fn(s, n, 0)
      n += 1
    }
  }
  return n
}

export function updateMeta(mutator: (meta: Record<string, unknown>) => void): void {
  if (!fs.existsSync(META_PATH)) return
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as Record<string, unknown>
  mutator(meta)
  fs.writeFileSync(META_PATH, JSON.stringify(meta), 'utf8')
}
