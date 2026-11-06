import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveDC, solveTransient, solveAC, explainMNA, rcLowPass, type Circuit } from '../src/kernel/circuit'

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('DC 分压电路：节点电压与支路电流', () => {
  const c: Circuit = {
    nodeCount: 3,
    devices: [
      { id: 'V1', type: 'V', n1: 1, n2: 0, value: 5 },
      { id: 'R1', type: 'R', n1: 1, n2: 2, value: 1000 },
      { id: 'R2', type: 'R', n1: 2, n2: 0, value: 2000 }
    ]
  }
  const s = solveDC(c)
  close(s.nodeVoltages[1], 5, 1e-9)
  close(s.nodeVoltages[2], 5 * 2 / 3, 1e-9)
  close(s.branchCurrents.R1, 5 / 3000, 1e-9)
  close(s.branchCurrents.R2, (5 * 2 / 3) / 2000, 1e-9)
  assert.equal(s.converged, true)
  assert.ok(s.equations.length >= 2)
  assert.match(explainMNA(c).join('\n'), /节点 2/)
  assert.ok(Number.isFinite(s.condition))
})

test('跨量级矩阵：部分主元 LU 不丢精度', () => {
  const c: Circuit = {
    nodeCount: 2,
    devices: [
      { id: 'V1', type: 'V', n1: 1, n2: 0, value: 1 },
      { id: 'Rbig', type: 'R', n1: 1, n2: 0, value: 1e12 },
      { id: 'Rsmall', type: 'R', n1: 1, n2: 0, value: 1e-6 }
    ]
  }
  const s = solveDC(c)
  close(s.nodeVoltages[1], 1, 1e-6)
})

test('二极管 Newton 迭代 + gmin 冷启动', () => {
  const c: Circuit = {
    nodeCount: 3,
    devices: [
      { id: 'V1', type: 'V', n1: 1, n2: 0, value: 2 },
      { id: 'R1', type: 'R', n1: 1, n2: 2, value: 100 },
      { id: 'D1', type: 'D', n1: 2, n2: 0, value: 1e-12 }
    ]
  }
  const s = solveDC(c, { gmin: true, maxNewton: 60 })
  assert.ok(s.iterations >= 1)
  assert.ok(s.nodeVoltages[2] > 0.4 && s.nodeVoltages[2] < 1.0, `二极管压降 ${s.nodeVoltages[2]}`)
})

test('RC 瞬态：后向欧拉充电曲线逼近 5(1-e^(-t/RC))', () => {
  const c = rcLowPass(5, 1000, 1e-6)
  const dt = 1e-5
  const r = solveTransient(c, { dt, steps: 100 })
  const vEnd = r.nodeVoltages[99][2]
  const exact = 5 * (1 - Math.exp(-1))
  assert.ok(Math.abs(vEnd - exact) < 0.05, `v=${vEnd} exact=${exact}`)
  assert.equal(r.t.length, 100)
  assert.ok(r.branchCurrents.C1.length === 100)
})

test('AC 扫频：RC 低通在截止频率处增益 = 1/√2', () => {
  const R = 1000
  const C = 1e-6
  const c = rcLowPass(5, R, C)
  const fc = 1 / (2 * Math.PI * R * C)
  const r = solveAC(c, [1, fc, 10 * fc], 2)
  close(r.magnitude[1], 5 / Math.SQRT2, 5 / Math.SQRT2 * 0.02)
  assert.ok(r.magnitude[2] < r.magnitude[0] * 0.2, '高频应被衰减')
  assert.ok(r.phaseDeg[1] < 0 && r.phaseDeg[1] > -90)
  assert.equal(r.freq.length, 3)
})

test('时变源：正弦电压逐时刻生效', () => {
  const c: Circuit = {
    nodeCount: 2,
    devices: [
      { id: 'V1', type: 'V', n1: 1, n2: 0, value: 0, source: (t) => Math.sin(2 * Math.PI * t) },
      { id: 'R1', type: 'R', n1: 1, n2: 0, value: 1000 }
    ]
  }
  close(solveDC(c, { t: 0.25 }).nodeVoltages[1], 1, 1e-9)
  close(solveDC(c, { t: 0.75 }).nodeVoltages[1], -1, 1e-9)
})
