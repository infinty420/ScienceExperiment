import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 折射与全反射（W3）：光从介质（n）射向空气界面。
 * Snell: n·sinθi = sinθt；sinθt > 1 → 全反射，临界角 C = arcsin(1/n)。
 * 界面 y=0，介质在下方（半透明块）。
 */
export class RefractionLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private raysGroup = new THREE.Group()
  private thetaI = 30
  private n = 1.5

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    // 介质块（下半空间，半透明蓝）
    const medium = new THREE.Mesh(
      new THREE.BoxGeometry(8, 2.5, 2),
      new THREE.MeshStandardMaterial({
        color: '#3e6a9e', transparent: true, opacity: 0.28, roughness: 0.15
      })
    )
    medium.position.set(0, -1.25, 0)
    this.group.add(medium)

    // 界面线
    this.addStatic(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-4, 0, 0),
      new THREE.Vector3(4, 0, 0)
    ]), 0x8aa8c8)

    // 法线（虚线）
    this.addStatic(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(0, -1.6, 0)
    ]), 0x667788)

    this.group.add(this.raysGroup)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private addStatic(geo: THREE.BufferGeometry, color: number): void {
    this.group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })))
  }

  private clearRays(): void {
    for (let i = this.raysGroup.children.length - 1; i >= 0; i--) {
      const line = this.raysGroup.children[i] as THREE.Line
      this.raysGroup.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
  }

  private addRay(x1: number, y1: number, x2: number, y2: number, color: number, width = 1): void {
    const mat = new THREE.LineBasicMaterial({ color, linewidth: width })
    this.raysGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, y1, 0), new THREE.Vector3(x2, y2, 0)]),
      mat
    ))
  }

  onParam(id: string, value: number): void {
    if (id === 'angle') this.thetaI = value
    else if (id === 'n') this.n = value
    this.rebuild()
  }

  private rebuild(): void {
    this.clearRays()
    const thI = (this.thetaI * Math.PI) / 180
    const L = 3.2 // 光线长度
    // 入射光：介质内（左下）指向原点
    this.addRay(-Math.sin(thI) * L, -Math.cos(thI) * L, 0, 0, 0xe8d070)
    // 入射角弧/箭头标记省略；角度用文字结果呈现

    const sinT = this.n * Math.sin(thI)
    const critical = Math.asin(Math.min(1 / this.n, 1)) * 180 / Math.PI

    if (sinT <= 1) {
      // 折射光（空气侧）
      const thT = Math.asin(sinT)
      this.addRay(0, 0, Math.sin(thT) * L, Math.cos(thT) * L, 0xe8d070)
      // 反射光（弱）
      this.addRay(0, 0, Math.sin(thI) * L * 0.7, -Math.cos(thI) * L * 0.7, 0x9a8a5a)
      const thTdeg = (thT * 180) / Math.PI
      this.ctx.post('result', {
        lines: [
          `n₁·sinθ₁ = n₂·sinθ₂：${this.n.toFixed(2)}·sin${this.thetaI}° = 1.00·sin${thTdeg.toFixed(1)}°`,
          `折射角 θ₂ = ${thTdeg.toFixed(1)}°（折射角 > 入射角，光疏媒质中光线远离法线）`,
          `临界角 C = arcsin(1/n) = ${critical.toFixed(1)}°（θ₁ ≥ C 时发生全反射）`
        ]
      })
      this.ctx.post('data', { row: [this.thetaI, +thTdeg.toFixed(1)] })
    } else {
      // 全反射：反射光（强），无折射光
      this.addRay(0, 0, Math.sin(thI) * L, -Math.cos(thI) * L, 0xe8d070)
      this.ctx.post('result', {
        lines: [
          `θ₁ = ${this.thetaI}° ≥ 临界角 C = ${critical.toFixed(1)}°`,
          `sinθ₂ = n·sinθ₁ = ${sinT.toFixed(3)} > 1，无折射解`,
          '发生全反射：光线全部反射回原介质（光纤原理）'
        ]
      })
      this.ctx.post('data', { row: [this.thetaI, 90] })
    }
  }

  start(): void {
    this.rebuild()
  }
  pause(): void {}
  reset(): void {
    this.rebuild()
  }
  update(_dt: number): void {}

  dispose(): void {
    this.clearRays()
    this.ctx.engine.scene.remove(this.group)
  }
}
