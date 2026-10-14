import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 生物三实验（W5）：细胞结构 3D 探索 / 光合作用 / 显微镜使用。
 */

/** ① 细胞结构 3D：参数选择高亮部件 */
const ORGANELLES = [
  { key: 'membrane', name: '细胞膜 / 细胞壁', desc: '控制物质进出细胞；植物细胞外侧还有纤维素细胞壁，起支持保护作用。' },
  { key: 'nucleus', name: '细胞核', desc: '含有遗传物质 DNA，是细胞的控制中心和代谢库。' },
  { key: 'mitochondria', name: '线粒体', desc: '有氧呼吸的主要场所，为细胞生命活动供能（动力车间）。' },
  { key: 'chloroplast', name: '叶绿体', desc: '光合作用的场所，把光能转化为化学能储存在有机物中（植物细胞特有）。' },
  { key: 'vacuole', name: '液泡', desc: '成熟植物细胞中央大液泡，内含细胞液，维持细胞渗透压与形态。' }
]

export class CellLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private parts: Record<string, THREE.Mesh[]> = {}
  private selected = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    const add = (mesh: THREE.Mesh, part: string): void => {
      this.group.add(mesh)
      ;(this.parts[part] = this.parts[part] ?? []).push(mesh)
    }

    // 细胞膜（半透明大球）
    const membrane = new THREE.Mesh(
      new THREE.SphereGeometry(2, 32, 24),
      new THREE.MeshStandardMaterial({ color: '#7db87a', transparent: true, opacity: 0.16, roughness: 0.2 })
    )
    add(membrane, 'membrane')

    // 细胞核
    const nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 20, 16),
      new THREE.MeshStandardMaterial({ color: '#8a6ab8', roughness: 0.4 })
    )
    nucleus.position.set(0, 0.3, 0)
    add(nucleus, 'nucleus')
    const nucleolus = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#5a3f88' })
    )
    nucleolus.position.set(0.1, 0.4, 0.1)
    add(nucleolus, 'nucleus')

    // 线粒体 ×3（胶囊形，橙色）
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.16, 0.45, 6, 12),
        new THREE.MeshStandardMaterial({ color: '#d0854a', roughness: 0.5 })
      )
      m.position.set(-1 + i * 0.9, -0.7 + i * 0.4, 0.8 - i * 0.7)
      m.rotation.z = 0.9 + i * 0.5
      add(m, 'mitochondria')
    }

    // 叶绿体 ×4（椭球，深绿）
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#3a7a3f', roughness: 0.5 })
      )
      c.scale.set(1, 0.55, 0.8)
      c.position.set(1.1 - i * 0.8, 1.0 - i * 0.3, -0.6 + i * 0.5)
      c.rotation.z = -0.6 + i
      add(c, 'chloroplast')
    }

    // 液泡（中央大透明球）
    const vacuole = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 20, 16),
      new THREE.MeshStandardMaterial({ color: '#a8d8e8', transparent: true, opacity: 0.28, roughness: 0.1 })
    )
    vacuole.position.set(0.3, -0.4, -0.5)
    add(vacuole, 'vacuole')

    // 缓慢自转展示
    ctx.engine.updatables.push(this.spin)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private spin = (dt: number): void => {
    this.group.rotation.y += dt * 0.15
  }

  onParam(id: string, value: number): void {
    if (id === 'part') this.selected = Math.round(value)
    const keys = ['none', 'membrane', 'nucleus', 'mitochondria', 'chloroplast', 'vacuole']
    const sel = keys[this.selected]
    for (const [key, meshes] of Object.entries(this.parts)) {
      for (const mesh of meshes) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        const isSel = key === sel
        mat.emissive.setHex(isSel ? 0xffc040 : 0x000000)
        mat.emissiveIntensity = isSel ? 0.8 : 0
      }
    }
    const o = ORGANELLES.find((x) => x.key === sel)
    this.ctx.post('result', {
      lines: o
        ? [o.name, o.desc]
        : ['拖动滑杆选择 1–5 号结构，金色高亮对应细胞器', '可拖拽旋转细胞模型整体观察']
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('part', 0)
  }
  update(_dt: number): void {}
  dispose(): void {
    const idx = this.ctx.engine.updatables.indexOf(this.spin)
    if (idx >= 0) this.ctx.engine.updatables.splice(idx, 1)
    this.ctx.engine.scene.remove(this.group)
  }
}

/** ② 光合作用：光强/CO₂ → O₂ 气泡速率（米氏型饱和曲线） */
export class PhotosynthesisLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private bubbles: THREE.Points | null = null
  private speeds: number[] = []
  private rate = 0
  private light = 5
  private co2 = 1
  private spinT = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    // 水体（半透明蓝盒）
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4, 2.5),
      new THREE.MeshStandardMaterial({ color: '#4a90c8', transparent: true, opacity: 0.16 })
    )
    water.position.set(0, 2, 0)
    this.group.add(water)

    // 水生植物（金鱼藻风格：茎 + 轮生叶）
    const stemMat = new THREE.MeshStandardMaterial({ color: '#3a8a4a', roughness: 0.6 })
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), stemMat)
    stem.position.set(0, 1.3, 0)
    this.group.add(stem)
    const leafMat = new THREE.MeshStandardMaterial({ color: '#4aa858', roughness: 0.55 })
    for (let ring = 0; ring < 5; ring++) {
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), leafMat)
        leaf.scale.set(1.8, 0.25, 0.5)
        const a = (i / 5) * Math.PI * 2
        leaf.position.set(Math.cos(a) * 0.4, 0.7 + ring * 0.45, Math.sin(a) * 0.4)
        leaf.rotation.y = -a
        this.group.add(leaf)
      }
    }

    // 光源（顶部太阳板）
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.15, 1.2),
      new THREE.MeshStandardMaterial({ color: '#ffe9a0', emissive: 0xffdf80, emissiveIntensity: 0.7 })
    )
    lamp.position.set(0, 4.4, 0)
    this.group.add(lamp)
    const pl = new THREE.PointLight(0xffe9a0, 2, 10)
    pl.position.set(0, 4, 0)
    this.group.add(pl)

    // 气泡
    const N = 80
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.9
      pos[i * 3 + 1] = Math.random() * 3
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.9
      this.speeds.push(0.5 + Math.random())
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xeaf6ff, size: 0.08 }))
    this.group.add(this.bubbles)

    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private computeRate(): number {
    // 速率 = f(光) · g(CO₂)，双饱和（教材级近似）
    const fl = this.light / (this.light + 2)
    const fc = this.co2 / (this.co2 + 0.5)
    return fl * fc
  }

  onParam(id: string, value: number): void {
    if (id === 'light') this.light = value
    else if (id === 'co2') this.co2 = value
    this.rate = this.computeRate()
    const rMax = 1
    const rel = this.rate / rMax
    this.ctx.post('data', { row: [+this.light.toFixed(1), +rel.toFixed(3)] })
    this.ctx.post('result', {
      lines: [
        `相对光合速率 = ${rel.toFixed(2)}（光强 ${this.light.toFixed(1)}，CO₂ ${this.co2.toFixed(1)}）`,
        '6CO₂ + 6H₂O —光照/叶绿体→ C₆H₁₂O₆ + 6O₂',
        '增大光强或 CO₂ 浓度，速率上升并逐渐饱和（受酶数量限制）'
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('light', this.light)
  }
  update(dt: number): void {
    this.spinT += dt
    if (this.bubbles) {
      const arr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) + this.speeds[i] * Math.max(this.rate, 0.02) * dt * 1.4
        if (y > 3.9) {
          y = 0.5
          arr.setX(i, (Math.random() - 0.5) * 0.9)
          arr.setZ(i, (Math.random() - 0.5) * 0.9)
        }
        arr.setY(i, y)
      }
      arr.needsUpdate = true
      this.bubbles.visible = this.rate > 0.02
    }
  }
  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}

/** ③ 显微镜使用：调焦观察洋葱表皮细胞（canvas 纹理视野 + 磨砂离焦层） */
export class MicroscopeLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private frostMat!: THREE.MeshBasicMaterial
  private viewScale = 1
  private focus = 5

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    // 载物台
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.25, 3.4),
      new THREE.MeshStandardMaterial({ color: '#5a6a7a', roughness: 0.5, metalness: 0.3 })
    )
    stage.position.set(0, -0.5, 0)
    this.group.add(stage)

    // 视野平面：canvas 画的"标本"（洋葱表皮细胞网格）
    const tex = new THREE.CanvasTexture(this.makeSpecimen())
    const view = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 2),
      new THREE.MeshBasicMaterial({ map: tex })
    )
    view.position.set(0, -0.36, 0)
    view.rotation.x = -Math.PI / 2
    this.group.add(view)

    // 离焦磨砂层（白色半透明，opacity 随离焦程度）
    this.frostMat = new THREE.MeshBasicMaterial({
      color: '#dfe8ee', transparent: true, opacity: 0.9, depthWrite: false
    })
    const frost = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), this.frostMat)
    frost.position.set(0, -0.35, 0)
    frost.rotation.x = -Math.PI / 2
    this.group.add(frost)

    // 镜筒（视觉装饰）
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 2.2, 20),
      new THREE.MeshStandardMaterial({ color: '#3e4a56', metalness: 0.5, roughness: 0.35 })
    )
    tube.position.set(0, 1.4, 0)
    this.group.add(tube)

    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  /** 生成标本贴图：洋葱表皮细胞砖块状网格 */
  private makeSpecimen(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 340
    const g = c.getContext('2d')!
    g.fillStyle = '#e8f0dc'
    g.fillRect(0, 0, 512, 340)
    g.strokeStyle = '#7a9a6a'
    g.lineWidth = 3
    let y = 10
    let row = 0
    while (y < 340) {
      const h = 44 + (row % 2) * 10
      let x = row % 2 ? 30 : 0
      while (x < 512) {
        const w = 66 + ((row * 7 + x) % 3) * 10
        g.strokeRect(x + 3, y + 3, w - 6, h - 6)
        // 细胞核
        g.fillStyle = '#8a6ab8'
        g.beginPath()
        g.arc(x + w / 2, y + h / 2 + 4, 5, 0, Math.PI * 2)
        g.fill()
        x += w
      }
      y += h
      row++
    }
    return c
  }

  onParam(id: string, value: number): void {
    if (id === 'focus') this.focus = value
    else if (id === 'objective') this.viewScale = 4 / value // 物镜倍数越大视野越小
    // 清晰度：focus=8 最清晰
    const blur = Math.min(1, Math.abs(this.focus - 8) / 6)
    this.frostMat.opacity = blur * 0.92
    const total = value // 仅提示
    const eye = 10
    this.ctx.post('result', {
      lines: [
        `准焦旋钮位置 = ${this.focus.toFixed(1)}（8.0 处最清晰），${blur < 0.15 ? '✓ 图像清晰' : '✗ 图像模糊，请继续调节准焦螺旋'}`,
        `当前总放大倍数 = 目镜 ${eye}× × 物镜（观察视野随倍率变化）`,
        '显微镜使用步骤：取镜安放 → 对光 → 放置玻片 → 先低倍后高倍 → 调节粗/细准焦螺旋至清晰'
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.focus = 5
    this.onParam('focus', 5)
  }
  update(_dt: number): void {}
  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}
