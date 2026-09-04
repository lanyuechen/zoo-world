/** 将 GBIF stateProvince 等文本规范到本站省级名 */
export const CHINA_PROVINCES = [
  '北京',
  '天津',
  '河北',
  '山西',
  '内蒙古',
  '辽宁',
  '吉林',
  '黑龙江',
  '上海',
  '江苏',
  '浙江',
  '安徽',
  '福建',
  '江西',
  '山东',
  '河南',
  '湖北',
  '湖南',
  '广东',
  '广西',
  '海南',
  '重庆',
  '四川',
  '贵州',
  '云南',
  '西藏',
  '陕西',
  '甘肃',
  '青海',
  '宁夏',
  '新疆',
  '香港',
  '澳门',
  '台湾',
] as const

const ALIASES: Record<string, (typeof CHINA_PROVINCES)[number]> = {
  北京: '北京',
  北京市: '北京',
  beijing: '北京',
  天津: '天津',
  天津市: '天津',
  tianjin: '天津',
  河北: '河北',
  河北省: '河北',
  hebei: '河北',
  山西: '山西',
  山西省: '山西',
  shanxi: '山西',
  内蒙古: '内蒙古',
  内蒙古自治区: '内蒙古',
  neimenggu: '内蒙古',
  'inner mongolia': '内蒙古',
  innermongolia: '内蒙古',
  辽宁: '辽宁',
  辽宁省: '辽宁',
  liaoning: '辽宁',
  吉林: '吉林',
  吉林省: '吉林',
  jilin: '吉林',
  黑龙江: '黑龙江',
  黑龙江省: '黑龙江',
  heilongjiang: '黑龙江',
  上海: '上海',
  上海市: '上海',
  shanghai: '上海',
  江苏: '江苏',
  江苏省: '江苏',
  jiangsu: '江苏',
  浙江: '浙江',
  浙江省: '浙江',
  zhejiang: '浙江',
  安徽: '安徽',
  安徽省: '安徽',
  anhui: '安徽',
  福建: '福建',
  福建省: '福建',
  fujian: '福建',
  江西: '江西',
  江西省: '江西',
  jiangxi: '江西',
  山东: '山东',
  山东省: '山东',
  shandong: '山东',
  河南: '河南',
  河南省: '河南',
  henan: '河南',
  湖北: '湖北',
  湖北省: '湖北',
  hubei: '湖北',
  湖南: '湖南',
  湖南省: '湖南',
  hunan: '湖南',
  广东: '广东',
  广东省: '广东',
  guangdong: '广东',
  广西: '广西',
  广西壮族自治区: '广西',
  guangxi: '广西',
  海南: '海南',
  海南省: '海南',
  hainan: '海南',
  重庆: '重庆',
  重庆市: '重庆',
  chongqing: '重庆',
  四川: '四川',
  四川省: '四川',
  sichuan: '四川',
  贵州: '贵州',
  贵州省: '贵州',
  guizhou: '贵州',
  云南: '云南',
  云南省: '云南',
  yunnan: '云南',
  西藏: '西藏',
  西藏自治区: '西藏',
  xizang: '西藏',
  tibet: '西藏',
  陕西: '陕西',
  陕西省: '陕西',
  shaanxi: '陕西',
  甘肃: '甘肃',
  甘肃省: '甘肃',
  gansu: '甘肃',
  青海: '青海',
  青海省: '青海',
  qinghai: '青海',
  宁夏: '宁夏',
  宁夏回族自治区: '宁夏',
  ningxia: '宁夏',
  新疆: '新疆',
  新疆维吾尔自治区: '新疆',
  xinjiang: '新疆',
  香港: '香港',
  香港特别行政区: '香港',
  'hong kong': '香港',
  hongkong: '香港',
  澳门: '澳门',
  澳门特别行政区: '澳门',
  macao: '澳门',
  macau: '澳门',
  台湾: '台湾',
  台湾省: '台湾',
  taiwan: '台湾',
}

function keyOf(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[省市区县自治州特别行政]/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizeProvince(raw: string | null | undefined): string | null {
  if (!raw) return null
  const original = raw.normalize('NFKC').trim()
  if (!original) return null

  const direct = ALIASES[original] || ALIASES[original.toLowerCase()]
  if (direct) return direct

  const k = keyOf(original)
  if (ALIASES[k]) return ALIASES[k]

  for (const p of CHINA_PROVINCES) {
    if (original.includes(p) || k.includes(keyOf(p))) return p
  }
  return null
}

export function sortProvinces(list: Iterable<string>): string[] {
  const set = new Set(list)
  return CHINA_PROVINCES.filter((p) => set.has(p))
}
