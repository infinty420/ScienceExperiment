import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'
import { ChemVisual, litmusColor } from '../../engine/chem'

/**
 * 大学实验（W7）：滴定分析(pKa) / RLC 谐振 / 测量不确定度 / 孟德尔遗传 / 酶动力学。
 */

/** ① 酸碱滴定分析：NaOH 滴定乙酸（弱酸），Henderson–Hasselbalch 测 pKa */
export class TitrationLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private vis!: ChemVisual
  private v = 0
  private readonly pKa = 4.756 // 乙酸 25°C

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new ChemVisual(ctx.engine.scene, '#e0c8d0')
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private pH(): number {
    // 25mL 0.1mol/L HAc，滴加 0.1mol/L NaOH
    const c = 0.1
    const vAc = 0.025
    const nAc0 = c * vAc
    const nOH = c * (this.v / 1000)
    if (this.v < 0.01) {
      // 起始弱酸：[H+] ≈ √(Ka·c)
      const Ka = Math.pow(10, -this.pKa)
      return -Math.log10(Math.sqrt(Ka * c))
    }
    if (nOH < nAc0 * 0.9999) {
      // 缓冲区：pH = pKa + log(nA⁻/nHAc)
      const ratio = nOH / (nAc0 - nOH)
      return this.pKa + Math.log10(ratio)
    }
    if (Math.abs(nOH - nAc0) < nAc0 * 0.0001) {
      // 计量点：Ac⁻水解 pH > 7
      const total = vAc + this.v / 1000
      const cAc = nAc0 / total
      const Ka = Math.pow(10, -this.pKa)
      const cOH = Math.sqrt((1e-14 / Ka) * cAc)
      return 14 + Math.log10(cOH)
    }
    // 过量 NaOH
    const total = vAc + this.v / 1000
    const cOH = (nOH - nAc0) / total
    return Math.min(14, 14 + Math.log10(cOH))
  }

  onParam(id: string, value: number): void {
    if (id === 'naoh') this.v = value
    const pH = this.pH()
    this.vis.setLiquid(litmusColor(pH), 0.4 + (this.v / 50) * 0.6)
    this.ctx.post('data', { row: [this.v, +pH.toFixed(2)] })
    const half = Math.abs(this.v - 25) < 0.6
    this.ctx.post('result', {
      lines: [
        `V(NaOH) = ${this.v.toFixed(1)} mL，pH = ${pH.toFixed(2)}`,
        half
          ? `★ 半中和点：pH = pKa = ${this.pKa.toFixed(2)} → Ka = ${Math.pow(10, -this.pKa).toExponential(2)}`
          : this.v < 25
            ? '缓冲区：pH = pKa + log([Ac⁻]/[HAc])'
            : '计量点 25 mL 后 pH 由过量 NaOH 决定（突跃 7.7 → 9.7）',
        '弱酸滴定曲线特点：起点较高（弱酸部分电离）、计量点 pH > 7'
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('naoh', 0)
  }
  update(dt: number): void {
    this.vis.update(dt)
  }
  dispose(): void {
    this.vis.dispose(this.ctx.engine.scene)
  }
}

/** ② RLC 串联谐振：I(f) 频率响应，f₀ = 1/(2π√LC) */
export class RlcLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private L = 1e-3
  private C = 1e-6
  private R = 10
  private U = 5

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    // 简易电路板视觉：三个元件块
    const g = new THREE.Group()
    const mk = (color: string, x: number, label: string): void => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color })
      )
      m.position.set(x, 0, 0)
      g.add(m)
    }
    mk('#b3702d', -1.2, 'R')
    mk('#3e6fb0', 0, 'L')
    mk('#3f8f79', 1.2, 'C')
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-2.6, -0.6, 0), new THREE.Vector3(2.6, -0.6, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0x889 })
    )
    g.add(axis)
    ctx.engine.scene.add(g)
    this.group = g
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private group!: THREE.Group

  onParam(id: string, value: number): void {
    if (id === 'L') this.L = value * 1e-3
    else if (id === 'C') this.C = value * 1e-6
    else if (id === 'R') this.R = value
    const f0 = 1 / (2 * Math.PI * Math.sqrt(this.L * this.C))
    const Imax = this.U / this.R
    // 记录整条频率响应曲线
    this.ctx.post('note', { text: '' })
    const rows: number[][] = []
    const f1 = f0 / 4
    const f2 = f0 * 4
    const N = 60
    for (let i = 0; i <= N; i++) {
      const f = f1 + ((f2 - f1) * i) / N
      const w = 2 * Math.PI * f
      const Z = Math.sqrt(this.R * this.R + Math.pow(w * this.L - 1 / (w * this.C), 2))
      rows.push([+f.toFixed(0), +(this.U / Z).toFixed(4)])
    }
    this.ctx.post('rows', { rows })
    const Q = (1 / this.R) * Math.sqrt(this.L / this.C)
    this.ctx.post('result', {
      lines: [
        `谐振频率 f₀ = 1/(2π√LC) = ${(f0 / 1000).toFixed(2)} kHz`,
        `谐振电流 I₀ = U/R = ${Imax.toFixed(3)} A；品质因数 Q = (1/R)√(L/C) = ${Q.toFixed(1)}`,
        `带宽 BW = f₀/Q = ${(f0 / Q / 1000).toFixed(2)} kHz（Q 越大曲线越尖锐，选频性越好）`
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('R', this.R)
  }
  update(_dt: number): void {}
  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}

/** ③ 测量不确定度评定（模拟数据 + A/B 类合成） */
export class UncertaintyLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private tol = 0.02
  private n = 10

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'tol') this.tol = value
    else if (id === 'n') this.n = Math.round(value)
    // 生成模拟测量列（真值 10.000 mm）
    const truth = 10.0
    const data: number[] = []
    for (let i = 0; i < this.n; i++) {
      const gauss = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.5
      data.push(+(truth + gauss * this.tol * 0.6).toFixed(3))
    }
    const n = data.length
    const mean = data.reduce((a, b) => a + b, 0) / n
    const s = Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    const uA = s / Math.sqrt(n)
    const uB = this.tol / Math.sqrt(3)
    const uc = Math.sqrt(uA * uA + uB * uB)
    const U = 2 * uc
    for (const v of data) this.ctx.post('data', { row: [v, +(v - mean).toFixed(3)] })
    this.ctx.post('result', {
      lines: [
        `样本均值 x̄ = ${mean.toFixed(3)} mm，实验标准差 s = ${s.toFixed(4)}（n = ${n}）`,
        `A 类不确定度 uA = s/√n = ${uA.toFixed(4)}；B 类 uB = Δ仪/√3 = ${uB.toFixed(4)}`,
        `合成标准不确定度 uc = √(uA²+uB²) = ${uc.toFixed(4)}；扩展不确定度 U = 2uc = ${U.toFixed(4)}（k=2，约95%置信）`,
        `最终结果：x = (${mean.toFixed(3)} ± ${U.toFixed(3)}) mm, k = 2`
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('n', this.n)
  }
  update(_dt: number): void {}
  dispose(): void {}
}

/** ④ 孟德尔遗传杂交模拟（3D 豌豆表型比例可视化） */
const CROSSES = [
  { key: 'Aa×Aa', ratio: [3, 1], desc: 'F2 表现型 3 黄 : 1 绿，基因型 1AA:2Aa:1aa（分离定律）' },
  { key: 'AA×aa', ratio: [1, 0], desc: 'F1 全部 Aa（黄），F1 自交得 F2 再现 3:1' },
  { key: 'Aa×aa', ratio: [1, 1], desc: '测交后代 1 黄 : 1 绿，验证杂合子产生两种配子' }
]

export class GeneticsLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private cross = 0
  private peas: THREE.Mesh[] = []

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)
    for (let i = 0; i < 8; i++) {
      const pea = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#d8c050', roughness: 0.35 })
      )
      pea.position.set(-2.1 + (i % 4) * 1.4, 0.4 + Math.floor(i / 4) * 1.0, 0)
      this.group.add(pea)
      this.peas.push(pea)
    }
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'cross') this.cross = Math.round(value)
    const c = CROSSES[this.cross]
    const yellow = Math.round((c.ratio[0] / (c.ratio[0] + c.ratio[1])) * 8)
    this.peas.forEach((pea, i) => {
      ;(pea.material as THREE.MeshStandardMaterial).color.set(i < yellow ? '#d8c050' : '#7aa860')
    })
    this.ctx.post('result', {
      lines: [
        `亲本组合：${c.key}（黄 Y 对绿 y 显性）`,
        `后代表型：黄 ${yellow} 颗 ： 绿 ${8 - yellow} 颗 ≈ ${c.ratio[0]}:${c.ratio[1] || 0}`,
        c.desc
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('cross', this.cross)
  }
  update(_dt: number): void {}
  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}

/** ⑤ 酶动力学（米氏方程）：v = Vmax·[S]/(Km+[S]) */
export class EnzymeLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private Km = 2
  private Vmax = 1

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    // 视觉：酶（大球）+ 底物（小球群）
    const enzyme = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 20, 16),
      new THREE.MeshStandardMaterial({ color: '#7f5fb8', roughness: 0.4 })
    )
    enzyme.position.set(0, 0.5, 0)
    this.group.add(enzyme)
    for (let i = 0; i < 8; i++) {
      const sub = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 8),
        new THREE.MeshStandardMaterial({ color: '#e0a050' })
      )
      const a = (i / 8) * Math.PI * 2
      sub.position.set(Math.cos(a) * 1.8, 0.3 + (i % 3) * 0.4, Math.sin(a) * 1.8)
      this.group.add(sub)
    }
    ctx.engine.scene.add(this.group)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'Km') this.Km = value
    else if (id === 'Vmax') this.Vmax = value
    // 输出 [S]=0.5~10 的 v 曲线
    this.ctx.post('note', { text: '' })
    const rows: number[][] = []
    for (let S = 0.5; S <= 10.01; S += 0.5) {
      rows.push([+S.toFixed(1), +((this.Vmax * S) / (this.Km + S)).toFixed(3)])
    }
    this.ctx.post('rows', { rows })
    const vHalf = this.Vmax / 2
    this.ctx.post('result', {
      lines: [
        `米氏方程 v = Vmax·[S]/(Km+[S])，当前 Km = ${this.Km.toFixed(1)} mmol/L，Vmax = ${this.Vmax.toFixed(1)} μmol/(L·min)`,
        `[S] = Km 时 v = Vmax/2 = ${vHalf.toFixed(3)}（Km 的物理意义：速率达一半时的底物浓度）`,
        `Lineweaver–Burk 双倒数：1/v = (Km/Vmax)(1/[S]) + 1/Vmax，直线斜率 = Km/Vmax = ${(this.Km / this.Vmax).toFixed(3)}`
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('Km', this.Km)
  }
  update(_dt: number): void {}
  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}
