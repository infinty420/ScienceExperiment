import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'
import { solveCircuit, currentThrough, type CircuitComponent } from '../../engine/circuit'

/**
 * 电路 3D 视觉（电池/电阻/灯泡/导线），MNA 求解。
 * 回路布局（XY 平面，底边 y=0 顶边 y=2，宽 4）：
 *   底边中点=电池，顶边=电阻(右)+开关(左)，左边中点=灯泡。
 * 灯泡亮度随功率变化（emissive）。
 */
const NODE_COUNT = 5
const R_LAMP = 10 // 灯泡内阻 Ω

export class CircuitVisual {
  private ctx: ExperimentContext
  private group = new THREE.Group()
  private lampGlass: THREE.Mesh | null = null
  private lampMat: THREE.MeshStandardMaterial | null = null
  private voltage = 6
  private resistance = 20
  private closed = true
  private hasLamp: boolean
  private rComp: CircuitComponent
  private lampComp: CircuitComponent | null = null

  constructor(ctx: ExperimentContext, hasLamp: boolean) {
    this.ctx = ctx
    this.hasLamp = hasLamp
    ctx.engine.scene.add(this.group)

    // ---- 导线回路（管状） ----
    const pts = this.hasLamp
      ? [new THREE.Vector3(-0.4, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 2, 0),
          new THREE.Vector3(1.1, 2, 0), new THREE.Vector3(0.25, 2, 0),
          new THREE.Vector3(-0.25, 2, 0), new THREE.Vector3(-1.1, 2, 0),
          new THREE.Vector3(-2, 2, 0), new THREE.Vector3(-2, 0, 0), new THREE.Vector3(-0.4, 0, 0)]
      : [new THREE.Vector3(-0.4, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 2, 0),
          new THREE.Vector3(0.6, 2, 0), new THREE.Vector3(-0.6, 2, 0),
          new THREE.Vector3(-2, 2, 0), new THREE.Vector3(-2, 0, 0), new THREE.Vector3(-0.4, 0, 0)]
    const curve = new THREE.CatmullRomCurve3(pts)
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 128, 0.045, 8, true),
      new THREE.MeshStandardMaterial({ color: '#c9a35a', roughness: 0.4, metalness: 0.7 })
    )
    this.group.add(wire)

    // ---- 电池（底边中点） ----
    const battery = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.85, 20).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#3e6fb0', roughness: 0.5 })
    )
    battery.position.set(0, 0, 0)
    this.group.add(battery)
    const plusCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#d05050' })
    )
    plusCap.position.set(0.46, 0, 0)
    this.group.add(plusCap)

    // ---- 电阻（顶边） ----
    const res = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.8, 16).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#b3702d', roughness: 0.6 })
    )
    res.position.set(this.hasLamp ? 0.7 : 0, 2, 0)
    this.group.add(res)

    // ---- 开关（顶边左） / 电流表 ----
    if (this.hasLamp) {
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.12, 0.25),
        new THREE.MeshStandardMaterial({ color: '#8a6a4a' })
      )
      sw.position.set(-0.7, 2, 0)
      sw.name = 'switch'
      this.group.add(sw)
    } else {
      const meter = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.55, 0.2),
        new THREE.MeshStandardMaterial({ color: '#445566', roughness: 0.4 })
      )
      meter.position.set(-1.1, 1, 0) // 左边中点（无灯泡时放电流表）
      this.group.add(meter)
    }

    // ---- 灯泡（左边中点） ----
    if (this.hasLamp) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.16, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: '#778', metalness: 0.6, roughness: 0.35 })
      )
      base.position.set(-2, 0.72, 0)
      this.group.add(base)
      this.lampMat = new THREE.MeshStandardMaterial({
        color: '#fff8e0', emissive: 0xffdf80, emissiveIntensity: 0,
        transparent: true, opacity: 0.9, roughness: 0.1
      })
      this.lampGlass = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), this.lampMat)
      this.lampGlass.position.set(-2, 1.08, 0)
      this.group.add(this.lampGlass)
    }

    // 电路：节点 0=地(电池负/灯泡底/电流表回)，1=电池正，2=开关左，3=电阻右，4=电阻左
    this.rComp = { type: 'R', nodes: [3, 4], value: this.resistance }
    if (this.hasLamp) {
      this.lampComp = { type: 'R', nodes: [4, 0], value: R_LAMP }
    }
  }

  set(voltage: number, resistance: number, closed: boolean): void {
    this.voltage = voltage
    this.resistance = resistance
    this.closed = closed
  }

  /** MNA 求解，返回 {current, lampPower} */
  solve(): { current: number; lampPower: number } {
    // 电池：0 -> 1（正极节点 1）
    const comps: CircuitComponent[] = [
      { type: 'V', nodes: [1, 0], value: this.voltage },
      // 开关：1 -> 2（断开时近似绝缘）
      { type: 'R', nodes: [1, 2], value: this.closed ? 0.01 : 1e9 },
      this.rComp
    ]
    if (this.hasLamp && this.lampComp) {
      comps.push(this.lampComp) // 4 -> 0
    } else {
      // 无灯泡（欧姆定律）：电阻直接接地 4 -> 0
      comps.push({ type: 'R', nodes: [4, 0], value: 0.01 })
    }
    const sol = solveCircuit(comps, NODE_COUNT)
    const current = Math.abs(currentThrough(sol, this.rComp))
    const lampPower = this.lampComp ? current * current * R_LAMP : 0

    // 灯泡亮度
    if (this.lampMat) {
      const pMax = (this.voltage * this.voltage) / R_LAMP + 1e-9
      this.lampMat.emissiveIntensity = Math.min(lampPower / pMax, 1) * 2.2
    }
    return { current, lampPower }
  }

  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m?.dispose()
    })
  }
}

/** 基础电路：开关 + 调压调阻 + 灯泡亮度 */
export class CircuitBasicLogic implements ExperimentLogic {
  protected ctx!: ExperimentContext
  protected vis!: CircuitVisual
  protected voltage = 6
  protected resistance = 20
  protected closed = 1

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    this.vis = new CircuitVisual(ctx, true)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  onParam(id: string, value: number): void {
    if (id === 'voltage') this.voltage = value
    else if (id === 'resistance') this.resistance = value
    else if (id === 'switch') this.closed = value
    this.vis.set(this.voltage, this.resistance, this.closed >= 0.5)
    this.report()
  }

  protected report(): void {
    const { current, lampPower } = this.vis.solve()
    this.ctx.post('live', { current, lampPower })
    this.ctx.post('data', {
      row: [+this.voltage.toFixed(1), +current.toFixed(4), +lampPower.toFixed(3)]
    })
  }

  start(): void {
    this.report()
  }
  pause(): void {}
  reset(): void {
    this.report()
  }
  update(_dt: number): void {}
  dispose(): void {
    this.vis.dispose()
  }
}

/** 欧姆定律：多组 (U, I) 记录 */
export class OhmLawLogic extends CircuitBasicLogic {
  private rows = 0

  init(ctx: ExperimentContext): void {
    super.init(ctx)
    this.rows = 0
  }

  onParam(id: string, value: number): void {
    if (id === 'voltage') this.voltage = value
    else if (id === 'resistance') this.resistance = value
    this.vis.set(this.voltage, this.resistance, true)
    // 不自动记录，等「开始」手动记录数据点
  }

  start(): void {
    const { current } = this.vis.solve()
    this.ctx.post('data', { row: [+this.voltage.toFixed(1), +current.toFixed(4)] })
    this.rows++
    this.ctx.post('note', { text: `已记录 ${this.rows} 组数据（R = ${this.resistance} Ω）` })
  }

  reset(): void {
    this.rows = 0
  }
}
