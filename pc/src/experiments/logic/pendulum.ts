import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 单摆：解析积分 θ'' = −(g/L)sinθ（半隐式欧拉，比约束求解稳定）。
 * 摆球同向过最低点计时得周期 T，g = 4π²L/T²。
 */
export class PendulumLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private anchor = new THREE.Vector3(0, 3.2, 0)
  private L = 1
  private g = 9.8
  private theta0 = (15 * Math.PI) / 180
  private theta = (15 * Math.PI) / 180
  private omega = 0
  private t = 0
  private running = false
  private prevSign = 1
  private lastUpT = -1
  private periods: number[] = []
  private line: THREE.Line | null = null
  private lineGeo: THREE.BufferGeometry | null = null

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    // 摆线
    this.lineGeo = new THREE.BufferGeometry()
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xaef0d8 }))
    ctx.engine.scene.add(this.line)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private syncVisual(): void {
    const ball = this.ctx.physics.get('ball')
    if (!ball) return
    const x = this.anchor.x + this.L * Math.sin(this.theta)
    const y = this.anchor.y - this.L * Math.cos(this.theta)
    ball.mesh.position.set(x, y, 0)
    if (this.lineGeo) {
      const arr = this.lineGeo.getAttribute('position') as THREE.BufferAttribute
      arr.setXYZ(0, this.anchor.x, this.anchor.y, this.anchor.z)
      arr.setXYZ(1, x, y, 0)
      arr.needsUpdate = true
    }
  }

  onParam(id: string, value: number): void {
    if (id === 'length') this.L = value
    else if (id === 'angle') this.theta0 = (value * Math.PI) / 180
    else if (id === 'gravity') this.g = value
    this.reset()
  }

  start(): void {
    this.running = true
  }

  pause(): void {
    this.running = false
  }

  reset(): void {
    this.running = false
    this.theta = this.theta0
    this.omega = 0
    this.t = 0
    this.prevSign = Math.sign(this.theta) || 1
    this.lastUpT = -1
    this.periods = []
    this.syncVisual()
  }

  update(dt: number): void {
    if (!this.running) return
    // 子步积分，保证稳定
    const steps = 4
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      this.omega += (-(this.g / this.L) * Math.sin(this.theta)) * h
      this.theta += this.omega * h
    }
    this.t += dt

    // 同向（向上，即 ω>0 时 θ 由负变正）过零 = 一个完整周期
    const sign = this.theta >= 0 ? 1 : -1
    if (sign !== this.prevSign && this.omega > 0 && this.prevSign < 0) {
      if (this.lastUpT > 0) {
        const T = this.t - this.lastUpT
        this.periods.push(T)
        this.ctx.post('data', { row: [this.periods.length, +T.toFixed(3)] })
        if (this.periods.length === 5) {
          const avg = this.periods.reduce((a, b) => a + b, 0) / this.periods.length
          const gMeas = (4 * Math.PI * Math.PI * this.L) / (avg * avg)
          const TTh = 2 * Math.PI * Math.sqrt(this.L / this.g)
          this.ctx.post('result', {
            lines: [
              `平均周期 T = ${avg.toFixed(3)} s（5 次测量）`,
              `反推 g = 4π²L/T² = ${gMeas.toFixed(3)} m/s²`,
              `理论周期 T₀ = 2π√(L/g) = ${TTh.toFixed(3)} s，g 设定值 = ${this.g.toFixed(1)} m/s²`
            ]
          })
        }
      }
      this.lastUpT = this.t
    }
    this.prevSign = sign
    this.syncVisual()
  }

  dispose(): void {
    this.running = false
    if (this.line) {
      this.ctx.engine.scene.remove(this.line)
      this.lineGeo?.dispose()
      this.line = null
    }
  }
}
