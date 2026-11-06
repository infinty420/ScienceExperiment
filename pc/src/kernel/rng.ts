/**
 * 可复现随机数内核（纯 TS，零依赖）
 * 实验快照通过固定 seed 复跑，保证「同一快照 → 同一数据」。
 */
export function hashSeed(input: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export class RNG {
  private state: number
  private spare: number | null = null
  readonly seed: number

  constructor(seed: number | string = 0x5c11ab) {
    this.seed = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0
    this.state = this.seed || 0x9e3779b9
  }

  /** mulberry32：32 位状态、周期 2³²、无浮点漂移 */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  uniform(a = 0, b = 1): number {
    return a + (b - a) * this.next()
  }

  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1))
  }

  /** Box-Muller（缓存第二个正态样本） */
  normal(mu = 0, sigma = 1): number {
    if (this.spare !== null) {
      const v = this.spare
      this.spare = null
      return mu + sigma * v
    }
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    const r = Math.sqrt(-2 * Math.log(u))
    const theta = 2 * Math.PI * v
    this.spare = r * Math.sin(theta)
    return mu + sigma * r * Math.cos(theta)
  }

  /** 截断正态，避免仪器读数出现物理上不可能的负值 */
  truncatedNormal(mu: number, sigma: number, min = -Infinity, max = Infinity): number {
    for (let i = 0; i < 32; i++) {
      const x = this.normal(mu, sigma)
      if (x >= min && x <= max) return x
    }
    return Math.min(max, Math.max(min, mu))
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = a[i]; a[i] = a[j]; a[j] = t
    }
    return a
  }

  /** 派生独立子流（同一快照下不同模块互不干扰） */
  fork(tag: string): RNG {
    return new RNG(hashSeed(`${this.seed}:${tag}`))
  }
}

/** 从任意结构生成稳定种子（用于快照哈希输入） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}
