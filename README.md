# 中国生物大百科

非商业 Web 应用。分类主干唯一来源：[中国生物物种名录（Species 2000 中国节点）](https://www.sp2000.org.cn)。收录名录中的**动物界、植物界、真菌界**物种，**拉丁学名为主键**。

## 快速开始

```bash
# 1. 将名录 Excel 放入 data/raw/
# 2. 导入（生成 Markdown + 运行时索引）
npm run import:excel

# 仅生成索引、不写 Markdown（更快，用于调试）
npm run import:excel:index-only

# 3. 启动
npm run dev
```

手工补充 Markdown 中的介绍 / 分布 / 异名 / 保护等级后：

```bash
npm run sync:content
```

## 数据约定

物种文件路径：

```text
content/species/{界}/{门}/{纲}/{目}/{科}/{属}/{拉丁学名slug}.md
```

Frontmatter 字段：`scientificName`（主键）、`chineseName`、`synonyms`、界门纲目科属、`distribution`、`status`、`reviewedBy`、`slug`。

运行时索引（由脚本生成，勿手改）：

- `public/data/meta.json` / `taxonomy.json`
- `public/data/search-index.json` / `slug-index.json`
- `public/data/species/{门}.json`（按门分片加载）

### 当前 Excel 列

| 列 | 说明 |
| --- | --- |
| 物种拉丁名 / 物种中文名 | 主键与中文名 |
| 界~属（拉丁 + 中文） | 分类阶元 |
| 审核专家/数据源 | 审定信息 |

**Excel 暂无**：异名、国内分布省份、科普正文、图片 → 字段已预留，后续在 Markdown 中补充。

**保护等级**：
- 动物：现行《[国家重点保护野生动物名录](http://www.forestry.gov.cn/lyj/1/gkgfxwj/20210201/546057.html)》（2021）→ `data/protection/national-key-wildlife-2021.json`
- 植物：现行《[国家重点保护野生植物名录](https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm)》（2021）→ `data/protection/national-key-wildplants-2021.json`

```bash
# 从维基百科重建名录 JSON（需网络）
npm run build:protection-list
npm run build:plant-protection-list
# 写入 / 更新 public/data 物种分片中的 status（动植物）
npm run apply:protection
```

导入 Excel（`import:excel`）与同步 Markdown（`sync:content`）时会自动匹配保护等级。组（sect.）级植物保护规则因库内无组级字段暂不自动扩及全属。

`data/raw/` 应包含动物界、植物界、真菌界名录表。

## 功能

- 生物 → 界 → 门 → 纲 → 目 → 科 → 属 → 种 浏览
- 学名 / 中文名检索
- 物种详情（名录字段 + 介绍占位）
- 按省份筛选（待分布数据）

## 技术

Vite + React + TypeScript。运行时读取 `public/data/*.json`（由导入脚本从 Markdown / Excel 生成）。

生产构建启用 Service Worker（`vite-plugin-pwa`）：预缓存应用壳；名录 JSON / 字体走运行时缓存（StaleWhileRevalidate / CacheFirst），便于二次访问与弱网。

## GitHub Pages

推送到 `master` 后，Actions 会：从 Excel 生成索引 → 构建（`base=/zoo-world/`）→ 部署。

首次需在仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

站点地址：https://lanyuechen.github.io/zoo-world/

本地模拟 Pages 构建：

```bash
npm run import:excel:index-only
npm run build:pages
npm run preview:pages
```
