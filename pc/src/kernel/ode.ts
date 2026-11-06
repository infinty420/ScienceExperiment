/**
 * 常微分方程数值内核（纯 TS，零依赖）
 *
 * 参考思路：myphysicslab/myphysicslab (Apache-2.0) 的 DiffEqSolver / AdaptiveStepSolver /
 * EnergySystem / CollisionAdvance 分层抽象；cannon-es (MIT) 的固定步长累加器。
 * 数值格式为公开数学（Euler / Symplectic Euler / Velocity Verlet / RK4 / Dormand-Prince 5(4)），
 * 本文件为独立实现，未复制任何第三方代码。
 */
import { normInf, type Vector } from './linalg'

export type Derivative = (t: number, y: Vector) => Vector
export type EnergyFn = (t: number, y: Vector) => number
export type EventFn = (t: number, y: Vector) => number
export type SolverKind = 'euler' | 'symplectic' | 'verlet' | 'rk4' | 'rk45'

export interface EventDef {
  id: string
  fn: EventFn
  /** 1 = 仅负→正，-1 = 仅正→负，0/缺省 = 双向 */
  direction?: 1 | -1 | 0
}

export interface IntegrateOptions {
  solver: SolverKind
  dt: number
  /** 自适应相对容差（rk45） */
  rtol?: number
  /** 自适应绝对容差（rk45） */
  atol?: number
  minDt?: number
  maxDt?: number
  energy?: EnergyFn
  events?: EventDef[]
  maxSteps?: number
  maxPoints?: number
}

export interface TrajectoryPoint {
  t: number
  y: Vector
  dt: number
  energy?: number
  /** rk45 归一化局部误差 */
  error?: number
}

export interface TrajectoryEvent {
  id: string
  t: number
  y: Vector
  value: number
}

export interface TrajectoryDiagnostics {
  steps: number
  rejected: number
  minDt: number
  maxDt: number
  maxEnergyDrift: number
  finalEnergyDrift: number
  truncated: boolean
}

export interface Trajectory {
  points: TrajectoryPoint[]
  events: TrajectoryEvent[]
  diagnostics: TrajectoryDiagnostics
  solver: SolverKind
}

function addScaled(y: Vector, k: Vector, h: number): Vector {
  return y.map((v, i) => v + h * (k[i] ?? 0))
}

export function stepEuler(f: Derivative, t: number, y: Vector, h: number): Vector {
  return addScaled(y, f(t, y), h)
}

/** 辛欧拉（半隐式）：适用 y = [位置…, 速度/动量…]，长期能量有界，不系统性耗散 */
export function stepSymplectic(f: Derivative, t: number, y: Vector, h: number): Vector {
  const n = y.length
  if (n % 2 !== 0) return stepEuler(f, t, y, h)
  const half = n / 2
  const k = f(t, y)
  const out = y.slice()
  // 先用旧位置更新速度，再用新速度更新位置
  for (let i = 0; i < half; i++) out[half + i] = y[half + i] + h * k[half + i]
  const k2 = f(t + h, out)
  for (let i = 0; i < half; i++) out[i] = y[i] + h * k2[i]
  return out
}

/** Velocity Verlet：二阶精度、时间可逆，适合保守力学系统 */
export function stepVerlet(f: Derivative, t: number, y: Vector, h: number): Vector {
  const n = y.length
  if (n % 2 !== 0) return stepEuler(f, t, y, h)
  const half = n / 2
  const a0 = f(t, y).slice(half)
  const out = y.slice()
  for (let i = 0; i < half; i++) {
    out[i] = y[i] + h * y[half + i] + 0.5 * h * h * a0[i]
    out[half + i] = y[half + i] + h * a0[i] // 预测速度
  }
  const a1 = f(t + h, out).slice(half)
  for (let i = 0; i < half; i++) out[half + i] = y[half + i] + 0.5 * h * (a0[i] + a1[i])
  return out
}

export function stepRK4(f: Derivative, t: number, y: Vector, h: number): Vector {
  const k1 = f(t, y)
  const k2 = f(t + h / 2, addScaled(y, k1, h / 2))
  const k3 = f(t + h / 2, addScaled(y, k2, h / 2))
  const k4 = f(t + h, addScaled(y, k3, h))
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

export interface RK45Step {
  /** 5 阶解 */
  y: Vector
  /** 4 阶解（误差估计用） */
  y4: Vector
  /** 归一化前的原始误差（无穷范数） */
  rawError: number
}

/** Dormand-Prince 5(4) 单步（FSAL 未启用，换取实现透明度） */
export function stepRK45(f: Derivative, t: number, y: Vector, h: number): RK45Step {
  const c = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]
  const a: number[][] = [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
  ]
  // 5 阶解使用 7 个阶段（第 7 阶段系数为 0）；4 阶解用独立 b* 系数
  const b5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0]
  const b4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40]
  const k: Vector[] = []
  for (let s = 0; s < 7; s++) {
    const yy = y.slice()
    for (let j = 0; j < s; j++) {
      for (let i = 0; i < yy.length; i++) yy[i] += h * a[s][j] * k[j][i]
    }
    k.push(f(t + c[s] * h, yy))
  }
  const y5 = y.slice()
  const y4 = y.slice()
  for (let i = 0; i < y.length; i++) {
    let s5 = 0
    let s4 = 0
    for (let s = 0; s < 7; s++) { s5 += b5[s] * k[s][i]; s4 += b4[s] * k[s][i] }
    y5[i] = y[i] + h * s5
    y4[i] = y[i] + h * s4
  }
  return { y: y5, y4, rawError: normInf(y5.map((v, i) => v - y4[i])) }
}

export function fixedStep(kind: SolverKind, f: Derivative, t: number, y: Vector, h: number): Vector {
  switch (kind) {
    case 'euler': return stepEuler(f, t, y, h)
    case 'symplectic': return stepSymplectic(f, t, y, h)
    case 'verlet': return stepVerlet(f, t, y, h)
    case 'rk4': return stepRK4(f, t, y, h)
    case 'rk45': return stepRK45(f, t, y, h).y
    default: return stepRK4(f, t, y, h)
  }
}

function interpolate(y0: Vector, y1: Vector, u: number): Vector {
  return y0.map((v, i) => v + u * (y1[i] - v))
}

/** 二分细化零交叉事件（对状态做线性插值，避免额外积分） */
function refineEvent(fn: EventFn, t0: number, y0: Vector, t1: number, y1: Vector): { t: number; y: Vector; value: number } {
  let lo = 0
  let hi = 1
  let flo = fn(t0, y0)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const ym = interpolate(y0, y1, mid)
    const fm = fn(t0 + (t1 - t0) * mid, ym)
    if ((flo <= 0 && fm <= 0) || (flo >= 0 && fm >= 0)) { lo = mid; flo = fm } else { hi = mid }
  }
  const u = (lo + hi) / 2
  const y = interpolate(y0, y1, u)
  const t = t0 + (t1 - t0) * u
  return { t, y, value: fn(t, y) }
}

/**
 * 主积分器：支持固定步长与 rk45 自适应步长、零交叉事件、能量守恒诊断。
 * 自适应采用局部误差比 + 比例控制；被拒绝的步不计入轨迹。
 */
export function integrate(f: Derivative, y0: Vector, t0: number, tEnd: number, opts: IntegrateOptions): Trajectory {
  const solver = opts.solver
  const rtol = opts.rtol ?? 1e-6
  const atol = opts.atol ?? 1e-9
  const minDt = opts.minDt ?? Math.max(1e-9, opts.dt * 1e-6)
  const maxDt = opts.maxDt ?? Math.max(opts.dt * 10, opts.dt)
  const maxSteps = opts.maxSteps ?? 200000
  const maxPoints = opts.maxPoints ?? 20000
  if (!(opts.dt > 0)) throw new Error('integrate: dt 必须为正')
  if (!(tEnd > t0)) throw new Error('integrate: tEnd 必须大于 t0')

  const points: TrajectoryPoint[] = []
  const events: TrajectoryEvent[] = []
  const e0 = opts.energy ? opts.energy(t0, y0) : undefined
  let t = t0
  let y = y0.slice()
  let dt = Math.min(opts.dt, maxDt)
  let steps = 0
  let rejected = 0
  let usedMinDt = Infinity
  let usedMaxDt = 0
  let maxDrift = 0
  let truncated = false

  const drift = (yy: Vector, tt: number): number => {
    if (!opts.energy || e0 === undefined) return 0
    const scale = Math.max(Math.abs(e0), 1e-12)
    return Math.abs(opts.energy(tt, yy) - e0) / scale
  }

  const pushPoint = (err?: number): void => {
    if (points.length >= maxPoints) { truncated = true; return }
    points.push({ t, y: y.slice(), dt, energy: opts.energy ? opts.energy(t, y) : undefined, error: err })
  }
  pushPoint(0)

  while (t < tEnd - 1e-12) {
    if (steps >= maxSteps || points.length >= maxPoints) { truncated = true; break }
    const h = Math.min(dt, tEnd - t)
    let nextY: Vector
    let errRatio = 0

    if (solver === 'rk45') {
      const s = stepRK45(f, t, y, h)
      let sc = 0
      for (let i = 0; i < y.length; i++) {
        const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(s.y[i]))
        sc = Math.max(sc, Math.abs(s.y[i] - s.y4[i]) / scale)
      }
      errRatio = sc
      if (sc > 1 && h > minDt) {
        rejected++
        dt = Math.max(minDt, h * Math.max(0.2, 0.9 * Math.pow(sc, -0.2)))
        continue
      }
      nextY = s.y
    } else {
      nextY = fixedStep(solver, f, t, y, h)
    }

    // 事件检测（用步首/步末状态做零交叉定位）
    if (opts.events) {
      for (const ev of opts.events) {
        const v0 = ev.fn(t, y)
        const v1 = ev.fn(t + h, nextY)
        const crossed = v0 === 0 || (v0 < 0 && v1 >= 0) || (v0 > 0 && v1 <= 0)
        if (!crossed) continue
        const dir = v1 - v0
        if (ev.direction === 1 && dir < 0) continue
        if (ev.direction === -1 && dir > 0) continue
        const r = refineEvent(ev.fn, t, y, t + h, nextY)
        events.push({ id: ev.id, t: r.t, y: r.y, value: r.value })
      }
    }

    const tNew = t + h
    y = nextY
    t = tNew
    dt = Math.min(maxDt, Math.max(minDt, solver === 'rk45' && errRatio > 0 ? h * Math.min(5, Math.max(0.2, 0.9 * Math.pow(errRatio, -0.2))) : opts.dt))
    usedMinDt = Math.min(usedMinDt, h)
    usedMaxDt = Math.max(usedMaxDt, h)
    maxDrift = Math.max(maxDrift, drift(y, t))
    steps++
    pushPoint(errRatio)
  }

  return {
    points,
    events,
    solver,
    diagnostics: {
      steps,
      rejected,
      minDt: Number.isFinite(usedMinDt) ? usedMinDt : 0,
      maxDt: usedMaxDt,
      maxEnergyDrift: maxDrift,
      finalEnergyDrift: drift(y, t),
      truncated
    }
  }
}

/** 教学用：同一模型各求解器的能量漂移对比 */
export function compareSolvers(
  f: Derivative, y0: Vector, t0: number, tEnd: number, dt: number, energy: EnergyFn
): Array<{ solver: SolverKind; finalDrift: number; maxDrift: number; steps: number; rejected: number }> {
  const kinds: SolverKind[] = ['euler', 'symplectic', 'verlet', 'rk4', 'rk45']
  return kinds.map((solver) => {
    const traj = integrate(f, y0, t0, tEnd, { solver, dt, energy, rtol: 1e-8 })
    return {
      solver,
      finalDrift: traj.diagnostics.finalEnergyDrift,
      maxDrift: traj.diagnostics.maxEnergyDrift,
      steps: traj.diagnostics.steps,
      rejected: traj.diagnostics.rejected
    }
  })
}

/** 阻尼/驱动等二阶系统的便捷建模：y = [x, v] */
export function secondOrderSystem(accel: (t: number, x: number, v: number) => number): Derivative {
  return (t, y) => [y[1] ?? 0, accel(t, y[0] ?? 0, y[1] ?? 0)]
}
