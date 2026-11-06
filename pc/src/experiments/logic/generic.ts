/**
 * 通用数值实验逻辑：让「外部导入的实验包」无需 TypeScript 逻辑即可运行。
 * 实验包用 solver.equations 声明状态方程（安全表达式），由 kernel/ode.ts 求解，
 * 结果按 records 列数写入实验台数据表。
 */
import type { ExperimentContext, ExperimentLogic } from '../types'
import { compileSystem, evaluate } from '../../kernel/expr'
import { integrate, type Derivative, type Trajectory } from '../../kernel/ode'
import { linearFit } from '../../kernel/fit'

export class GenericNumericLogic implements ExperimentLogic {
  private ctx: ExperimentContext | null = null
  private params: Record<string, number> = {}
  private traj: Trajectory | null = null
  private running = false

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.params = {}
    for (const p of ctx.def.params) this.params[p.id] = p.value
  }

  onParam(id: string, value: number): void {
    this.params[id] = value
  }

  private stateVars(y: number[], t: number, names: string[]): Record<string, number> {
    const vars: Record<string, number> = { t, ...this.params }
    names.forEach((n, i) => { vars[n] = y[i] })
    y.forEach((v, i) => { vars[`y${i}`] = v })
    return vars
  }

  start(): void {
    if (!this.ctx) return
    const def = this.ctx.def
    const spec = def.solver
    if (!spec || !spec.equations?.length) {
      this.ctx.post('result', { lines: ['该实验包未声明 solver.equations，无法以数值内核运行。', '请在实验包中补充状态方程或为其实现专属逻辑。'] })
      return
    }
    const equations = spec.equations
    const names = equations.map((_, i) => spec.stateNames?.[i] ?? `y${i}`)
    const sys = compileSystem(equations, names, spec.paramNames ?? [])
    const f: Derivative = (t, y) => sys.derivative(t, y, this.params)
    const energy = spec.energy
      ? (t: number, y: number[]) => evaluate(spec.energy!, this.stateVars(y, t, names))
      : undefined
    const events = (spec.events ?? []).map((ev) => ({
      id: ev.id,
      fn: (t: number, y: number[]) => evaluate(ev.expression, this.stateVars(y, t, names))
    }))
    const n = equations.length
    const y0 = names.map((_, i) => spec.initial?.[i] ?? 0)
    const traj = integrate(f, y0, 0, spec.tEnd ?? 10, {
      solver: spec.solver ?? 'rk4',
      dt: spec.dt ?? 0.02,
      rtol: spec.rtol,
      atol: spec.atol,
      energy,
      events,
      maxPoints: 2000
    })
    this.traj = traj
    this.running = true

    const cols = Math.max(2, def.records.length)
    for (const p of traj.points) {
      const row = [p.t, ...p.y].slice(0, cols).map((v) => Number(v.toFixed(5)))
      this.ctx.post('data', { row })
    }
    const d = traj.diagnostics
    const lines = [
      `数值求解器：${traj.solver} · 方程数 ${n} · 采样点 ${traj.points.length}`,
      `步数 ${d.steps}（拒绝步 ${d.rejected}）· 步长范围 ${d.minDt.toPrecision(3)}–${d.maxDt.toPrecision(3)} s`,
      energy ? `最大相对能量漂移 ${d.maxEnergyDrift.toExponential(3)}` : '未声明能量表达式，跳过守恒诊断',
      ...traj.events.map((e) => `事件 ${e.id} 触发于 t = ${e.t.toFixed(4)} s`)
    ]
    // 声明了线性拟合的实验包：对 (t, y0) 做一次最小二乘，把结论写进报告
    if (def.analysis?.fit?.model === 'linear' && traj.points.length >= 3) {
      const fit = linearFit(traj.points.map((p) => p.t), traj.points.map((p) => p.y[0]))
      lines.push(`线性拟合 y₀(t) = ${fit.params[0].toFixed(4)} + ${fit.params[1].toFixed(4)}·t，R² = ${fit.r2.toFixed(5)}`)
    }
    this.ctx.post('result', { lines })
  }

  pause(): void { this.running = false }
  reset(): void { this.traj = null; this.running = false }
  update(): void { /* 数值解一次性产出，逐帧无需推进 */ }
  dispose(): void { this.ctx = null; this.traj = null }

  evaluate(ctx: { rows: number[][]; paramValues: Record<string, number> }): Record<string, number> {
    return {
      rows: ctx.rows.length,
      maxEnergyDrift: this.traj?.diagnostics.maxEnergyDrift ?? 0,
      events: this.traj?.events.length ?? 0,
      running: this.running ? 1 : 0
    }
  }

  snapshot(): Record<string, number> {
    const last = this.traj?.points[this.traj.points.length - 1]
    const out: Record<string, number> = {}
    if (last) last.y.forEach((v, i) => { out[`y${i}`] = v })
    return out
  }
}
