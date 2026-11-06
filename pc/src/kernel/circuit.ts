/**
 * 电路仿真内核：改进节点分析（MNA）+ 部分主元 LU（纯 TS，零依赖）
 *
 * 参考思路：Kunz5/circuit-lab (MIT)、DavidWang1231/minispice (MIT)、
 * dmitry4287474/physviz-engine (Apache-2.0) 中公开的 MNA stamping、
 * 后向欧拉 companion 模型、Newton-Raphson + gmin homotopy、复数系统实嵌入。
 * 本文件为独立实现，未复制任何第三方代码；GPL-2.0 的 CircuitJS1 未参与实现参考。
 */
import { luDecompose, luSolve, zeros, conditionNumber, type Matrix, type Vector } from './linalg'

export type DeviceType = 'R' | 'V' | 'I' | 'C' | 'L' | 'D'

export interface Device {
  id: string
  type: DeviceType
  /** 正端节点（0 = 地） */
  n1: number
  /** 负端节点（0 = 地） */
  n2: number
  /** R:Ω / V:V / I:A / C:F / L:H / D:饱和电流 Is(A) */
  value: number
  /** 时变源：覆盖 value，参数 t 为秒 */
  source?: (t: number) => number
  /** 二极管发射系数（缺省 1） */
  emission?: number
}

export interface Circuit {
  nodeCount: number
  devices: Device[]
}

export interface SolveOptions {
  t?: number
  /** 传入则启用 C/L 后向欧拉 companion 模型 */
  dt?: number
  /** t-h 时刻各支路电压（索引为设备在数组中的下标） */
  prevVoltages?: Vector
  /** t-h 时刻电感电流（键为设备 id） */
  prevCurrents?: Record<string, number>
  /** gmin stepping：冷启动不收敛时给每个节点加对地电导并逐量级撤离 */
  gmin?: boolean
  maxNewton?: number
}

export interface CircuitSolution {
  nodeVoltages: Vector
  branchCurrents: Record<string, number>
  matrix: Matrix
  rhs: Vector
  equations: string[]
  iterations: number
  converged: boolean
  condition: number
}

const VT = 0.02585
const nodeIndex = (n: number): number => n - 1

function sourceValue(d: Device, t: number): number {
  return d.source ? d.source(t) : d.value
}

function diodeCurrent(v: number, is: number, n: number): number {
  const vd = Math.min(v, n * VT * Math.log(1 + 1e12)) // 防 exp 溢出
  return is * (Math.exp(vd / (n * VT)) - 1)
}

interface Stamped {
  A: Matrix
  b: Vector
  voltageSourceIds: string[]
  diodeVoltageGuesses: Record<string, number>
  limited: boolean
}

function stampSystem(
  circuit: Circuit,
  opts: SolveOptions,
  diodeGuess: Record<string, number>,
  gminValue: number
): Stamped {
  const N = circuit.nodeCount - 1
  const vSources = circuit.devices.filter((d) => d.type === 'V')
  const m = N + vSources.length
  const A = zeros(m, m)
  const b: Vector = new Array(m).fill(0)
  const t = opts.t ?? 0
  const dt = opts.dt
  const prevV = opts.prevVoltages ?? []
  const prevI = opts.prevCurrents ?? {}
  const limited = false
  const vSourceIndex = new Map<string, number>()
  vSources.forEach((d, i) => vSourceIndex.set(d.id, N + i))

  const stampConductance = (n1: number, n2: number, g: number): void => {
    const i = nodeIndex(n1)
    const j = nodeIndex(n2)
    if (i >= 0) A[i][i] += g
    if (j >= 0) A[j][j] += g
    if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g }
  }
  /** 电流源 I 从 n1 流向 n2：KCL 行右侧 -I */
  const stampCurrentSource = (n1: number, n2: number, I: number): void => {
    const i = nodeIndex(n1)
    const j = nodeIndex(n2)
    if (i >= 0) b[i] -= I
    if (j >= 0) b[j] += I
  }

  circuit.devices.forEach((d, idx) => {
    switch (d.type) {
      case 'R': {
        const g = 1 / Math.max(1e-15, Math.abs(d.value))
        stampConductance(d.n1, d.n2, g)
        break
      }
      case 'V': {
        const k = vSourceIndex.get(d.id)!
        const i = nodeIndex(d.n1)
        const j = nodeIndex(d.n2)
        if (i >= 0) { A[i][k] += 1; A[k][i] += 1 }
        if (j >= 0) { A[j][k] -= 1; A[k][j] -= 1 }
        b[k] += sourceValue(d, t)
        break
      }
      case 'I': {
        stampCurrentSource(d.n1, d.n2, sourceValue(d, t))
        break
      }
      case 'C': {
        if (!dt) break // DC 下电容开路
        const g = d.value / dt
        stampConductance(d.n1, d.n2, g)
        const vPrev = prevV[idx] ?? 0
        // i(t) = g·v(t) - g·v(t-h)：等效为反向电流源 g·v(t-h)
        stampCurrentSource(d.n1, d.n2, -g * vPrev)
        break
      }
      case 'L': {
        if (!dt) {
          // DC 下电感短路：用极小电阻近似，避免奇异矩阵
          stampConductance(d.n1, d.n2, 1e9)
          break
        }
        const g = dt / d.value
        stampConductance(d.n1, d.n2, g)
        // i(t) = g·v(t) + i(t-h)
        stampCurrentSource(d.n1, d.n2, prevI[d.id] ?? 0)
        break
      }
      case 'D': {
        const n = d.emission ?? 1
        const v = diodeGuess[d.id] ?? 0
        const i = diodeCurrent(v, d.value, n)
        const geq = (d.value / (n * VT)) * Math.exp(Math.min(v / (n * VT), 40)) + 1e-12
        const ieq = i - geq * v
        stampConductance(d.n1, d.n2, geq)
        stampCurrentSource(d.n1, d.n2, ieq)
        break
      }
    }
  })

  if (gminValue > 0) {
    for (let i = 0; i < N; i++) A[i][i] += gminValue
  }
  return { A, b, voltageSourceIds: vSources.map((d) => d.id), diodeVoltageGuesses: diodeGuess, limited }
}

function extractNodeVoltages(x: Vector, N: number): Vector {
  return [0, ...x.slice(0, N)]
}

function computeBranchCurrents(circuit: Circuit, v: Vector, x: Vector, prev: Vector, prevI: Record<string, number>, opts: SolveOptions): Record<string, number> {
  const out: Record<string, number> = {}
  const N = circuit.nodeCount - 1
  let vi = N
  circuit.devices.forEach((d, idx) => {
    const vn = (v[d.n1] ?? 0) - (v[d.n2] ?? 0)
    const t = opts.t ?? 0
    switch (d.type) {
      case 'R': out[d.id] = vn / Math.max(1e-15, d.value); break
      case 'V': out[d.id] = x[vi++] ?? 0; break
      case 'I': out[d.id] = sourceValue(d, t); break
      case 'C': out[d.id] = opts.dt ? (d.value / opts.dt) * (vn - (prev[idx] ?? 0)) : 0; break
      case 'L': out[d.id] = opts.dt ? (prevI[d.id] ?? 0) + (opts.dt / d.value) * vn : 0; break
      case 'D': out[d.id] = diodeCurrent(vn, d.value, d.emission ?? 1); break
    }
  })
  return out
}

/** 生成可读 KCL 说明（教学用途：把「为什么是这个数」写进报告） */
export function explainMNA(circuit: Circuit): string[] {
  const lines: string[] = []
  lines.push(`节点数 ${circuit.nodeCount - 1}（不含地），未知量含 ${circuit.devices.filter((d) => d.type === 'V').length} 个电压源支路电流。`)
  for (let i = 1; i < circuit.nodeCount; i++) {
    const terms: string[] = []
    for (const d of circuit.devices) {
      if (d.n1 !== i && d.n2 !== i) continue
      const sign = d.n1 === i ? 1 : -1
      const label = `${d.id}${d.n1 === i ? '(出)' : '(入)'}`
      switch (d.type) {
        case 'R': terms.push(`${sign > 0 ? '+' : '-'}(V${d.n1}-V${d.n2})/${d.id}[R]`); break
        case 'C': terms.push(`${sign > 0 ? '+' : '-'}C${label}·dV/dt`); break
        case 'L': terms.push(`${sign > 0 ? '+' : '-'}I_${d.id}`); break
        case 'I': terms.push(`${sign > 0 ? '+' : '-'}${d.value}A[${d.id}]`); break
        case 'V': terms.push(`${sign > 0 ? '+' : '-'}I_${d.id}`); break
        case 'D': terms.push(`${sign > 0 ? '+' : '-'}Is·(e^(V/nVT)-1)[${d.id}]`); break
      }
    }
    lines.push(`节点 ${i}: ${terms.join(' ') || '0'} = 0`)
  }
  return lines
}

/** DC 工作点求解（含二极管 Newton 迭代与可选 gmin homotopy） */
export function solveDC(circuit: Circuit, opts: SolveOptions = {}): CircuitSolution {
  const N = circuit.nodeCount - 1
  const diodes = circuit.devices.filter((d) => d.type === 'D')
  const guess: Record<string, number> = {}
  diodes.forEach((d) => { guess[d.id] = 0 })
  const maxNewton = opts.maxNewton ?? 40
  let iterations = 0
  let converged = false
  let A: Matrix = []
  let b: Vector = []
  let x: Vector = new Array(N + circuit.devices.filter((d) => d.type === 'V').length).fill(0)

  const solveOnce = (gminValue: number): Vector => {
    for (let it = 0; it < (diodes.length ? maxNewton : 1); it++) {
      const s = stampSystem(circuit, opts, guess, gminValue)
      A = s.A
      b = s.b
      const res = luDecompose(A)
      const nx = luSolve(res, b)
      iterations++
      if (!diodes.length) { x = nx; converged = !res.singular; break }
      let changed = 0
      let wasLimited = false
      diodes.forEach((d) => {
        const vNew = (nx[d.n1 - 1] ?? 0) - (nx[d.n2 - 1] ?? 0)
        const vOld = guess[d.id]
        let v = vNew
        // 阻尼对数限制：防止 Newton 步跨到指数爆炸区
        if (vNew - vOld > 0.6) { v = vOld + VT * Math.log(1 + (vNew - vOld) / VT); wasLimited = true }
        if (v < -5) { v = -5; wasLimited = true }
        guess[d.id] = v
        changed = Math.max(changed, Math.abs(v - vOld))
      })
      x = nx
      if (changed < 1e-9 && !wasLimited) { converged = true; break }
    }
    return x
  }

  if (opts.gmin) {
    // gmin 从大到小逐量级撤离，每级解作为下一级初值
    for (const g of [1e-2, 1e-4, 1e-6, 1e-8, 1e-10, 0]) solveOnce(g)
  } else {
    solveOnce(0)
  }

  const v = extractNodeVoltages(x, N)
  const prevV: Vector = circuit.devices.map((d) => (v[d.n1] ?? 0) - (v[d.n2] ?? 0))
  const currents = computeBranchCurrents(circuit, v, x, opts.prevVoltages ?? prevV, opts.prevCurrents ?? {}, opts)
  return {
    nodeVoltages: v,
    branchCurrents: currents,
    matrix: A,
    rhs: b,
    equations: explainMNA(circuit),
    iterations,
    converged,
    condition: A.length ? conditionNumber(A) : Infinity
  }
}

export interface TransientResult {
  t: Vector
  nodeVoltages: Vector[]
  branchCurrents: Record<string, Vector>
  steps: number
}

/** 瞬态分析：C/L 后向欧拉 companion 模型，逐步重 stamp 求解 */
export function solveTransient(circuit: Circuit, opts: { dt: number; steps: number; t0?: number; probeNode?: number }): TransientResult {
  const t0 = opts.t0 ?? 0
  const times: Vector = []
  const voltages: Vector[] = []
  const currents: Record<string, Vector> = {}
  circuit.devices.forEach((d) => { currents[d.id] = [] })
  let prevV: Vector = circuit.devices.map(() => 0)
  let prevI: Record<string, number> = {}

  for (let s = 0; s < opts.steps; s++) {
    const t = t0 + (s + 1) * opts.dt
    const sol = solveDC(circuit, { t, dt: opts.dt, prevVoltages: prevV, prevCurrents: prevI })
    times.push(t)
    voltages.push(sol.nodeVoltages)
    circuit.devices.forEach((d) => currents[d.id].push(sol.branchCurrents[d.id] ?? 0))
    prevV = circuit.devices.map((d) => (sol.nodeVoltages[d.n1] ?? 0) - (sol.nodeVoltages[d.n2] ?? 0))
    circuit.devices.filter((d) => d.type === 'L').forEach((d) => { prevI[d.id] = sol.branchCurrents[d.id] ?? prevI[d.id] ?? 0 })
  }
  return { t: times, nodeVoltages: voltages, branchCurrents: currents, steps: opts.steps }
}

export interface ACResult { freq: Vector; magnitude: Vector; phaseDeg: Vector }

/**
 * AC 小信号扫频：复数 MNA 通过 [[Re,-Im],[Im,Re]] 实嵌入，
 * 复用同一个部分主元 LU 求解器（Circuit Lab 的公开思路）。
 */
export function solveAC(circuit: Circuit, frequencies: Vector, probeNode = 1): ACResult {
  const N = circuit.nodeCount - 1
  const vSources = circuit.devices.filter((d) => d.type === 'V')
  const m = N + vSources.length
  const magnitude: Vector = []
  const phaseDeg: Vector = []
  const vSourceIndex = new Map<string, number>()
  vSources.forEach((d, i) => vSourceIndex.set(d.id, N + i))

  for (const f of frequencies) {
    const w = 2 * Math.PI * f
    // 复数矩阵存为 [实部, 虚部] 两个实矩阵
    const Re = zeros(m, m)
    const Im = zeros(m, m)
    const bRe: Vector = new Array(m).fill(0)
    const bIm: Vector = new Array(m).fill(0)
    const stampY = (n1: number, n2: number, gr: number, gi: number): void => {
      const i = nodeIndex(n1)
      const j = nodeIndex(n2)
      if (i >= 0) { Re[i][i] += gr; Im[i][i] += gi }
      if (j >= 0) { Re[j][j] += gr; Im[j][j] += gi }
      if (i >= 0 && j >= 0) {
        Re[i][j] -= gr; Im[i][j] -= gi
        Re[j][i] -= gr; Im[j][i] -= gi
      }
    }
    circuit.devices.forEach((d) => {
      switch (d.type) {
        case 'R': stampY(d.n1, d.n2, 1 / Math.max(1e-15, d.value), 0); break
        case 'C': stampY(d.n1, d.n2, 0, w * d.value); break
        case 'L':
          // ω=0 时电感退化为短路（用大导纳近似），避免 -1/0 = -Infinity
          if (w === 0) stampY(d.n1, d.n2, 1e9, 0)
          else stampY(d.n1, d.n2, 0, -1 / (w * d.value))
          break
        case 'V': {
          const k = vSourceIndex.get(d.id)!
          const i = nodeIndex(d.n1)
          const j = nodeIndex(d.n2)
          if (i >= 0) { Re[i][k] += 1; Re[k][i] += 1 }
          if (j >= 0) { Re[j][k] -= 1; Re[k][j] -= 1 }
          bRe[k] += d.value
          break
        }
        default: break
      }
    })
    // 实嵌入：2m × 2m
    const A = zeros(2 * m, 2 * m)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        A[i][j] = Re[i][j]
        A[i][m + j] = -Im[i][j]
        A[m + i][j] = Im[i][j]
        A[m + i][m + j] = Re[i][j]
      }
    }
    const rhs = [...bRe, ...bIm]
    const x = luSolve(luDecompose(A), rhs)
    const vr = x[probeNode - 1] ?? 0
    const vi = x[m + probeNode - 1] ?? 0
    magnitude.push(Math.sqrt(vr * vr + vi * vi))
    phaseDeg.push(Math.atan2(vi, vr) * 180 / Math.PI)
  }
  return { freq: frequencies.slice(), magnitude, phaseDeg }
}

/** 便捷构造：RC 低通（同时可用于瞬态与 AC 扫频） */
export function rcLowPass(v: number, r: number, c: number): Circuit {
  return {
    nodeCount: 3,
    devices: [
      { id: 'V1', type: 'V', n1: 1, n2: 0, value: v },
      { id: 'R1', type: 'R', n1: 1, n2: 2, value: r },
      { id: 'C1', type: 'C', n1: 2, n2: 0, value: c }
    ]
  }
}
