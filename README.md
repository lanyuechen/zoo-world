# 中国生物大百科

非商业 Web 应用。分类主干唯一来源：[中国生物物种名录（Species 2000 中国节点）](https://www.sp2000.org.cn)。收录名录中的**动物界、植物界、真菌界**物种，**拉丁学名为主键**。

## 快速开始

```bash
# 1. 将名录 Excel 放入 data/raw/
# 2. 导入运行时索引（默认不写空壳 Markdown）
npm run import:excel

# 3. 启动
npm run dev
```

### 《中国动物志》正文补充（中国动物主题数据库）

从 [中国动物主题数据库](http://www.zoology.csdb.cn/) 公开页抓取《中国动物志》描述，写入 `public/species/**/*.md`（`<!-- fauna-sinica -->` 标记块）。**不改分类主干**。物种页按需加载 Markdown，**无需 merge:intro**。

```bash
npm run enrich:fauna -- --name="Aix galericulata"
npm run enrich:fauna -- --limit=50 --resume
```

说明：`public/data` 与有介绍的 `public/species/**/*.md` 入库；空壳 Markdown 不保留。匹配须属名+种加词一致，可用 `npm run cleanup:fauna` 清理误匹配。

## 数据约定

有介绍的物种 Markdown（入库）：

```text
public/species/{门}/{纲}/{目}/{科}/{属}/{拉丁学名slug}.md
```

Frontmatter 字段：`scientificName`（主键）、`chineseName`、`synonyms`、界门纲目科属、`distribution`、`status`、`reviewedBy`、`slug`。

运行时索引（由脚本生成，**入库供 Pages 使用**；更新后请提交）：

- `public/data/meta.json` / `taxonomy.json`
- `public/data/search-index.json` / `slug-index.json`
- `public/data/species/{门}.json`（按门分片；介绍不在 JSON 内，见上）

### 当前 Excel 列

| 列 | 说明 |
| --- | --- |
| 物种拉丁名 / 物种中文名 | 主键与中文名 |
| 界~属（拉丁 + 中文） | 分类阶元 |
| 审核专家/数据源 | 审定信息 |

**Excel 暂无**：异名、国内分布省份、科普正文、图片 → 字段已预留；分布可由 GBIF 中国子集补充。

### GBIF 中国区域子集（辅助，非主分类）

- **用途**：辅助学名校验、补充省级分布、物种详情页地图点位；**不要当主分类**。
- **过滤**：`country=CN` + 有坐标 + 无地理问题。
- **详情页**：默认实时请求 GBIF Occurrence API 画点；若已跑过离线处理，则优先读 `public/data/gbif-points/`。

```bash
# 1) 申请下载（需 GBIF 账号）
GBIF_USER=... GBIF_PASSWORD=... GBIF_EMAIL=... npm run gbif:request
# 2) 下载完成后将 SIMPLE_CSV 解压到 data/gbif/raw/
npm run gbif:process
# 3) 合并省级分布到物种索引
npm run apply:gbif
```

**保护等级 / 标签 / 红色名录**：
- 动物：现行《[国家重点保护野生动物名录](http://www.forestry.gov.cn/lyj/1/gkgfxwj/20210201/546057.html)》（2021）→ `data/protection/national-key-wildlife-2021.json`
- 植物：现行《[国家重点保护野生植物名录](https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm)》（2021）→ `data/protection/national-key-wildplants-2021.json`
- 三有：现行《[有重要生态、科学、社会价值的陆生野生动物名录](https://www.forestry.gov.cn/lyj/1/gsgg/20230630/509640.html)》（2023）→ `data/protection/sanyou-wildlife-2023.json`（字段 `sanyou` / 标签「三有」）
- 红色名录：《[中国生物多样性红色名录](https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/t20230522_1030745.html)》（2020 脊椎动物卷 + 高等植物卷）→ `china-redlist-vertebrates-2020.json` / `china-redlist-plants-2020.json`（字段 `redList` / `redListCategory`）

```bash
# 从维基百科 / 官方 PDF 重建名录 JSON（需网络；红色名录需 Python: pypdf、rdata）
npm run build:protection-list
npm run build:plant-protection-list
npm run build:sanyou-list
npm run build:redlist
# 写入 / 更新 public/data 物种分片中的 status / 三有 / 红色名录
npm run apply:protection
```

导入 Excel（`import:excel`）与同步 Markdown（`sync:content`）时会自动匹配。组（sect.）级植物保护规则因库内无组级字段暂不自动扩及全属。红色名录动物卷仅覆盖脊椎动物。

`data/raw/` 应包含动物界、植物界、真菌界名录表。

## 功能

- 生物 → 界 → 门 → 纲 → 目 → 科 → 属 → 种 浏览
- 学名 / 中文名检索
- 物种详情（名录字段 + 介绍占位）
- 物种分布地图（GBIF 中国 occurrence 点位）
- 按省份筛选（依赖 distribution；可由 GBIF 子集填充）

## 技术

Vite + React + TypeScript。运行时读取 `public/data/*.json`（由导入脚本从 Markdown / Excel 生成）。

生产构建启用 Service Worker（`vite-plugin-pwa`）：预缓存应用壳；名录 JSON / 字体走运行时缓存（StaleWhileRevalidate / CacheFirst），便于二次访问与弱网。

## GitHub Pages

推送到 `master` 后，Actions 会：校验已入库的 `public/data` → 构建（`base=/zoo-world/`）→ 部署。

（名录 Excel 不在 CI 重新生成；本地 `import` / `enrich` 后提交 `public/data` 与 `public/species`。）

首次需在仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

站点地址：https://lanyuechen.github.io/zoo-world/

本地模拟 Pages 构建：

```bash
npm run build:pages
npm run preview:pages
```
