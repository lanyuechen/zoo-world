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

/** 物种名录核心记录（拉丁学名主键） */
export interface SpeciesRecord {
  /** 拉丁学名，全局主键 */
  scientificName: string
  chineseName: string
  synonyms: string[]
  kingdom: TaxonLabel
  phylum: TaxonLabel
  class: TaxonLabel
  order: TaxonLabel
  family: TaxonLabel
  genus: TaxonLabel
  /** 国内分布省份，后续补充 */
  distribution: string[]
  /** 保护等级（国家重点保护野生动/植物名录） */
  status: string | null
  /**
   * 是否列入三有名录（仅动物界有意义）
   * true=是，false=否，null=不适用（植物/真菌等）
   */
  sanyou: boolean | null
  /** 展示标签，如「三有」 */
  tags: string[]
  /** 中国生物多样性红色名录等级代码，如 CR / EN / VU */
  redListCategory: string | null
  /** 红色名录展示文案，如 极危（CR） */
  redList: string | null
  /** 审核专家 / 数据源 */
  reviewedBy: string
  /** 相对 public/ 的 Markdown 路径（有介绍时才存在对应文件） */
  mdPath: string
  /** 路由用 slug */
  slug: string
  /**
   * 历史字段：介绍已改为按需加载 public/species 下 Markdown，分片中保持空串。
   * @deprecated
   */
  intro: string
}

export interface TaxonomyNode {
  rank: TaxonRank
  latin: string
  chinese: string
  speciesCount: number
  children?: TaxonomyNode[]
  /** 仅属级节点挂载物种摘要 */
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
