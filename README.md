# 中国生物大百科

非商业 Web 应用。分类主干唯一来源：[中国生物物种名录（Species 2000 中国节点）](https://www.sp2000.org.cn)。收录名录中的**动物界、植物界、真菌界**物种，**拉丁学名为主键**。

## 快速开始

```bash
# 1. 将名录 Excel 放入 data/raw/
# 2. 导入 sp2000 骨架索引（taxonomy / species 分片 / search）
npm run import:sp2000

# 3. 拉取物种详情（GitHub Release：species-data / species.tar.gz）
npm run species:fetch

# 4. 启动
npm run dev
```

### 物种详情数据包（不入库）

`public/species/**/*.json` 文件过多，**不进 Git**。压缩包发布在 Release 标签 [`species-data`](https://github.com/lanyuechen/zoo-world/releases/tag/species-data)：

```bash
npm run species:fetch      # 下载并解压到 public/species
npm run species:pack       # 本地打包 → dist-assets/species.tar.gz
npm run species:publish    # 打包并上传/更新 Release（需 gh）
```

enrich / `enrich:protection` 等写本地 `public/species` 后，记得 `npm run species:publish`，再触发 Pages 构建。

### 《中国动物志》正文补充（中国动物主题数据库）

从 [中国动物志数据库](http://www.zoology.csdb.cn/dba/fauna) 左侧分类树建立叶索引（`binomial → taxonId`），再拉完整包写入 `public/species/**/*.json`。**不改分类主干**。

完整包（`enrichPack: v2`）含：描述、俗名、图片、异名；正文用「出处：中国动物志数据库」标注，便于后期叠加其它来源。

```bash
npm run enrich:fauna:tree                    # 建/续跑分类树叶索引（边爬边落盘）
npm run enrich:fauna:tree -- --force         # 清空断点重爬
npm run enrich:fauna -- --name="Chrysolophus pictus" --force
npm run enrich:fauna -- --limit=50 --resume
npm run species:publish                      # 更新 Release 数据包
```

树爬断点在 `data/fauna/tax-tree-checkpoint.json`，索引在 `tax-tree-leaves.json`。匹配须属名+种加词一致。

## 数据约定

物种详情（**本地 / Pages 解压后**）：

```text
public/species/{门}/{纲}/{目}/{科}/{属}/{拉丁学名slug}.json
```

详情字段：`intro`（带出处的 Markdown）、`commonNames`、`media`、`synonyms`、保护/三有/红色名录、`locations`（**仅中国境内坐标**）、`provinces`。

骨架分片 `public/data/species/{门}.json` 仅：学名、中文名、界门纲目科属、`reviewedBy`、`slug`、`jsonPath`（**入库**）。

运行时索引（由脚本生成，**入库供 Pages 使用**；更新后请提交）：

- `public/data/meta.json` / `taxonomy.json`
- `public/data/search-index.json` / `slug-index.json`
- `public/data/species/{门}.json`（按门分片）

### 当前 Excel 列

| 列 | 说明 |
| --- | --- |
| 物种拉丁名 / 物种中文名 | 主键与中文名 |
| 界~属（拉丁 + 中文） | 分类阶元 |
| 审核专家/数据源 | 审定信息 |

**Excel 暂无**：异名、国内分布省份、科普正文、图片 → 字段已预留；分布可由 GBIF 中国子集补充。

### GBIF 中国区域子集（辅助，非主分类）

- **用途**：直接写入物种详情 `locations` / `provinces`；**不要当主分类**。
- **过滤**：`country=CN` + 有坐标 + 无地理问题。

```bash
npm run species:fetch

# 全量：申请下载 → 解压 CSV 到 data/gbif/raw/ → 回填
GBIF_USER=... GBIF_PASSWORD=... GBIF_EMAIL=... npm run enrich:gbif -- --request
# （邮件就绪后下载 zip，解压到 data/gbif/raw/）
npm run enrich:gbif

# 单种：走 Occurrence API，无需 CSV
npm run enrich:gbif -- --name="Chrysolophus pictus"

npm run species:publish
```

**保护等级 / 标签 / 红色名录**：
- 动物：现行《[国家重点保护野生动物名录](http://www.forestry.gov.cn/lyj/1/gkgfxwj/20210201/546057.html)》（2021）→ `data/protection/national-key-wildlife-2021.json`
- 植物：现行《[国家重点保护野生植物名录](https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm)》（2021）→ `data/protection/national-key-wildplants-2021.json`
- 三有：现行《[有重要生态、科学、社会价值的陆生野生动物名录](https://www.forestry.gov.cn/lyj/1/gsgg/20230630/509640.html)》（2023）→ `data/protection/sanyou-wildlife-2023.json`（字段 `sanyou` / 标签「三有」）
- 红色名录：《[中国生物多样性红色名录](https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/t20230522_1030745.html)》（2020 脊椎动物卷 + 高等植物卷）→ `china-redlist-vertebrates-2020.json` / `china-redlist-plants-2020.json`（字段 `redList` / `redListCategory`）

```bash
# 重建名录中间文件（data/protection/）并回填物种详情（需网络；红色名录需 Python: pypdf、rdata）
npm run enrich:protection   # 国家重点保护动植物
npm run enrich:sanyou       # 三有名录
npm run enrich:redlist      # 中国生物多样性红色名录
npm run species:publish
```

导入 Excel（`import:sp2000`）只写骨架；保护/三有/红名录用上面的 `enrich:*` 写入 `public/species/**/*.json`。组（sect.）级植物保护规则因库内无组级字段暂不自动扩及全属。红色名录动物卷仅覆盖脊椎动物。

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

推送到 `master` 后，Actions 会：校验 `public/data` → 从 Release `species-data` 拉取并解压 `species.tar.gz` → 构建（`base=/zoo-world/`）→ 部署。

首次需在仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

站点地址：https://lanyuechen.github.io/zoo-world/

本地模拟 Pages 构建：

```bash
npm run species:fetch
npm run build:pages
npm run preview:pages
```
