import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/** 平抛：x = v₀t 匀速 + 竖直自由落体；轨迹描点与理论抛物线对比 */
export class ProjectileLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private v0 = 6
  private h = 2.5
  private g = 9.8
  private r = 0.25
  private running = false
  private t = 0
  private sampleAcc = 0
  private trailAcc = 0
  private trail: THREE.Points | null = null
  private trailGeo: THREE.BufferGeometry | null = null
  private trailCount = 0
  private readonly MAX_TRAIL = 2000

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.g = ctx.def.physics?.gravity ?? 9.8
    // 轨迹点云
    this.trailGeo = new THREE.BufferGeometry()
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.MAX_TRAIL * 3), 3))
    this.trailGeo.setDrawRange(0, 0)
    this.trail = new THREE.Points(
      this.trailGeo,
      new THREE.PointsMaterial({ color: 0x67e8c8, size: 0.09, sizeAttenuation: true })
    )
    ctx.engine.scene.add(this.trail)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  /** 高度变化时重建平台（物理形状不可动态改尺寸） */
  private rebuildPlatform(): void {
    const engine = this.ctx.engine
    const physics = this.ctx.physics
    physics.remove('platform')
    physics.add(engine, {
      id: 'platform',
      type: 'box',
      size: [2, this.h, 2],
      position: [-1, this.h / 2, 0],
      static: true,
      color: '#5a7a9a',
      friction: 0.6
    })
  }

  private placeBall(): void {
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    ball.body.position.set(0, this.h + this.r, 0)
    ball.body.velocity.set(0, 0, 0)
    ball.mesh.position.set(0, this.h + this.r, 0)
  }

  private clearTrail(): void {
    this.trailCount = 0
    this.trailGeo?.setDrawRange(0, 0)
  }

  onParam(id: string, value: number): void {
    if (id === 'v0') this.v0 = value
    else if (id === 'height') {
      this.h = value
      this.rebuildPlatform()
    }
    this.running = false
    this.t = 0
    this.sampleAcc = 0
    this.trailAcc = 0
    this.placeBall()
    this.clearTrail()
  }

  start(): void {
    this.placeBall()
    this.clearTrail()
    this.t = 0
    this.sampleAcc = 0
    this.trailAcc = 0
    const ball = this.ctx.physics.get('ball')
    if (ball?.body) ball.body.velocity.set(this.v0, 0, 0)
    this.running = true
  }

  pause(): void {
    this.running = false
  }

  reset(): void {
    this.running = false
    this.t = 0
    this.placeBall()
    this.clearTrail()
  }

  private pushTrail(x: number, y: number): void {
    if (!this.trailGeo || this.trailCount >= this.MAX_TRAIL) return
    const arr = this.trailGeo.getAttribute('position') as THREE.BufferAttribute
    arr.setXYZ(this.trailCount, x, y, 0)
    this.trailCount++
    this.trailGeo.setDrawRange(0, this.trailCount)
    arr.needsUpdate = true
  }

  update(dt: number): void {
    if (!this.running) return
    this.t += dt
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    const x = ball.body.position.x
    const y = ball.body.position.y - this.r

    this.trailAcc += dt
    if (this.trailAcc >= 0.02) {
      this.trailAcc = 0
      this.pushTrail(x, ball.body.position.y)
    }

    this.sampleAcc += dt
    if (this.sampleAcc >= 0.05) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +x.toFixed(3), +y.toFixed(3)] })
    }

    if (y <= 0.02) {
      this.running = false
      const tLand = this.t
      const rMeas = x
      const rTh = this.v0 * Math.sqrt((2 * this.h) / this.g)
      // 理论抛物线（与实测记录同坐标系）
      const pts: Array<[number, number]> = []
      const N = 40
      for (let i = 0; i <= N; i++) {
        const tt = (tLand * i) / N
        pts.push([this.v0 * tt, this.h - 0.5 * this.g * tt * tt])
      }
      this.ctx.post('theory', { points: pts, label: '理论轨迹' })
      this.ctx.post('result', {
        lines: [
          `实测射程 R = ${rMeas.toFixed(3)} m`,
          `理论射程 R = v₀√(2h/g) = ${rTh.toFixed(3)} m`,
          `相对误差 = ${(Math.abs(rMeas - rTh) / rTh * 100).toFixed(1)} %`
        ]
      })
    }
  }

  dispose(): void {
    this.running = false
    if (this.trail) {
      this.ctx.engine.scene.remove(this.trail)
      this.trailGeo?.dispose()
      this.trail = null
    }
  }
}
