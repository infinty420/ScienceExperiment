import type { ExperimentContext, ExperimentLogic } from '../types'
import { ChemVisual, litmusColor } from '../../engine/chem'

/**
 * 化学四实验（W4）共用一套教学级模拟：
 * 酸碱中和（滴定曲线） / 燃烧三要素 / 沉淀反应 / 金属活动性。
 */

/** ① 酸碱中和滴定：20mL 0.1mol/L 盐酸 + 石蕊，滴加 0.1mol/L NaOH */
export class AcidBaseLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private vis!: ChemVisual
  private vNaOH = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new ChemVisual(ctx.engine.scene, '#d8b8c8')
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private pH(): number {
    // c(HCl)=c(NaOH)=0.1mol/L，V(HCl)=20mL
    const nH = 0.1 * 0.02
    const nOH = 0.1 * (this.vNaOH / 1000)
    const total = 0.02 + this.vNaOH / 1000
    if (nOH < nH) {
      const cH = (nH - nOH) / total
      return -Math.log10(Math.max(cH, 1e-7))
    }
    if (nOH > nH) {
      const cOH = (nOH - nH) / total
      return Math.min(14, 14 + Math.log10(Math.max(cOH, 1e-7)))
    }
    return 7
  }

  onParam(id: string, value: number): void {
    if (id === 'naoh') this.vNaOH = value
    const pH = this.pH()
    this.vis.setLiquid(litmusColor(pH), 0.4 + (this.vNaOH / 50) * 0.6)
    this.ctx.post('data', { row: [this.vNaOH, +pH.toFixed(2)] })
    const eq = Math.abs(this.vNaOH - 20) < 0.6
    this.ctx.post('result', {
      lines: [
        `V(NaOH) = ${this.vNaOH.toFixed(1)} mL，混合液 pH = ${pH.toFixed(2)}`,
        eq
          ? '≈ 中和点：n(NaOH) = n(HCl)，此时 V(NaOH) = 20 mL，pH = 7'
          : this.vNaOH < 20
            ? '盐酸过量，溶液呈酸性（石蕊变红）'
            : 'NaOH 过量，溶液呈碱性（石蕊变蓝）',
        '滴定曲线在 V = 20 mL 附近出现 pH 突跃（4.3 → 9.7）'
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.vNaOH = 0
    this.onParam('naoh', 0)
  }
  update(dt: number): void {
    this.vis.update(dt)
  }
  dispose(): void {
    this.vis.dispose(this.ctx.engine.scene)
  }
}

/** ② 燃烧条件：可燃物 × 氧气 × 达到着火点 */
export class CombustionLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private vis!: ChemVisual
  private fuel = 1
  private oxygen = 1
  private heat = 1

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new ChemVisual(ctx.engine.scene, '#e8e0d0')
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'fuel') this.fuel = value
    else if (id === 'oxygen') this.oxygen = value
    else if (id === 'heat') this.heat = value
    const burning = this.fuel >= 0.5 && this.oxygen >= 0.5 && this.heat >= 0.5
    this.vis.setFlame(burning)
    // 可燃物换成石块时视觉变化（液体颜色示意）
    this.vis.setLiquid(this.fuel >= 0.5 ? '#e8e0d0' : '#9a9a92', 0.35)
    const missing: string[] = []
    if (this.fuel < 0.5) missing.push('可燃物')
    if (this.oxygen < 0.5) missing.push('氧气（助燃物）')
    if (this.heat < 0.5) missing.push('温度未达着火点')
    this.ctx.post('result', {
      lines: burning
        ? ['三者齐备 → 持续燃烧', '燃烧三要素：可燃物、氧气（助燃物）、温度达到着火点']
        : [`缺少：${missing.join('、')} → 不能燃烧`, '灭火原理即破坏任一条件：隔绝氧气 / 降温 / 移除可燃物']
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.fuel = this.oxygen = this.heat = 1
    this.onParam('fuel', 1)
  }
  update(dt: number): void {
    this.vis.update(dt)
  }
  dispose(): void {
    this.vis.dispose(this.ctx.engine.scene)
  }
}

/** ③ 沉淀反应：两组试剂可选 */
const PRECIP_REACTIONS = [
  {
    name: 'AgNO₃ + NaCl',
    equation: 'AgNO₃ + NaCl → AgCl↓ + NaNO₃',
    precipColor: 0xf0f0ec,
    liquid: '#d8e4ea',
    desc: '氯化银白色沉淀（不溶于稀硝酸，用于检验 Cl⁻）'
  },
  {
    name: 'CuSO₄ + NaOH',
    equation: 'CuSO₄ + 2NaOH → Cu(OH)₂↓ + Na₂SO₄',
    precipColor: 0x4a86c8,
    liquid: '#a8c8e0',
    desc: '氢氧化铜蓝色絮状沉淀（检验 Cu²⁺）'
  }
]

export class PrecipitateLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private vis!: ChemVisual
  private reagent = 0
  private volume = 10

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new ChemVisual(ctx.engine.scene, PRECIP_REACTIONS[0].liquid)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'reagent') this.reagent = Math.round(value)
    else if (id === 'volume') this.volume = value
    const rx = PRECIP_REACTIONS[this.reagent]
    const density = Math.min(1, this.volume / 15)
    this.vis.setLiquid(rx.liquid, 0.3 + (this.volume / 20) * 0.7)
    this.vis.setPrecipitate(this.volume > 1 ? density : 0, rx.precipitateColor)
    this.ctx.post('result', {
      lines: [
        `反应：${rx.equation}`,
        `滴加 ${this.volume.toFixed(0)} mL → 沉淀量 ${this.volume <= 1 ? '无' : density < 0.4 ? '少量' : density < 0.8 ? '明显' : '大量'}`,
        rx.desc
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.volume = 0
    this.onParam('volume', 0)
  }
  update(dt: number): void {
    this.vis.update(dt)
  }
  dispose(): void {
    this.vis.dispose(this.ctx.engine.scene)
  }
}

/** ④ 金属活动性：Mg / Zn / Cu + 稀盐酸 */
const METALS = [
  { name: '镁 Mg', rate: 1.0, equation: 'Mg + 2HCl → MgCl₂ + H₂↑', desc: '剧烈反应，产生大量气泡' },
  { name: '锌 Zn', rate: 0.35, equation: 'Zn + 2HCl → ZnCl₂ + H₂↑', desc: '反应较缓慢，气泡连续' },
  { name: '铜 Cu', rate: 0, equation: 'Cu + HCl →（不反应）', desc: '无气泡，铜排在氢之后，不与稀盐酸反应' }
]

export class MetalActivityLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private vis!: ChemVisual
  private metal = 1
  private conc = 1

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new ChemVisual(ctx.engine.scene, '#dfe8ec')
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'metal') this.metal = Math.round(value)
    else if (id === 'conc') this.conc = value
    const m = METALS[this.metal]
    this.vis.setBubbles(m.rate * this.conc)
    this.ctx.post('result', {
      lines: [
        `${m.name} + 稀盐酸：${m.equation}`,
        m.desc,
        '活动性顺序：Mg > Zn > (H) > Cu，排在前面的金属能把后面的金属从盐溶液中置换出来'
      ]
    })
  }

  start(): void {}
  pause(): void {}
  reset(): void {
    this.onParam('metal', this.metal)
  }
  update(dt: number): void {
    this.vis.update(dt)
  }
  dispose(): void {
    this.vis.dispose(this.ctx.engine.scene)
  }
}
