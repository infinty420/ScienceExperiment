/**
 * 统计与测量不确定度内核（纯 TS，零依赖）
 *
 * 算法为公开数学：GUM 不确定度传播（JIS/ISO Guide to the Expression of Uncertainty in
 * Measurement 的一阶泰勒法）、蒙特卡洛传播（GUM-S1 思想）、Cooley–Tukey FFT、
 * Grubbs/IQR 离群检验、Welch t 检验（p 值用正则化不完全 β 函数）。
 */
import { studentT95 } from './fit'
import { RNG } from './rng'
import type { Vector } from './linalg'

export function mean(a: Vector): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
}

export function variance(a: Vector, sample = true): number {
  const n = a.length
  if (n < 2) return 0
  const m = mean(a)
  let s = 0
  for (const v of a) s += (v - m) * (v - m)
  return s / (sample ? n - 1 : n)
}

export function stdev(a: Vector, sample = true): number {
  return Math.sqrt(variance(a, sample))
}

export function quantile(sorted: Vector, q: number): number {
  if (!sorted.length) return NaN
  const p = Math.min(1, Math.max(0, q))
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function median(a: Vector): number {
  return quantile(a.slice().sort((x, y) => x - y), 0.5)
}

export function skewness(a: Vector): number {
  const n = a.length
  if (n < 3) return 0
  const m = mean(a)
  const s = stdev(a, false)
  if (s === 0) return 0
  return a.reduce((acc, v) => acc + Math.pow((v - m) / s, 3), 0) / n
}

export function excessKurtosis(a: Vector): number {
  const n = a.length
  if (n < 4) return 0
  const m = mean(a)
  const s = stdev(a, false)
  if (s === 0) return 0
  return a.reduce((acc, v) => acc + Math.pow((v - m) / s, 4), 0) / n - 3
}

export function covariance(a: Vector, b: Vector, sample = true): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (sample ? n - 1 : n)
}

export function pearsonCorrelation(a: Vector, b: Vector): number {
  const sa = stdev(a)
  const sb = stdev(b)
  if (sa === 0 || sb === 0) return 0
  return covariance(a, b) / (sa * sb)
}

export function correlationMatrix(columns: Vector[]): number[][] {
  return columns.map((a) => columns.map((b) => pearsonCorrelation(a, b)))
}

export function outliersIQR(a: Vector, k = 1.5): number[] {
  const sorted = a.slice().sort((x, y) => x - y)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const lo = q1 - k * (q3 - q1)
  const hi = q3 + k * (q3 - q1)
  const out: number[] = []
  a.forEach((v, i) => { if (v < lo || v > hi) out.push(i) })
  return out
}

/** Grubbs 单离群检验（临界值用 5% 显著性近似；教学用途） */
export function grubbsTest(a: Vector): { index: number; G: number; critical: number; isOutlier: boolean } | null {
  const n = a.length
  if (n < 3) return null
  const m = mean(a)
  const s = stdev(a)
  if (s === 0) return null
  let index = 0
  let best = -1
  a.forEach((v, i) => { const g = Math.abs(v - m) / s; if (g > best) { best = g; index = i } })
  const df = Math.max(1, n - 2)
  const t = studentT95(df)
  const critical = ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (df + t * t))
  return { index, G: best, critical, isOutlier: best > critical }
}

export interface GUMResult {
  value: number
  sigma: number
  relative: number
  gradient: Vector
  /** 各输入量的不确定度贡献 |∂f/∂pᵢ·σᵢ| */
  contributions: Vector
}

/**
 * GUM 一阶不确定度传播：u_c²(y) = ∇fᵀ C ∇f
 * 偏导用中心差分；C 缺省为 diag(σ²)，也可传入完整协方差矩阵（相关输入量）。
 */
export function propagateUncertainty(
  f: (p: Vector) => number,
  p: Vector,
  sigma: Vector,
  covarianceMatrix?: number[][]
): GUMResult {
  const value = f(p)
  const gradient = p.map((pj, j) => {
    const h = 1e-6 * Math.max(1, Math.abs(pj))
    const plus = p.slice(); plus[j] += h
    const minus = p.slice(); minus[j] -= h
    return (f(plus) - f(minus)) / (2 * h)
  })
  let varianceSum = 0
  const contributions: Vector = []
  if (covarianceMatrix) {
    for (let i = 0; i < gradient.length; i++) {
      for (let j = 0; j < gradient.length; j++) {
        varianceSum += gradient[i] * gradient[j] * (covarianceMatrix[i]?.[j] ?? 0)
      }
    }
  }
  for (let i = 0; i < gradient.length; i++) {
    const c = Math.abs(gradient[i] * (sigma[i] ?? 0))
    contributions.push(c)
    if (!covarianceMatrix) varianceSum += c * c
  }
  const sigmaY = Math.sqrt(Math.max(0, varianceSum))
  return { value, sigma: sigmaY, relative: Math.abs(value) > 1e-12 ? sigmaY / Math.abs(value) : 0, gradient, contributions }
}

export interface MCResult {
  mean: number
  sd: number
  ci95: [number, number]
  median: number
  samples: number
  /** 直方图（20 桶） */
  histogram: Array<{ from: number; to: number; count: number }>
}

/** 蒙特卡洛不确定度传播（GUM-S1 思想），支持可复现种子 */
export function monteCarloUncertainty(
  f: (p: Vector) => number,
  p: Vector,
  sigma: Vector,
  seed: number | string | RNG = 20261106,
  samples = 10000
): MCResult {
  const rng = seed instanceof RNG ? seed : new RNG(seed)
  const vals: Vector = []
  for (let s = 0; s < samples; s++) {
    const draw = p.map((v, i) => v + rng.normal(0, sigma[i] ?? 0))
    const y = f(draw)
    if (Number.isFinite(y)) vals.push(y)
  }
  const sorted = vals.slice().sort((x, y) => x - y)
  let lo = Infinity
  let hi = -Infinity
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0 }
  const bins = 20
  const histogram = new Array(bins).fill(0).map((_, b) => {
    const from = lo + (hi - lo) * b / bins
    const to = lo + (hi - lo) * (b + 1) / bins
    return { from, to, count: 0 }
  })
  for (const v of vals) {
    const idx = hi > lo ? Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins)) : 0
    histogram[idx].count++
  }
  return {
    mean: mean(vals), sd: stdev(vals), ci95: [quantile(sorted, 0.025), quantile(sorted, 0.975)],
    median: median(vals), samples: vals.length, histogram
  }
}

/* ---------- 频谱分析 ---------- */

export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

export interface FFTResult { re: Vector; im: Vector; n: number }

/** 迭代 Cooley–Tukey 基 2 FFT（自动补零到 2 的幂） */
export function fft(reInput: Vector, imInput?: Vector): FFTResult {
  const n = nextPowerOfTwo(reInput.length)
  const re = new Array(n).fill(0)
  const im = new Array(n).fill(0)
  for (let i = 0; i < reInput.length; i++) { re[i] = reInput[i]; im[i] = imInput?.[i] ?? 0 }
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
  return { re, im, n }
}

export function hannWindow(signal: Vector): Vector {
  const n = signal.length
  return signal.map((v, i) => v * 0.5 * (1 - Math.cos(2 * Math.PI * i / Math.max(1, n - 1))))
}

export interface Spectrum {
  freq: Vector
  amplitude: Vector
  phase: Vector
  sampleRate: number
  n: number
}

/** 单边幅度谱（去均值 + 可选 Hann 窗），amp = 2|Xₖ|/N */
export function powerSpectrum(signal: Vector, sampleRate: number, window = true): Spectrum {
  const centered = signal.map((v) => v - mean(signal))
  const src = window ? hannWindow(centered) : centered
  const { re, im, n } = fft(src)
  const half = Math.floor(n / 2)
  const freq: Vector = []
  const amplitude: Vector = []
  const phase: Vector = []
  for (let k = 0; k <= half; k++) {
    freq.push(k * sampleRate / n)
    amplitude.push(2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / n)
    phase.push(Math.atan2(im[k], re[k]))
  }
  return { freq, amplitude, phase, sampleRate, n }
}

export function dominantFrequency(signal: Vector, sampleRate: number): { freq: number; amplitude: number; period: number } | null {
  const s = powerSpectrum(signal, sampleRate)
  let idx = 1
  for (let k = 2; k < s.amplitude.length; k++) if (s.amplitude[k] > s.amplitude[idx]) idx = k
  if (!Number.isFinite(s.amplitude[idx]) || s.amplitude[idx] <= 0) return null
  const freq = s.freq[idx]
  return { freq, amplitude: s.amplitude[idx], period: freq > 0 ? 1 / freq : Infinity }
}

/* ---------- 假设检验 ---------- */

function logGamma(z: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

function betacf(a: number, b: number, x: number): number {
  const eps = 3e-12
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < eps) break
  }
  return h
}

/** 正则化不完全 β 函数 Iₓ(a,b) */
export function regularizedBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? front * betacf(a, b, x) / a
    : 1 - Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)) * betacf(b, a, 1 - x) / b
}

/** Welch 双样本 t 检验（不假设等方差），返回双尾 p 值 */
export function welchTTest(a: Vector, b: Vector): { t: number; df: number; p: number; meanDiff: number } {
  const na = a.length
  const nb = b.length
  const va = variance(a) / Math.max(1, na)
  const vb = variance(b) / Math.max(1, nb)
  const t = (mean(a) - mean(b)) / Math.sqrt(Math.max(1e-300, va + vb))
  const denom = (va * va) / Math.max(1, na - 1) + (vb * vb) / Math.max(1, nb - 1)
  const df = denom > 0 ? Math.pow(va + vb, 2) / denom : na + nb - 2
  const p = regularizedBeta(df / 2, 0.5, df / (df + t * t))
  return { t, df, p: Math.min(1, Math.max(0, p)), meanDiff: mean(a) - mean(b) }
}

export function movingAverage(a: Vector, windowSize: number): Vector {
  const w = Math.max(1, Math.floor(windowSize))
  const out: Vector = []
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i]
    if (i >= w) sum -= a[i - w]
    out.push(sum / Math.min(w, i + 1))
  }
  return out
}

/** 去除线性趋势（频谱分析前预处理） */
export function detrend(a: Vector): Vector {
  const n = a.length
  if (n < 2) return a.slice()
  const x: Vector = a.map((_, i) => i)
  const mx = mean(x)
  const my = mean(a)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (a[i] - my); den += (x[i] - mx) * (x[i] - mx) }
  const slope = den > 0 ? num / den : 0
  return a.map((v, i) => v - (my + slope * (i - mx)))
}
