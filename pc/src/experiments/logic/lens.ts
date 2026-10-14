import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 凸透镜成像（W3）：三条特殊光线 + 实/虚像。
 * 1/f = 1/u + 1/v；v = uf/(u−f)；m = v/u（正立/倒立由符号）。
 * 场景单位：1.0 = 10 cm；光轴沿 X，透镜在 x=0。
 */
export class LensLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private uCm = 30
  private fCm = 10
  private hObj = 0.8 // 物高（场景单位）

  // 动态元素
  private objectArrow!: THREE.Mesh
  private imageArrow!: THREE.Mesh
  private imageMat!: THREE.MeshStandardMaterial
  private raysGroup = new THREE.Group()

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    // 光轴
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-7, 0, 0),
        new THREE.Vector3(7, 0, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0x557089 })
    )
    this.group.add(axis)

    // 透镜（竖直薄透镜视觉：扁圆柱）
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 0.08, 32).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#9fd8e8', transparent: true, opacity: 0.35, roughness: 0.05
      })
    )
    lens.position.set(0, 0, 0)
    this.group.add(lens)

    // 焦点标记
    for (const fx of [-1, 1]) {
      const f = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe0a050 })
      )
      f.position.set(fx * (this.fCm / 10), 0, 0)
      f.name = 'focus'
      this.group.add(f)
    }

    // 物（红色箭头）
    this.objectArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, this.hObj, 12),
      new THREE.MeshStandardMaterial({ color: '#d05a5a' })
    )
    this.group.add(this.objectArrow)

    // 像（绿色箭头，可变透明度/倒立）
    this.imageMat = new THREE.MeshStandardMaterial({
      color: '#4a9a68', transparent: true, opacity: 1
    })
    this.imageArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 1, 12),
      this.imageMat
    )
    this.group.add(this.imageArrow)
    this.group.add(this.raysGroup)

    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'u') this.uCm = value
    else if (id === 'f') this.fCm = value
    this.rebuild()
  }

  private clearRays(): void {
    for (let i = this.raysGroup.children.length - 1; i >= 0; i--) {
      const line = this.raysGroup.children[i] as THREE.Line
      this.raysGroup.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
  }

  private addRay(pts: THREE.Vector3[], color: number, dashed = false): void {
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1 })
      : new THREE.LineBasicMaterial({ color })
    const line = new THREE.Line(geo, mat)
    if (dashed) line.computeLineDistances()
    this.raysGroup.add(line)
  }

  private rebuild(): void {
    const u = this.uCm / 10
    const f = this.fCm / 10
    const V3 = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, y, 0)

    // 焦点位置更新
    this.group.children.forEach((c) => {
      if (c.name === 'focus') {
        const s = c.position.x < 0 ? -1 : 1
        c.position.x = s * f
      }
    })

    // 物
    this.objectArrow.position.set(-u, this.hObj / 2, 0)

    // 像：v = uf/(u−f)
    const denom = u - f
    const v = Math.abs(denom) < 1e-6 ? Infinity : (u * f) / denom
    const mag = Math.abs(v / u) // |m|
    const real = v > 0 && Number.isFinite(v)
    const inverted = real // 实像倒立

    if (!Number.isFinite(v)) {
      this.imageArrow.visible = false
    } else {
      this.imageArrow.visible = true
      const hImg = this.hObj * mag
      this.imageArrow.scale.set(1, hImg, 1)
      this.imageArrow.position.set(v, inverted ? -hImg / 2 : hImg / 2, 0)
      this.imageMat.opacity = real ? 1 : 0.45
    }

    // 三条特殊光线（从物顶 -u,h 出发）
    this.clearRays()
    const h = this.hObj
    const far = 7 // 光线延伸长度
    if (Number.isFinite(v)) {
      const far = 7
      const yImg = real ? -h * mag : h * mag
      // ① 平行主轴入射 → 折射过右焦点（出射线沿 (0,h)→像点 方向延伸）
      this.addRay([V3(-u, h), V3(0, h)], 0xe8d070)
      const slopeR = (yImg - h) / v
      this.addRay([V3(0, h), V3(far, h + slopeR * far)], 0xe8d070)
      // ② 过光心直线（不偏折）
      const slopeC = h / u
      if (real) {
        this.addRay([V3(-u, h), V3(0, 0)], 0xe8d070)
        this.addRay([V3(0, 0), V3(far, -slopeC * far)], 0xe8d070)
      } else {
        this.addRay([V3(-u, h), V3(0, 0), V3(far, -slopeC * far)], 0xe8d070)
      }
      // ③ 过左焦点入射 → 折射后平行主轴
      this.addRay([V3(-u, h), V3(-f, 0)], 0xe8d070)
      this.addRay([V3(-f, 0), V3(0, h)], 0xe8d070)
      this.addRay([V3(0, h), V3(far, h)], 0xe8d070)
      // 虚像：出射光反向延长线（虚线）会聚于像点
      if (!real) {
        this.addRay([V3(0, h), V3(v, yImg)], 0x9a8a5a, true)
        this.addRay([V3(0, 0), V3(v, yImg)], 0x9a8a5a, true)
      }
    }

    // 结果
    if (!Number.isFinite(v)) {
      this.ctx.post('result', { lines: ['u = f，不成像（出射平行光）'] })
    } else {
      const nature = real
        ? `实像 · ${inverted ? '倒立' : '正立'} · ${mag > 1.001 ? '放大' : mag < 0.999 ? '缩小' : '等大'}`
        : `虚像 · 正立 · 放大（同侧）`
      const vCm = v * 10
      this.ctx.post('result', {
        lines: [
          `物距 u = ${this.uCm} cm，焦距 f = ${this.fCm} cm`,
          `像距 v = uf/(u−f) = ${vCm.toFixed(1)} cm（${v < 0 ? '负值表示虚像在物同侧' : '正值表示实像在透镜右侧'}）`,
          `放大率 |m| = v/u = ${mag.toFixed(2)}，性质：${nature}`
        ]
      })
      this.ctx.post('data', { row: [this.uCm, +vCm.toFixed(1)] })
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
