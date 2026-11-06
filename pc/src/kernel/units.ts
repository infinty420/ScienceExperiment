/**
 * SI 量纲与单位内核（纯 TS，零依赖）
 *
 * 量纲向量顺序：[长度 m, 质量 kg, 时间 s, 电流 A, 温度 K, 物质的量 mol, 发光强度 cd]
 * 用途：实验参数量纲一致性校验（例如把「秒」填进「重力加速度」栏会在加载期被拦下）。
 */
export type Dimension = [number, number, number, number, number, number, number]
export const DIMENSION_ZERO: Dimension = [0, 0, 0, 0, 0, 0, 0]

export interface UnitDef {
  dim: Dimension
  /** 换算到 SI 的乘性因子 */
  factor: number
  /** 加性偏移（仅 degC 这类仿射单位） */
  offset?: number
  label: string
}

const D = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, cd = 0): Dimension => [m, kg, s, A, K, mol, cd]

export const UNITS: Record<string, UnitDef> = {
  '1': { dim: D(), factor: 1, label: '无量纲' },
  '%': { dim: D(), factor: 0.01, label: '百分比' },
  rad: { dim: D(), factor: 1, label: '弧度' },
  deg: { dim: D(), factor: Math.PI / 180, label: '角度' },
  m: { dim: D(1), factor: 1, label: '米' },
  cm: { dim: D(1), factor: 0.01, label: '厘米' },
  mm: { dim: D(1), factor: 0.001, label: '毫米' },
  km: { dim: D(1), factor: 1000, label: '千米' },
  um: { dim: D(1), factor: 1e-6, label: '微米' },
  nm: { dim: D(1), factor: 1e-9, label: '纳米' },
  kg: { dim: D(0, 1), factor: 1, label: '千克' },
  g: { dim: D(0, 1), factor: 0.001, label: '克' },
  mg: { dim: D(0, 1), factor: 1e-6, label: '毫克' },
  s: { dim: D(0, 0, 1), factor: 1, label: '秒' },
  ms: { dim: D(0, 0, 1), factor: 0.001, label: '毫秒' },
  min: { dim: D(0, 0, 1), factor: 60, label: '分钟' },
  h: { dim: D(0, 0, 1), factor: 3600, label: '小时' },
  A: { dim: D(0, 0, 0, 1), factor: 1, label: '安培' },
  mA: { dim: D(0, 0, 0, 1), factor: 0.001, label: '毫安' },
  K: { dim: D(0, 0, 0, 0, 1), factor: 1, label: '开尔文' },
  degC: { dim: D(0, 0, 0, 0, 1), factor: 1, offset: 273.15, label: '摄氏度' },
  mol: { dim: D(0, 0, 0, 0, 0, 1), factor: 1, label: '摩尔' },
  mmol: { dim: D(0, 0, 0, 0, 0, 1), factor: 0.001, label: '毫摩尔' },
  cd: { dim: D(0, 0, 0, 0, 0, 0, 1), factor: 1, label: '坎德拉' },
  Hz: { dim: D(0, 0, -1), factor: 1, label: '赫兹' },
  kHz: { dim: D(0, 0, -1), factor: 1000, label: '千赫兹' },
  N: { dim: D(1, 1, -2), factor: 1, label: '牛顿' },
  J: { dim: D(2, 1, -2), factor: 1, label: '焦耳' },
  W: { dim: D(2, 1, -3), factor: 1, label: '瓦特' },
  Pa: { dim: D(-1, 1, -2), factor: 1, label: '帕斯卡' },
  Ccharge: { dim: D(0, 0, 1, 1), factor: 1, label: '库仑' },
  V: { dim: D(2, 1, -3, -1), factor: 1, label: '伏特' },
  mV: { dim: D(2, 1, -3, -1), factor: 0.001, label: '毫伏' },
  ohm: { dim: D(2, 1, -3, -2), factor: 1, label: '欧姆' },
  kohm: { dim: D(2, 1, -3, -2), factor: 1000, label: '千欧' },
  F: { dim: D(-2, -1, 4, 2), factor: 1, label: '法拉' },
  uF: { dim: D(-2, -1, 4, 2), factor: 1e-6, label: '微法' },
  H: { dim: D(2, 1, -2, -2), factor: 1, label: '亨利' },
  mH: { dim: D(2, 1, -2, -2), factor: 0.001, label: '毫亨' },
  L: { dim: D(3), factor: 0.001, label: '升' },
  mL: { dim: D(3), factor: 1e-6, label: '毫升' },
  'm/s': { dim: D(1, 0, -1), factor: 1, label: '米每秒' },
  'm/s^2': { dim: D(1, 0, -2), factor: 1, label: '米每二次方秒' },
  'mol/L': { dim: D(-3, 0, 0, 0, 0, 1), factor: 1000, label: '摩尔每升' },
  // 复合/教学常用写法（整体注册，避免解析器遇到括号）
  'N/m': { dim: D(0, 1, -2), factor: 1, label: '牛每米' },
  'μmol/(L·min)': { dim: D(-3, 0, -1, 0, 0, 1), factor: 1e-6 / (1e-3 * 60), label: '微摩尔每升每分钟' },
  'μmol/L': { dim: D(-3, 0, 0, 0, 0, 1), factor: 1e-3, label: '微摩尔每升' },
  'mol/(L·s)': { dim: D(-3, 0, -1, 0, 0, 1), factor: 1000, label: '摩尔每升每秒' },
  'J/(kg·K)': { dim: D(2, 0, -2, 0, -1), factor: 1, label: '焦每千克每开尔文' }
}

/** 实验包 scene.json 里常见的 Unicode / 上标写法别名 */
const UNIT_ALIASES: Record<string, string> = {
  '°': 'deg',
  '℃': 'degC',
  'degCelsius': 'degC',
  'm/s²': 'm/s^2',
  'm/s2': 'm/s^2',
  'Ω': 'ohm',
  'Ohm': 'ohm',
  'μF': 'uF',
  'µF': 'uF',
  'cm³': 'mL',
  's²': 's^2',
  '×': '1'
}

export function getUnit(name: string): UnitDef | undefined {
  const key = name.trim()
  return UNITS[key] ?? UNITS[UNIT_ALIASES[key] ?? '']
}

/** 数值 → SI 基准值 */
export function toSI(value: number, unit: string): number {
  const u = getUnit(unit)
  if (!u) throw new Error(`toSI: 未知单位 ${unit}`)
  return (value + (u.offset ?? 0)) * u.factor
}

/** SI 基准值 → 数值 */
export function fromSI(si: number, unit: string): number {
  const u = getUnit(unit)
  if (!u) throw new Error(`fromSI: 未知单位 ${unit}`)
  return si / u.factor - (u.offset ?? 0)
}

/** 单位换算，自动做量纲一致性检查 */
export function convert(value: number, from: string, to: string): number {
  const a = getUnit(from)
  const b = getUnit(to)
  if (!a || !b) throw new Error(`convert: 未知单位 ${from} -> ${to}`)
  if (!sameDimension(a.dim, b.dim)) throw new Error(`convert: 量纲不一致 ${from} -> ${to}`)
  return fromSI(toSI(value, from), to)
}

export function sameDimension(a: Dimension, b: Dimension): boolean {
  for (let i = 0; i < 7; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false
  return true
}

export function addDimension(a: Dimension, b: Dimension, sign = 1): Dimension {
  return a.map((v, i) => v + sign * b[i]) as Dimension
}

export function scaleDimension(a: Dimension, k: number): Dimension {
  return a.map((v) => v * k) as Dimension
}

/**
 * 解析复合单位表达式，例如 "kg*m/s^2"、"N*m"、"1/s"。
 * 不支持括号（教学场景足够），未知项返回 null。
 */
export function dimensionOf(expr: string): Dimension | null {
  const src = expr.trim()
  if (!src) return null
  if (getUnit(src)) return getUnit(src)!.dim.slice() as Dimension
  const slash = src.split('/')
  if (slash.length > 2) return null
  const parseSide = (side: string, sign: number): Dimension | null => {
    let out = DIMENSION_ZERO.slice() as Dimension
    for (const raw of side.split('*')) {
      const term = raw.trim()
      if (!term) return null
      const m = term.match(/^([A-Za-z%]+|1)(?:\^(-?\d+(?:\.\d+)?))?$/)
      if (!m) return null
      const name = m[1]
      const exp = m[2] ? Number(m[2]) : 1
      if (name === '1') continue
      const u = getUnit(name)
      if (!u) return null
      out = addDimension(out, scaleDimension(u.dim, exp), sign)
    }
    return out
  }
  const num = parseSide(slash[0], 1)
  if (!num) return null
  if (slash.length === 1) return num
  const den = parseSide(slash[1], -1)
  return den ? addDimension(num, den, 1) : null
}

export function formatDimension(dim: Dimension): string {
  const names = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd']
  const parts: string[] = []
  for (let i = 0; i < 7; i++) {
    if (dim[i] === 0) continue
    parts.push(dim[i] === 1 ? names[i] : `${names[i]}^${dim[i]}`)
  }
  return parts.length ? parts.join('·') : '1（无量纲）'
}

export interface DimensionCheck {
  expr: string
  ok: boolean
  reason?: string
  dim?: Dimension
}

/** 批量校验一组「单位表达式 → 期望量纲」声明 */
export function checkDimensions(pairs: Array<{ expr: string; expect: string }>): DimensionCheck[] {
  return pairs.map(({ expr, expect }) => {
    const got = dimensionOf(expr)
    const want = dimensionOf(expect)
    if (!got) return { expr, ok: false, reason: `无法解析单位 ${expr}` }
    if (!want) return { expr, ok: false, reason: `无法解析期望量纲 ${expect}` }
    if (!sameDimension(got, want)) {
      return { expr, ok: false, reason: `量纲不匹配：${formatDimension(got)} ≠ ${formatDimension(want)}`, dim: got }
    }
    return { expr, ok: true, dim: got }
  })
}
