import * as CANNON from 'cannon-es'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 斜面实验：滑块沿可调角度斜面下滑。
 * 实测 a = v-t 线性斜率；理论 a = g(sinθ − μcosθ)。
 * 注意 cannon-es 默认接触摩擦 = μA·μB，故两侧材质均设 √μ。
 */
export class InclineLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private angle = 25 * Math.PI / 180
  private mu = 0.1
  private g = 9.8
  private readonly L = 8
  private running = false
  private t = 0
  private sampleAcc = 0
  private startPos = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.g = ctx.def.physics?.gravity ?? 9.8
    // 应用默认参数
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  /** 计算滑块初始位置（斜面顶端附近，贴表面） */
  private placeBlock(): void {
    const block = this.ctx.physics.get('block')
    const ramp = this.ctx.physics.get('ramp')
    if (!block?.body || !ramp?.body) return
    const th = this.angle
    const dir = { x: Math.cos(th), y: Math.sin(th) }
    const n = { x: -Math.sin(th), y: Math.cos(th) }
    // 斜面中心 (0,1.5,0)，顶端 = 中心 + (L/2)·dir
    const cx = 0
    const cy = 1.5
    const offset = this.L / 2 - 0.8
    const lift = 0.35 + 0.15 + 0.005 // block 半高 + ramp 半厚
    const px = cx + offset * dir.x + lift * n.x
    const py = cy + offset * dir.y + lift * n.y
    block.body.position.set(px, py, 0)
    block.body.velocity.set(0, 0, 0)
    block.body.angularVelocity.set(0, 0, 0)
    block.body.quaternion.setFromEuler(0, 0, th)
    block.mesh.position.set(px, py, 0)
    block.mesh.rotation.set(0, 0, th)
    this.startPos = px * dir.x + py * dir.y
  }

  private applyAngle(): void {
    const ramp = this.ctx.physics.get('ramp')
    if (!ramp?.body) return
    ramp.body.quaternion.setFromEuler(0, 0, this.angle)
    ramp.mesh.rotation.set(0, 0, this.angle)
    this.placeBlock()
  }

  onParam(id: string, value: number): void {
    if (id === 'angle') {
      this.angle = (value * Math.PI) / 180
      this.applyAngle()
    } else if (id === 'mass') {
      const block = this.ctx.physics.get('block')
      if (block?.body) {
        block.body.mass = value
        block.body.updateMassProperties()
      }
    } else if (id === 'friction') {
      this.mu = value
      const f = Math.sqrt(Math.max(value, 0.0001))
      for (const pid of ['ramp', 'block']) {
        const pair = this.ctx.physics.get(pid)
        if (pair?.body) {
          ;(pair.body.material as CANNON.Material).friction = f
        }
      }
      this.placeBlock()
    }
    this.running = false
    this.t = 0
    this.sampleAcc = 0
  }

  start(): void {
    this.applyAngle()
    this.t = 0
    this.sampleAcc = 0
    this.running = true
    const th = this.angle
    const aTh = this.g * (Math.sin(th) - this.mu * Math.cos(th))
    if (aTh <= 0) {
      this.ctx.post('note', { text: `μ ≥ tanθ（${this.mu.toFixed(2)} ≥ ${Math.tan(th).toFixed(2)}），滑块静止于斜面` })
    }
  }

  pause(): void {
    this.running = false
  }

  reset(): void {
    this.running = false
    this.t = 0
    this.applyAngle()
  }

  update(dt: number): void {
    if (!this.running) return
    this.t += dt
    const block = this.ctx.physics.get('block')
    if (!block?.body) return
    const th = this.angle
    const dir = { x: Math.cos(th), y: Math.sin(th) }
    const p = block.body.position
    const s = this.startPos - (p.x * dir.x + p.y * dir.y)
    const v = Math.abs(block.body.velocity.x * dir.x + block.body.velocity.y * dir.y)

    this.sampleAcc += dt
    if (this.sampleAcc >= 0.05) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +s.toFixed(3), +v.toFixed(3)] })
    }

    if (s >= this.L - 1.6 || this.t > 20) {
      this.running = false
      const aMeas = this.t > 0.3 ? v / this.t : 0
      const aTh = this.g * (Math.sin(th) - this.mu * Math.cos(th))
      this.ctx.post('result', {
        lines: [
          `实测加速度 a = ${aMeas.toFixed(3)} m/s²`,
          `理论值 a = g(sinθ − μcosθ) = ${aTh.toFixed(3)} m/s²`,
          `相对误差 = ${aTh > 0 ? (Math.abs(aMeas - aTh) / aTh * 100).toFixed(1) : '—'} %`
        ]
      })
    }
  }

  dispose(): void {
    this.running = false
  }
}
