import type { ExperimentContext, ExperimentLogic } from '../types'

/** 自由落体：h = ½gt²，落地反推 g */
export class FreeFallLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private h = 10
  private g = 9.8
  private r = 0.3
  private running = false
  private t = 0
  private sampleAcc = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private placeBall(): void {
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    ball.body.position.set(0, this.h + this.r, 0)
    ball.body.velocity.set(0, 0, 0)
    ball.mesh.position.set(0, this.h + this.r, 0)
  }

  onParam(id: string, value: number): void {
    if (id === 'height') {
      this.h = value
      this.placeBall()
    } else if (id === 'gravity') {
      this.g = value
      this.ctx.physics.setGravity(value)
    }
    this.running = false
    this.t = 0
    this.sampleAcc = 0
  }

  start(): void {
    this.placeBall()
    this.t = 0
    this.sampleAcc = 0
    this.running = true
  }

  pause(): void {
    this.running = false
  }

  reset(): void {
    this.running = false
    this.t = 0
    this.placeBall()
  }

  update(dt: number): void {
    if (!this.running) return
    this.t += dt
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    const y = ball.body.position.y - this.r
    const v = Math.abs(ball.body.velocity.y)

    this.sampleAcc += dt
    if (this.sampleAcc >= 0.05) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +y.toFixed(3), +v.toFixed(3)] })
    }

    if (y <= 0.02) {
      this.running = false
      const gMeas = this.t > 0.2 ? (2 * this.h) / (this.t * this.t) : 0
      this.ctx.post('result', {
        lines: [
          `下落时间 t = ${this.t.toFixed(3)} s`,
          `反推重力加速度 g = 2h/t² = ${gMeas.toFixed(3)} m/s²`,
          `设定值 g = ${this.g.toFixed(1)} m/s²，相对误差 = ${(Math.abs(gMeas - this.g) / this.g * 100).toFixed(1)} %`
        ]
      })
    }
  }

  dispose(): void {
    this.running = false
  }
}
