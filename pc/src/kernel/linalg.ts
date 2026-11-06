/**
 * 线性代数内核（纯 TS，零依赖）
 *
 * 参考思路：Kunz5/circuit-lab (MIT)、DavidWang1231/minispice (MIT)、
 * dmitry4287474/physviz-engine (Apache-2.0) 中「部分主元 LU 分解 + stamp 组装」的公开算法。
 * 本文件为独立实现，未复制任何第三方代码。
 */
export type Vector = number[]
export type Matrix = number[][]

export function zeros(rows: number, cols: number): Matrix {
  const a: Matrix = new Array(rows)
  for (let i = 0; i < rows; i++) a[i] = new Array(cols).fill(0)
  return a
}

export function identity(n: number): Matrix {
  const a = zeros(n, n)
  for (let i = 0; i < n; i++) a[i][i] = 1
  return a
}

export function cloneMatrix(a: Matrix): Matrix {
  return a.map((row) => row.slice())
}

export function transpose(a: Matrix): Matrix {
  const m = a.length
  const n = m > 0 ? a[0].length : 0
  const out = zeros(n, m)
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) out[j][i] = a[i][j]
  return out
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const m = a.length
  const k = m > 0 ? a[0].length : 0
  const n = b.length > 0 ? b[0].length : 0
  const out = zeros(m, n)
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p]
      if (aip === 0) continue
      for (let j = 0; j < n; j++) out[i][j] += aip * b[p][j]
    }
  }
  return out
}

export function matVec(a: Matrix, x: Vector): Vector {
  return a.map((row) => {
    let s = 0
    for (let j = 0; j < row.length; j++) s += row[j] * (x[j] ?? 0)
    return s
  })
}

export function dot(a: Vector, b: Vector): number {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]
  return s
}

export function norm2(a: Vector): number {
  return Math.sqrt(dot(a, a))
}

export function normInf(a: Vector): number {
  let m = 0
  for (const v of a) m = Math.max(m, Math.abs(v))
  return m
}

/** 矩阵 1-范数（最大列和） */
export function matrixNorm1(a: Matrix): number {
  let best = 0
  const n = a.length > 0 ? a[0].length : 0
  for (let j = 0; j < n; j++) {
    let s = 0
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i][j])
    best = Math.max(best, s)
  }
  return best
}

export interface LUResult {
  /** 就地 LU（含主元交换后的紧凑存储） */
  lu: Matrix
  /** piv[i] 记录第 i 步实际使用的主元行 */
  piv: number[]
  /** 行列式符号 */
  sign: number
  /** 是否检测到（相对尺度）奇异 */
  singular: boolean
  /** 相对容差 */
  tolerance: number
}

/**
 * 部分主元 LU 分解（Doolittle，PA = LU）。
 * 主元按「该列绝对值最大」选取；奇异判定用列尺度相对容差，
 * 避免把量级很小但合法的矩阵误判为退化（电路矩阵常跨 1e-12 ~ 1e6）。
 */
export function luDecompose(input: Matrix, eps = 1e-12): LUResult {
  const n = input.length
  if (n === 0) return { lu: [], piv: [], sign: 1, singular: false, tolerance: eps }
  for (const row of input) {
    if (row.length !== n) throw new Error('luDecompose: 矩阵必须为方阵')
  }
  const lu = cloneMatrix(input)
  const piv: number[] = []
  for (let i = 0; i < n; i++) piv.push(i)
  let sign = 1
  let singular = false

  // 每个列的尺度，用于相对奇异判定
  const colScale: number[] = new Array(n).fill(0)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) colScale[j] = Math.max(colScale[j], Math.abs(lu[i][j]))
  }

  for (let k = 0; k < n; k++) {
    let p = k
    let max = Math.abs(lu[k][k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i][k])
      if (v > max) { max = v; p = i }
    }
    const localTol = eps * Math.max(1, colScale[k])
    if (max <= localTol) { singular = true; continue }
    if (p !== k) {
      const tmp = lu[p]; lu[p] = lu[k]; lu[k] = tmp
      const t = piv[p]; piv[p] = piv[k]; piv[k] = t
      sign = -sign
    }
    const pivot = lu[k][k]
    for (let i = k + 1; i < n; i++) {
      const f = lu[i][k] / pivot
      lu[i][k] = f
      if (f === 0) continue
      for (let j = k + 1; j < n; j++) lu[i][j] -= f * lu[k][j]
    }
  }
  return { lu, piv, sign, singular, tolerance: eps }
}

/** 用已分解的 LU 解 Ax = b（自动应用主元置换） */
export function luSolve(res: LUResult, b: Vector): Vector {
  const n = res.lu.length
  if (b.length !== n) throw new Error('luSolve: 维度不匹配')
  const x: Vector = new Array(n)
  for (let i = 0; i < n; i++) x[i] = b[res.piv[i]]
  // 前向替换 L y = Pb（L 单位下三角，不含对角）
  for (let i = 1; i < n; i++) {
    let s = x[i]
    for (let j = 0; j < i; j++) s -= res.lu[i][j] * x[j]
    x[i] = s
  }
  // 回代 U x = y
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]
    for (let j = i + 1; j < n; j++) s -= res.lu[i][j] * x[j]
    const d = res.lu[i][i]
    x[i] = Math.abs(d) < res.tolerance ? 0 : s / d
  }
  return x
}

/** 一次分解、多次求解（瞬态分析主用） */
export function luSolveMany(res: LUResult, rhs: Vector[]): Vector[] {
  return rhs.map((b) => luSolve(res, b))
}

export function solveLinear(a: Matrix, b: Vector): Vector {
  return luSolve(luDecompose(a), b)
}

export function invert(a: Matrix): Matrix {
  const n = a.length
  const res = luDecompose(a)
  if (res.singular) throw new Error('invert: 矩阵奇异')
  const inv = zeros(n, n)
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0)
    e[j] = 1
    const col = luSolve(res, e)
    for (let i = 0; i < n; i++) inv[i][j] = col[i]
  }
  return inv
}

export function determinant(a: Matrix): number {
  const res = luDecompose(a)
  if (res.singular) return 0
  let d = res.sign
  for (let i = 0; i < res.lu.length; i++) d *= res.lu[i][i]
  return d
}

/** 1-范数条件数估计 κ(A) = ‖A‖₁·‖A⁻¹‖₁，用于判断拟合/电路的病态程度 */
export function conditionNumber(a: Matrix): number {
  try {
    return matrixNorm1(a) * matrixNorm1(invert(a))
  } catch {
    return Infinity
  }
}

/** 对称正定方程组的 Cholesky 分解（LM/最小二乘正规方程用，比 LU 更稳） */
export function cholesky(a: Matrix): Matrix {
  const n = a.length
  const l = zeros(n, n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j]
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k]
      if (i === j) {
        if (s <= 0) throw new Error('cholesky: 矩阵非正定')
        l[i][j] = Math.sqrt(s)
      } else {
        l[i][j] = s / l[j][j]
      }
    }
  }
  return l
}

/** 解 LLᵀx = b */
export function choleskySolve(l: Matrix, b: Vector): Vector {
  const n = l.length
  const y: Vector = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let j = 0; j < i; j++) s -= l[i][j] * y[j]
    y[i] = s / l[i][i]
  }
  const x: Vector = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let j = i + 1; j < n; j++) s -= l[j][i] * x[j]
    x[i] = s / l[i][i]
  }
  return x
}

/** 加权正规方程 (AᵀWA + λI) p = AᵀWy，λ 为 Tikhonov 正则（应对病态设计矩阵） */
export function solveNormalEquations(a: Matrix, y: Vector, weights?: Vector, lambda = 0): { params: Vector; cov: Matrix } {
  const m = a.length
  const n = m > 0 ? a[0].length : 0
  const w = weights ?? new Array(m).fill(1)
  const ata = zeros(n, n)
  const aty = new Array(n).fill(0)
  for (let i = 0; i < m; i++) {
    const wi = w[i]
    for (let j = 0; j < n; j++) {
      aty[j] += wi * a[i][j] * y[i]
      for (let k = 0; k < n; k++) ata[j][k] += wi * a[i][j] * a[i][k]
    }
  }
  for (let j = 0; j < n; j++) ata[j][j] += lambda
  let params: Vector
  let cov: Matrix
  try {
    const l = cholesky(ata)
    params = choleskySolve(l, aty)
    cov = invert(ata)
  } catch {
    const res = luDecompose(ata)
    params = luSolve(res, aty)
    cov = res.singular ? zeros(n, n) : invert(ata)
  }
  return { params, cov }
}
