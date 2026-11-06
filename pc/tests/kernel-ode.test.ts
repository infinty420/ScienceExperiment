import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  integrate, stepRK4, stepRK45, compareSolvers, secondOrderSystem,
  stepSymplectic, stepVerlet, fixedStep, type Derivative
} from '../src/kernel/ode'

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('RK4：指数衰减解析解 y=e^-t', () => {
  const f: Derivative = (_t, y) => [-y[0]]
  const traj = integrate(f, [1], 0, 1, { solver: 'rk4', dt: 0.01 })
  const last = traj.points[traj.points.length - 1]
  close(last.y[0], Math.exp(-1), 1e-8)
  assert.equal(traj.points.length, 101)
})

test('RK45 自适应：精度不低于 RK4 且能报告局部误差', () => {
  const f: Derivative = (_t, y) => [-y[0]]
  const traj = integrate(f, [1], 0, 2, { solver: 'rk45', dt: 0.5, rtol: 1e-9, atol: 1e-11 })
  const last = traj.points[traj.points.length - 1]
  close(last.y[0], Math.exp(-2), 1e-7)
  assert.ok(traj.points.some((p) => (p.error ?? 0) > 0))
  assert.ok(traj.diagnostics.steps > 0)
  const s = stepRK45(f, 0, [1], 0.1)
  assert.ok(s.rawError >= 0 && s.y[0] < 1)
})

test('谐振子能量守恒：辛/Verlet 显著优于显式 Euler', () => {
  const f = secondOrderSystem((_t, x) => -x)
  const energy = (_t: number, y: number[]) => 0.5 * (y[0] * y[0] + y[1] * y[1])
  const rows = compareSolvers(f, [1, 0], 0, 40, 0.05, energy)
  const by = (k: string) => rows.find((r) => r.solver === k)!
  assert.ok(by('euler').finalDrift > 0.1, '显式欧拉应明显发散')
  assert.ok(by('symplectic').finalDrift < 0.1, '辛积分能量有界（O(h) 振荡）')
  assert.ok(by('verlet').finalDrift < 1e-3)
  assert.ok(by('rk4').finalDrift < 1e-6)
  assert.ok(by('rk45').finalDrift < 1e-6)
  assert.ok(by('verlet').finalDrift < by('euler').finalDrift)
})

test('单步求解器：Verlet 与 RK4 在简谐振子上吻合', () => {
  const f = secondOrderSystem((_t, x) => -x)
  const y = [1, 0]
  const h = 0.001
  const a = stepVerlet(f, 0, y, h)
  const b = stepRK4(f, 0, y, h)
  close(a[0], b[0], 1e-7)
  close(a[1], b[1], 1e-7)
  const c = stepSymplectic(f, 0, y, h)
  assert.ok(Number.isFinite(c[0]))
  assert.ok(fixedStep('euler', f, 0, y, h)[0] > 0.999)
})

test('事件检测：零交叉时间定位', () => {
  const f: Derivative = () => [-1]
  const traj = integrate(f, [1], 0, 2, {
    solver: 'rk4', dt: 0.1,
    events: [{ id: 'ground', fn: (_t, y) => y[0], direction: -1 }]
  })
  assert.equal(traj.events.length, 1)
  close(traj.events[0].t, 1, 1e-6)
  close(Math.abs(traj.events[0].y[0]), 0, 1e-6)
})

test('能量漂移诊断字段完整', () => {
  const f = secondOrderSystem((_t, x) => -x)
  const traj = integrate(f, [1, 0], 0, 3, {
    solver: 'verlet', dt: 0.02, energy: (_t, y) => 0.5 * (y[0] ** 2 + y[1] ** 2)
  })
  assert.ok(traj.diagnostics.maxEnergyDrift < 1e-3)
  assert.ok(traj.diagnostics.maxDt > 0)
  assert.equal(traj.diagnostics.truncated, false)
  assert.ok(traj.points.every((p) => typeof p.energy === 'number'))
})

test('非法参数应抛出', () => {
  assert.throws(() => integrate(() => [0], [0], 0, 1, { solver: 'rk4', dt: 0 }))
  assert.throws(() => integrate(() => [0], [0], 1, 0, { solver: 'rk4', dt: 0.1 }))
})
