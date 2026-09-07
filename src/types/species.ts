/** 分类阶元（拉丁学名为主键体系） */
export type TaxonRank =
  | 'domain'
  | 'kingdom'
  | 'phylum'
  | 'class'
  | 'order'
  | 'family'
  | 'genus'
  | 'species'

export interface TaxonLabel {
  latin: string
  chinese: string
}

/**
 * sp2000 骨架记录（分片 public/data/species/{门}.json）
 * 仅基础分类信息；富数据见 SpeciesDetail（public/species/.../{slug}.json）
 */
export interface SpeciesRecord {
  scientificName: string
  chineseName: string
  kingdom: TaxonLabel
  phylum: TaxonLabel
  class: TaxonLabel
  order: TaxonLabel
  family: TaxonLabel
  genus: TaxonLabel
  /** 审核专家 / 数据源（名录） */
  reviewedBy: string
  /** 相对 public/ 的物种详情 JSON 路径 */
  jsonPath: string
  slug: string
}

export interface SpeciesMediaItem {
  url: string
  source: string
  sourceKey: string
  label: string
  rightsHolder: string
  license?: string
}

export interface SpeciesEnrichSource {
  key: string
  label: string
  taxonId?: string
}

/** 国内（中国）GBIF 坐标点 */
export interface SpeciesLocationPoint {
  lat: number
  lng: number
  key?: string | number
  year?: number | null
}

/**
 * 物种富数据（public/species/{门}/{纲}/{目}/{科}/{属}/{slug}.json）
 * intro 为带出处标注的 Markdown 字符串；俗名/多媒体/异名/保护/坐标分字段。
 */
export interface SpeciesDetail {
  scientificName: string
  chineseName: string
  slug: string
  /** 异名（拉丁） */
  synonyms: string[]
  /** 俗名 */
  commonNames: string[]
  /**
   * 介绍 Markdown（形态/大小/生物学/生境/繁殖/分布/经济/文献等），
   * 文内标注出处（如「出处：中国动物志数据库」）
   */
  intro: string
  media: SpeciesMediaItem[]
  /** 保护等级 */
  status: string | null
  sanyou: boolean | null
  tags: string[]
  redListCategory: string | null
  redList: string | null
  /**
   * 仅中国境内坐标点（替代原 gbif-points / 实时 Occurrence）
   */
  locations: SpeciesLocationPoint[]
  /** 国内省级分布（展示与按省筛选；可由 GBIF 汇总或名录补充） */
  provinces: string[]
  enrichPack?: string
  enrichFetchedAt?: string
  enrichSources?: SpeciesEnrichSource[]
  /** intro 处理流水线版本（scripts/lib/intro）；可对已抓数据重跑 process:intro */
  introPipeline?: string
  introProcessedAt?: string
  /** multimedia 拉取失败已降级；后续可单独补媒体 */
  mediaPending?: boolean
  mediaFetchError?: string
}

export interface TaxonomyNode {
  rank: TaxonRank
  latin: string
  chinese: string
  speciesCount: number
  children?: TaxonomyNode[]
  species?: SpeciesSummary[]
}

export interface SpeciesSummary {
  scientificName: string
  chineseName: string
  slug: string
}

export interface CatalogueMeta {
  title: string
  source: string
  sourceUrl: string
  importedAt?: string
  syncedAt?: string
  speciesCount: number
  kingdoms?: string[]
  phyla?: string[]
  files?: string[]
  notes?: string[]
  withDistribution?: number
  withProtection?: number
  withAnimalProtection?: number
  withPlantProtection?: number
  withSanyou?: number
  withRedList?: number
  withAnimalRedList?: number
  withPlantRedList?: number
  protection?: {
    wildlife?: {
      list: string
      version: string
      source: string
      sourceUrl: string
      appliedAt: string
      matchedSpecies: number
      animalSpecies: number
    }
    plant?: {
      list: string
      version: string
      source: string
      sourceUrl: string
      appliedAt: string
      matchedSpecies: number
      plantSpecies: number
    }
  }
  sanyou?: {
    list: string
    shortTitle: string
    version: string
    source: string
    sourceUrl: string
    appliedAt: string
    matchedSpecies: number
    animalSpecies: number
    listSpecies: number
  }
  redList?: {
    animal?: {
      list: string
      version: string
      source: string
      sourceUrl: string
      appliedAt: string
      matchedSpecies: number
      listSpecies: number
      kingdomSpecies: number
    }
    plant?: {
      list: string
      version: string
      source: string
      sourceUrl: string
      appliedAt: string
      matchedSpecies: number
      listSpecies: number
      kingdomSpecies: number
    }
  }
  gbif?: {
    list: string
    filter: string
    source: string
    sourceUrl: string
    appliedAt: string
    summaryCompiledAt?: string
    matchedSpecies: number
    updatedSpecies: number
    listSpecies: number
    role: string
  }
  split?: boolean
  message?: string
}
