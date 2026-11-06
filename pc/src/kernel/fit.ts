/**
 * 曲线拟合内核（纯 TS，零依赖）
 *
 * 参考思路：Concord-Consortium/codap (MIT) 的「仿真数据 → 案例表 → 统计建模」教学数据流。
 * 算法为公开数学：加权最小二乘、正规方程 / Cholesky、Levenberg–Marquardt、AIC/BIC。
 */
import { solveNormalEquations, type Matrix, type Vector, conditionNumber } from './linalg'

export interface FitResult {
  label: string
  params: Vector
  n: number
  k: number
  residuals: Vector
  ssr: number
  sst: number
  r2: number
  adjR2: number
  rmse: number
  /** 参数标准误 */
  stdErrors: Vector
  /** 参数 95% 置信区间 */
  ci95: Array<[number, number]>
  aic: number
  bic: number
  /** 设计矩阵条件数（病态诊断） */
  condition: number
  predict: (x: number) => number
}

/** 学生 t 分布 95% 双尾临界值（df 1–30 查表，其余用正态近似） */
export function studentT95(df: number): number {
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]
  if (df <= 0) return 1.96
  if (df <= 30) return table[df - 1]
  return 1.96 + 2.4 / (df * df) + 1.0 / df
}

function assembleResult(
  label: string, A: Matrix, y: Vector, params: Vector, cov: Matrix, weights: Vector | undefined,
  predict: (x: number) => number
): FitResult {
  const n = y.length
  const k = params.length
  const w = weights ?? new Array(n).fill(1)
  const fitted = A.map((row) => row.reduce((s, v, j) => s + v * (params[j] ?? 0), 0))
  const residuals = y.map((v, i) => v - fitted[i])
  let ssr = 0
  let sumY = 0
  let sumW = 0
  for (let i = 0; i < n; i++) { ssr += w[i] * residuals[i] * residuals[i]; sumY += w[i] * y[i]; sumW += w[i] }
  const meanY = sumW > 0 ? sumY / sumW : 0
  let sst = 0
  for (let i = 0; i < n; i++) sst += w[i] * (y[i] - meanY) * (y[i] - meanY)
  const dof = Math.max(1, n - k)
  const sigma2 = ssr / dof
  const stdErrors = params.map((_, j) => Math.sqrt(Math.max(0, sigma2 * (cov[j]?.[j] ?? 0))))
  const tc = studentT95(dof)
  const ci95 = params.map((p, j) => [p - tc * stdErrors[j], p + tc * stdErrors[j]] as [number, number])
  const r2 = sst > 0 ? 1 - ssr / sst : 1
  const adjR2 = n > k && sst > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : r2
  const ssrSafe = Math.max(ssr, 1e-300)
  return {
    label, params, n, k, residuals, ssr, sst, r2, adjR2,
    rmse: Math.sqrt(sigma2), stdErrors, ci95,
    aic: n * Math.log(ssrSafe / Math.max(1, n)) + 2 * k,
    bic: n * Math.log(ssrSafe / Math.max(1, n)) + k * Math.log(Math.max(2, n)),
    condition: conditionNumber(A),
    predict
  }
}

/** 通用线性模型 y ≈ Σ pⱼ·Aᵢⱼ（A 为设计矩阵） */
export function linearModelFit(A: Matrix, y: Vector, weights?: Vector, label = '线性模型', lambda = 0): FitResult {
  if (A.length !== y.length) throw new Error('linearModelFit: 样本数不一致')
  const { params, cov } = solveNormalEquations(A, y, weights, lambda)
  return assembleResult(label, A, y, params, cov, weights, (x) =>
    // 对标量 x 用第一行结构做幂级数预测（仅用于曲线绘制）
    params.reduce((s, p, j) => s + p * Math.pow(x, j), 0))
}

/** 一元线性拟合 y = a + b·x（支持逐点权重） */
export function linearFit(x: Vector, y: Vector, weights?: Vector): FitResult {
  const A: Matrix = x.map((v) => [1, v])
  const { params, cov } = solveNormalEquations(A, y, weights)
  return assembleResult('线性拟合 y = a + b·x', A, y, params, cov, weights, (t) => params[0] + params[1] * t)
}

/** 多项式最小二乘（列缩放缓解高次幂病态） */
export function polynomialFit(x: Vector, y: Vector, degree = 2, weights?: Vector): FitResult {
  if (degree < 1) throw new Error('polynomialFit: degree >= 1')
  const scale = Math.max(1e-12, ...x.map(Math.abs))
  const A: Matrix = x.map((v) => {
    const z = v / scale
    const row: number[] = []
    for (let j = 0; j <= degree; j++) row.push(Math.pow(z, j))
    return row
  })
  const { params, cov } = solveNormalEquations(A, y, weights, 1e-12)
  const predict = (t: number): number => {
    const z = t / scale
    let s = 0
    for (let j = 0; j <= degree; j++) s += params[j] * Math.pow(z, j)
    return s
  }
  const res = assembleResult(`${degree} 次多项式拟合`, A, y, params, cov, weights, predict)
  // 参数以缩放后的 z 表示，换算回原始 x 的等效系数
  res.params = params.map((p, j) => p / Math.pow(scale, j))
  return res
}

export interface NonlinearFitOptions {
  maxIterations?: number
  lambda0?: number
  tolerance?: number
  label?: string
}

/** Levenberg–Marquardt 非线性最小二乘（数值雅可比，无需导数） */
export function nonlinearFit(
  model: (x: number, p: Vector) => number,
  x: Vector,
  y: Vector,
  p0: Vector,
  opts: NonlinearFitOptions = {}
): FitResult {
  const maxIterations = opts.maxIterations ?? 200
  const tol = opts.tolerance ?? 1e-10
  let lambda = opts.lambda0 ?? 1e-3
  let p = p0.slice()
  const n = x.length
  const evalModel = (pp: Vector): Vector => x.map((v) => model(v, pp))
  const cost = (pred: Vector): number => pred.reduce((s, v, i) => s + (y[i] - v) * (y[i] - v), 0)
  let pred = evalModel(p)
  let ssr = cost(pred)
  let J: Matrix = []

  for (let it = 0; it < maxIterations; it++) {
    const eps = 1e-6
    J = x.map((v) => {
      const base = model(v, p)
      return p.map((pj, j) => {
        const pp = p.slice()
        pp[j] = pj + eps * Math.max(1, Math.abs(pj))
        return (model(v, pp) - base) / (eps * Math.max(1, Math.abs(pj)))
      })
    })
    const residual = y.map((v, i) => v - pred[i])
    const { params: delta } = solveNormalEquations(J, residual, undefined, lambda)
    const candidate = p.map((v, j) => v + delta[j])
    const cp = evalModel(candidate)
    const cs = cost(cp)
    if (Number.isFinite(cs) && cs < ssr) {
      const improvement = ssr - cs
      p = candidate
      pred = cp
      ssr = cs
      lambda = Math.max(1e-12, lambda / 3)
      if (improvement < tol * Math.max(1, ssr)) break
    } else {
      lambda = Math.min(1e12, lambda * 5)
    }
  }

  const residual = y.map((v, i) => v - pred[i])
  const { cov } = solveNormalEquations(J.length ? J : x.map(() => p.map(() => 0)), residual, undefined, lambda)
  const k = p.length
  let sumY = 0
  for (const v of y) sumY += v
  const meanY = sumY / Math.max(1, n)
  let sst = 0
  for (const v of y) sst += (v - meanY) * (v - meanY)
  const dof = Math.max(1, n - k)
  const sigma2 = ssr / dof
  const stdErrors = p.map((_, j) => Math.sqrt(Math.max(0, sigma2 * (cov[j]?.[j] ?? 0))))
  const tc = studentT95(dof)
  const r2 = sst > 0 ? 1 - ssr / sst : 1
  const ssrSafe = Math.max(ssr, 1e-300)
  return {
    label: opts.label ?? '非线性拟合',
    params: p, n, k, residuals: residual, ssr, sst, r2,
    adjR2: n > k && sst > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : r2,
    rmse: Math.sqrt(sigma2), stdErrors,
    ci95: p.map((v, j) => [v - tc * stdErrors[j], v + tc * stdErrors[j]] as [number, number]),
    aic: n * Math.log(ssrSafe / Math.max(1, n)) + 2 * k,
    bic: n * Math.log(ssrSafe / Math.max(1, n)) + k * Math.log(Math.max(2, n)),
    // 用 Gauss-Newton 正规矩阵 JᵀJ 的条件数衡量参数可辨识性
    condition: (() => {
      if (!J.length) return Infinity
      const k = p.length
      const gram: Matrix = new Array(k).fill(0).map(() => new Array(k).fill(0))
      for (const row of J) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) gram[i][j] += row[i] * row[j]
      return conditionNumber(gram)
    })(),
    predict: (t) => model(t, p)
  }
}

/** 从拟合结果生成可写入实验报告的文字结论 */
export function describeFit(f: FitResult, paramNames: string[] = []): string {
  const terms = f.params.map((p, i) => {
    const name = paramNames[i] ?? `p${i}`
    const err = f.stdErrors[i] ?? 0
    return `${name} = ${p.toPrecision(5)} ± ${err.toPrecision(3)}`
  })
  return `${f.label}：${terms.join('，')}；R² = ${f.r2.toFixed(5)}，调整 R² = ${f.adjR2.toFixed(5)}，RMSE = ${f.rmse.toPrecision(4)}，AIC = ${f.aic.toFixed(2)}。`
}
