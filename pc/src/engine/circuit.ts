/**
 * 电路求解器（MNA 改进节点分析法，W3）。
 * 支持元件：电压源 V、电阻 R（开关用极小/极大电阻模拟）。
 * 节点 0 为参考地。
 */

export interface CircuitComponent {
  type: 'V' | 'R'
  /** [正极/高端节点, 负极/低端节点] */
  nodes: [number, number]
  /** V: 电压值(伏)；R: 阻值(欧) */
  value: number
}

export interface CircuitSolution {
  /** 各节点电压（下标=节点号，0 为地 =0V） */
  nodeVoltages: number[]
  /** 各电压源的输出电流（从正极流出为正，与 components 中 V 元件顺序对应） */
  sourceCurrents: number[]
}

/** 高斯消元（带部分主元），n 很小（≤10） */
function gauss(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    if (Math.abs(d) < 1e-14) continue
    for (let c = col; c <= n; c++) M[col][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row) => row[n])
}

/**
 * MNA 求解：
 * 方程组 [G B; C 0]·[v; i] = [0; E]
 * G: 节点导纳阵 (n-1)×(n-1)；B/C: 电压源关联；E: 电压源值
 */
export function solveCircuit(components: CircuitComponent[], nodeCount: number): CircuitSolution {
  const n = nodeCount - 1 // 未知节点电压数
  const vs = components.filter((c) => c.type === 'V')
  const m = vs.length
  const size = n + m

  const A: number[][] = Array.from({ length: size }, () => new Array(size).fill(0))
  const z: number[] = new Array(size).fill(0)

  for (const c of components) {
    if (c.type !== 'R') continue
    const g = 1 / c.value
    const [a, b] = c.nodes
    if (a !== 0 && b !== 0) {
      A[a - 1][a - 1] += g
      A[b - 1][b - 1] += g
      A[a - 1][b - 1] -= g
      A[b - 1][a - 1] -= g
    } else if (a !== 0) {
      A[a - 1][a - 1] += g
    } else if (b !== 0) {
      A[b - 1][b - 1] += g
    }
  }

  vs.forEach((v, idx) => {
    const [p, q] = v.nodes
    if (p !== 0) A[p - 1][n + idx] = 1 // B
    if (q !== 0) A[q - 1][n + idx] = -1
    if (p !== 0) A[n + idx][p - 1] = 1 // C
    if (q !== 0) A[n + idx][q - 1] = -1
    z[n + idx] = v.value // E
  })

  const x = gauss(A, z)
  const nodeVoltages = [0, ...x.slice(0, n)]
  const sourceCurrents = x.slice(n)
  return { nodeVoltages, sourceCurrents }
}

/** 求流过某电阻的电流（从 nodes[0] 流向 nodes[1] 为正） */
export function currentThrough(sol: CircuitSolution, comp: CircuitComponent): number {
  const [a, b] = comp.nodes
  return (sol.nodeVoltages[a] - sol.nodeVoltages[b]) / comp.value
}
