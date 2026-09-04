/**
 * 向 GBIF 申请中国区域 occurrence 下载（country=CN + 有坐标）
 *
 * 环境变量：
 *   GBIF_USER / GBIF_PASSWORD / GBIF_EMAIL
 *
 * 用法：
 *   GBIF_USER=... GBIF_PASSWORD=... GBIF_EMAIL=... npm run gbif:request
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'data', 'gbif')

const user = process.env.GBIF_USER || ''
const password = process.env.GBIF_PASSWORD || ''
const email = process.env.GBIF_EMAIL || ''

async function main() {
  if (!user || !password || !email) {
    console.error('请设置 GBIF_USER、GBIF_PASSWORD、GBIF_EMAIL')
    process.exit(1)
  }

  const body = {
    creator: user,
    notificationAddresses: [email],
    sendNotification: true,
    format: 'SIMPLE_CSV',
    predicate: {
      type: 'and',
      predicates: [
        { type: 'equals', key: 'COUNTRY', value: 'CN' },
        { type: 'equals', key: 'HAS_COORDINATE', value: 'true' },
        { type: 'equals', key: 'HAS_GEOSPATIAL_ISSUE', value: 'false' },
      ],
    },
  }

  const res = await fetch('https://api.gbif.org/v1/occurrence/download/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    console.error(`申请失败 ${res.status}: ${text}`)
    process.exit(1)
  }

  const downloadKey = text.replace(/"/g, '').trim()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const meta = {
    downloadKey,
    requestedAt: new Date().toISOString(),
    predicate: body.predicate,
    statusUrl: `https://api.gbif.org/v1/occurrence/download/${downloadKey}`,
    downloadUrl: `https://api.gbif.org/v1/occurrence/download/request/${downloadKey}`,
    notes: [
      '勿作主分类；仅用于学名校验辅助、省级分布与地图点位',
      '完成后将 zip 放到 data/gbif/raw/ 并运行 npm run gbif:process',
    ],
  }
  fs.writeFileSync(path.join(OUT_DIR, 'last-download-request.json'), JSON.stringify(meta, null, 2))
  console.log('已申请下载:', downloadKey)
  console.log('状态:', meta.statusUrl)
  console.log('完成后下载 zip，解压 CSV 到 data/gbif/raw/ 后运行 npm run gbif:process')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
