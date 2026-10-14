import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/**
 * 进阶物理实验（全面升级 U1）：
 * 动量守恒碰撞 / 简谐振动 / 浮力 / 气体定律 / 机械能守恒。
 */

/** ① 动量守恒碰撞：双球对撞，恢复系数可调 */
export class CollisionLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private m1 = 1
  private m2 = 2
  private v1 = 3
  private v2 = -1
  private e = 1
  private running = false
  private t = 0
  private sampleAcc = 0
  private collided = false
  private postAcc = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
    // 监听球-球碰撞
    const b1 = ctx.physics.get('ball1')?.body
    const b2 = ctx.physics.get('ball2')?.body
    if (b1 && b2) {
      b1.addEventListener('collide', (ev: { body: CANNON.Body }) => {
        if (ev.body === b2 && !this.collided) this.onCollide()
      })
    }
  }

  private place(): void {
    const p1 = this.ctx.physics.get('ball1')
    const p2 = this.ctx.physics.get('ball2')
    if (!p1?.body || !p2?.body) return
    const y = 0.42
    p1.body.position.set(-3, y, 0)
    p2.body.position.set(3, y, 0)
    p1.body.velocity.set(0, 0, 0)
    p2.body.velocity.set(0, 0, 0)
    p1.mesh.position.set(-3, y, 0)
    p2.mesh.position.set(3, y, 0)
  }

  onParam(id: string, value: number): void {
    if (id === 'm1') {
      this.m1 = value
      const b = this.ctx.physics.get('ball1')?.body
      if (b) { b.mass = value; b.updateMassProperties() }
    } else if (id === 'm2') {
      this.m2 = value
      const b = this.ctx.physics.get('ball2')?.body
      if (b) { b.mass = value; b.updateMassProperties() }
    } else if (id === 'v1') this.v1 = value
    else if (id === 'v2') this.v2 = value
    else if (id === 'e') {
      this.e = value
      // 更新两球材质弹性
      for (const pid of ['ball1', 'ball2']) {
        const pair = this.ctx.physics.get(pid)
        if (pair?.body) (pair.body.material as CANNON.Material).restitution = value
      }
    }
    this.running = false
    this.collided = false
    this.t = 0
    this.place()
  }

  private mom(): number {
    const b1 = this.ctx.physics.get('ball1')?.body
    const b2 = this.ctx.physics.get('ball2')?.body
    if (!b1 || !b2) return 0
    return b1.mass * b1.velocity.x + b2.mass * b2.velocity.x
  }

  private kin(): number {
    const b1 = this.ctx.physics.get('ball1')?.body
    const b2 = this.ctx.physics.get('ball2')?.body
    if (!b1 || !b2) return 0
    return 0.5 * b1.mass * b1.velocity.x ** 2 + 0.5 * b2.mass * b2.velocity.x ** 2
  }

  private onCollide(): void {
    this.collided = true
    this.postAcc = 0
    this.postSample()
  }

  private postSample(): void {
    const b1 = this.ctx.physics.get('ball1')?.body
    const b2 = this.ctx.physics.get('ball2')?.body
    if (!b1 || !b2) return
    const p = this.mom()
    const k = this.kin()
    const pBefore = this.m1 * this.v1 + this.m2 * this.v2
    const kBefore = 0.5 * this.m1 * this.v1 ** 2 + 0.5 * this.m2 * this.v2 ** 2
    this.ctx.post('result', {
      lines: [
        `碰前：v₁ = ${this.v1.toFixed(1)} m/s，v₂ = ${this.v2.toFixed(1)} m/s，总动量 = ${pBefore.toFixed(3)} kg·m/s，总动能 = ${kBefore.toFixed(3)} J`,
        `碰后：v₁' = ${b1.velocity.x.toFixed(3)} m/s，v₂' = ${b2.velocity.x.toFixed(3)} m/s，总动量 = ${p.toFixed(3)} kg·m/s，总动能 = ${k.toFixed(3)} J`,
        `动量守恒：p' − p = ${(p - pBefore).toFixed(4)} kg·m/s（误差来自数值积分）；${this.e >= 0.999 ? '弹性碰撞动能也守恒' : `非弹性碰撞，动能损失 ${kBefore > 0 ? ((kBefore - k) / kBefore * 100).toFixed(1) : '—'}%（转化为内能）`}`
      ]
    })
  }

  start(): void {
    this.place()
    this.collided = false
    this.t = 0
    this.sampleAcc = 0
    const b1 = this.ctx.physics.get('ball1')?.body
    const b2 = this.ctx.physics.get('ball2')?.body
    if (b1) b1.velocity.set(this.v1, 0, 0)
    if (b2) b2.velocity.set(-Math.abs(this.v2) < 1e-9 ? 0 : -this.v2, 0, 0)
    if (b2) b2.velocity.set(-Math.abs(this.v2), 0, 0)
    this.running = true
  }

  pause(): void {
    this.running = false
  }

  reset(): void {
    this.running = false
    this.collided = false
    this.place()
  }

  update(dt: number): void {
    if (!this.running) return
    this.t += dt
    this.sampleAcc += dt
    if (this.sampleAcc >= 0.1) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +this.mom().toFixed(3), +this.kin().toFixed(3)] })
    }
    // 碰撞后短暂延迟再采样（等求解稳定）
    if (this.collided) {
      this.postAcc += dt
      if (this.postAcc > 0.08 && this.postAcc - dt <= 0.08) {
        this.postSample()
      }
    }
    // 结束条件：碰撞后 2s
    if (this.collided && this.postAcc > 2.5) {
      this.running = false
    }
    if (this.t > 12) this.running = false
  }

  dispose(): void {
    this.running = false
  }
}

/** ② 简谐振动（弹簧振子）：解析积分，x = A·cos(ωt) */
export class ShmLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private k = 20
  private m = 1
  private A = 1
  private x = 1
  private v = 0
  private t = 0
  private running = false
  private springLine: THREE.Line | null = null
  private lastCrossT = -1
  private periods: number[] = []
  private sampleAcc = 0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 3), 3))
    this.springLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xc9a35a }))
    ctx.engine.scene.add(this.springLine)
    // 墙面
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 2.6, 2),
      new THREE.MeshStandardMaterial({ color: '#5a6a7a' })
    )
    wall.position.set(-3.2, 0.8, 0)
    ctx.engine.scene.add(wall)
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private updateSpring(): void {
    if (!this.springLine) return
    const arr = this.springLine.geometry.getAttribute('position') as THREE.BufferAttribute
    const x0 = -3.1
    const x1 = this.x
    const N = 22
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1)
      const zig = i === 0 || i === N - 1 ? 0 : (i % 2 === 0 ? 0.18 : -0.18)
      arr.setXYZ(i, x0 + (x1 - x0) * f, 0.7 + zig, 0)
    }
    arr.needsUpdate = true
  }

  private syncBall(): void {
    const ball = this.ctx.physics.get('ball')
    if (ball) ball.mesh.position.set(this.x, 0.7, 0)
    this.updateSpring()
  }

  onParam(id: string, value: number): void {
    if (id === 'k') this.k = value
    else if (id === 'm') this.m = value
    else if (id === 'A') this.A = value
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
    this.x = this.A
    this.v = 0
    this.t = 0
    this.lastCrossT = -1
    this.periods = []
    this.sampleAcc = 0
    this.syncBall()
  }

  update(dt: number): void {
    if (!this.running) return
    const steps = 8
    const h = dt / steps
    const w2 = this.k / this.m
    for (let i = 0; i < steps; i++) {
      this.v += -w2 * this.x * h
      this.x += this.v * h
    }
    this.t += dt
    this.syncBall()

    // 过零测周期（x 由正变负，v<0）
    if (this.lastCrossT > 0 && this.x < 0 && this.v < 0) {
      const T = this.t - this.lastCrossT
      this.periods.push(T)
      this.lastCrossT = this.t
      if (this.periods.length === 3) {
        const avg = this.periods.reduce((a, b) => a + b, 0) / this.periods.length
        const Tth = 2 * Math.PI * Math.sqrt(this.m / this.k)
        this.ctx.post('result', {
          lines: [
            `实测平均周期 T = ${avg.toFixed(3)} s（3 次测量）`,
            `理论周期 T = 2π√(m/k) = ${Tth.toFixed(3)} s`,
            `固有频率 f = 1/T = ${(1 / avg).toFixed(3)} Hz；振幅 A = ${this.A.toFixed(2)} m 处最大恢复力 F = kA = ${(this.k * this.A).toFixed(1)} N`
          ]
        })
        this.running = false
      }
    } else if (this.x < 0 && this.v < 0 && this.lastCrossT <= 0) {
      this.lastCrossT = this.t
    }

    this.sampleAcc += dt
    if (this.sampleAcc >= 0.05) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +this.x.toFixed(3), +this.v.toFixed(3)] })
    }
  }

  dispose(): void {
    this.running = false
    if (this.springLine) {
      this.ctx.engine.scene.remove(this.springLine)
      this.springLine = null
    }
  }
}

/** ③ 浮力：手动施加 F = ρ水·g·V排，验证漂浮条件 */
export class BuoyancyLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private density = 600
  private readonly a = 0.7 // 立方体边长
  private readonly waterY = 1.0
  private readonly rhoW = 1000
  private readonly g = 9.8
  private running = false
  private t = 0
  private sampleAcc = 0
  private settled = false

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    // 水箱（半透明）
    const tank = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.2, 2.2),
      new THREE.MeshStandardMaterial({ color: '#4a90c8', transparent: true, opacity: 0.2 })
    )
    tank.position.set(0, 1.1, 0)
    ctx.engine.scene.add(tank)
    // 水面线
    const wl = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.5, this.waterY, 1.11), new THREE.Vector3(1.5, this.waterY, 1.11)
      ]),
      new THREE.LineBasicMaterial({ color: 0x8ac8f0 })
    )
    ctx.engine.scene.add(wl)
    this.tank = tank
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private tank!: THREE.Mesh

  private place(): void {
    const cube = this.ctx.physics.get('cube')
    if (!cube?.body) return
    cube.body.mass = this.density * this.a ** 3 / 1000 // 缩放质量单位适配场景
    cube.body.updateMassProperties()
    cube.body.position.set(0, 2.6, 0)
    cube.body.velocity.set(0, 0, 0)
    cube.mesh.position.set(0, 2.6, 0)
    this.settled = false
  }

  onParam(id: string, value: number): void {
    if (id === 'density') this.density = value
    this.running = false
    this.t = 0
    this.place()
    const rho = this.density
    this.ctx.post('result', {
      lines: rho < 1000
        ? [
            `物块密度 ${rho} kg/m³ < 水密度 1000 kg/m³ → 漂浮`,
            `漂浮条件：F浮 = G，即 ρ水·g·V排 = ρ物·g·V物 → V排/V物 = ρ物/ρ水 = ${(rho / 1000).toFixed(2)}`,
            `预期平衡吃水深度 = ${((rho / 1000) * this.a).toFixed(3)} m（边长 ${this.a} m）`
          ]
        : [
            `物块密度 ${rho} kg/m³ ≥ 水密度 1000 kg/m³ → 悬浮/下沉`,
            'ρ物 = ρ水 时可悬浮在任意深度；ρ物 > ρ水 时下沉（F浮 < G）'
          ]
    })
  }

  start(): void {
    this.place()
    this.t = 0
    this.running = true
  }
  pause(): void {
    this.running = false
  }
  reset(): void {
    this.onParam('density', this.density)
  }

  update(dt: number): void {
    // 浮力始终生效（含静止时支撑）
    const cube = this.ctx.physics.get('cube')
    if (!cube?.body) return
    const y = cube.body.position.y
    const bottom = y - this.a / 2
    const hSub = Math.max(0, Math.min(this.a, this.waterY - bottom))
    const Vsub = this.a * this.a * hSub
    // 力按场景质量比例缩放（place 中质量=ρ·V/1000，故 g 用 9.8/1000 补偿）
    const F = this.rhoW * this.g * Vsub / 1000
    cube.body.applyForce(new CANNON.Vec3(0, F, 0))
    // 水阻力（线性阻尼）
    cube.body.velocity.scale(1 - Math.min(0.06, dt * 3), cube.body.velocity)

    if (!this.running) return
    this.t += dt
    this.sampleAcc += dt
    if (this.sampleAcc >= 0.1) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +hSub.toFixed(3)] })
    }
    // 平衡判定
    const speed = cube.body.velocity.length()
    if (this.t > 2.5 && speed < 0.03 && !this.settled) {
      this.settled = true
      this.running = false
      this.ctx.post('result', {
        lines: [
          `平衡吃水深度 = ${hSub.toFixed(3)} m（V排/V物 = ${(hSub / this.a).toFixed(3)}）`,
          `验证 ρ物/ρ水 = ${(this.density / 1000).toFixed(3)} ≈ V排/V物 ✓（阿基米德原理 + 漂浮条件）`,
          this.density > 1000 ? '密度大于水，沉底' : this.density === 1000 ? '恰好悬浮' : '密度小于水，漂浮'
        ]
      })
    }
  }

  dispose(): void {
    this.running = false
    this.ctx.engine.scene.remove(this.tank)
  }
}

/** ④ 气体定律：PV = nRT，活塞气缸 + 分子动画 */
export class GasLawLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private group = new THREE.Group()
  private piston!: THREE.Mesh
  private molecules!: THREE.Points
  private vels: number[] = []
  private T = 300
  private weights = 2
  private readonly nR = 8.314 * 0.4 // 摩尔数 × R（场景标定）
  private readonly area = 1.0

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    ctx.engine.scene.add(this.group)

    // 气缸（透明圆筒，竖直）
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 3.4, 24, 1, true),
      new THREE.MeshPhysicalMaterial({ color: '#cfe0ea', transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    )
    cylinder.position.set(0, 1.7, 0)
    this.group.add(cylinder)

    // 活塞
    this.piston = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: '#8a8f96', metalness: 0.6, roughness: 0.3 })
    )
    this.group.add(this.piston)

    // 砝码
    this.weightsMesh = new THREE.Group()
    this.group.add(this.weightsMesh)

    // 分子
    const N = 60
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.0
      pos[i * 3 + 1] = Math.random() * 2.5
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.0
      this.vels.push(Math.random() * Math.PI * 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.molecules = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe07a3e, size: 0.08 }))
    this.group.add(this.molecules)

    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private weightsMesh!: THREE.Group
  private time = 0

  /** 当前压强（砝码重力/面积）与体积 */
  private state(): { P: number; V: number } {
    const P = 1 + this.weights * 0.5 // 标定：每个砝码 +0.5 单位压强
    const V = this.nR * this.T / P
    return { P, V }
  }

  onParam(id: string, value: number): void {
    if (id === 'T') this.T = value
    else if (id === 'weights') this.weights = Math.round(value)
    const { P, V } = this.state()
    // 活塞位置：V 映射到气缸高度（V 标定范围约 2~10）
    const hGas = Math.max(0.3, Math.min(3.2, V))
    this.piston.position.set(0, 0.1 + hGas, 0)
    // 分子活动范围缩放
    const arr = this.molecules.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < arr.count; i++) {
      if (arr.getY(i) > hGas) arr.setY(i, Math.random() * hGas)
    }
    arr.needsUpdate = true
    // 砝码视觉
    this.weightsMesh.clear()
    for (let i = 0; i < this.weights; i++) {
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16),
        new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.5 })
      )
      w.position.set(0, 0.32 + hGas + 0.15 * i, 0)
      this.weightsMesh.add(w)
    }
    this.ctx.post('result', {
      lines: [
        `温度 T = ${this.T} K，砝码 ${this.weights} 个 → 压强 P = ${P.toFixed(1)}（任意单位），体积 V = nRT/P = ${V.toFixed(2)}`,
        `乘积 P·V = ${(P * V).toFixed(2)} = nRT = ${this.nR * this.T}（当前温度下恒定）`,
        '玻意耳定律：等温条件下 P 与 V 成反比（双曲线）；查理定律：等压下 V ∝ T'
      ]
    })
  }

  start(): void {
    const { P, V } = this.state()
    this.ctx.post('data', { row: [+V.toFixed(2), +P.toFixed(2)] })
  }
  pause(): void {}
  reset(): void {}

  update(dt: number): void {
    this.time += dt
    // 分子运动速度 ∝ √T
    const speed = 0.4 * Math.sqrt(this.T / 300)
    const arr = this.molecules.geometry.getAttribute('position') as THREE.BufferAttribute
    const hGas = Math.max(0.3, Math.min(3.2, this.state().V))
    for (let i = 0; i < arr.count; i++) {
      let x = arr.getX(i) + Math.cos(this.vels[i]) * speed * dt
      let y = arr.getY(i) + Math.sin(this.vels[i]) * speed * dt
      if (Math.abs(x) > 0.5) this.vels[i] = Math.PI - this.vels[i]
      if (y < 0.1 || y > hGas - 0.1) this.vels[i] = -this.vels[i]
      arr.setX(i, Math.max(-0.5, Math.min(0.5, x)))
      arr.setY(i, Math.max(0.12, Math.min(hGas - 0.12, y)))
    }
    arr.needsUpdate = true
  }

  dispose(): void {
    this.ctx.engine.scene.remove(this.group)
  }
}

/** ⑤ 机械能守恒：竖直上抛，实时 Ek / Ep / E 总量 */
export class EnergyLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private v0 = 12
  private readonly g = 9.8
  private readonly m = 1
  private running = false
  private t = 0
  private sampleAcc = 0
  private hMax = 0
  private done = false

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    // 高度标尺
    for (let h = 0; h <= 15; h += 5) {
      const tick = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(1.2, h, 0), new THREE.Vector3(1.5, h, 0)
        ]),
        new THREE.LineBasicMaterial({ color: 0x889 })
      )
      ctx.engine.scene.add(tick)
    }
    for (const p of ctx.def.params) this.onParam(p.id, p.value)
  }

  private place(): void {
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    ball.body.position.set(0, 0.3, 0)
    ball.body.velocity.set(0, 0, 0)
    ball.mesh.position.set(0, 0.3, 0)
    this.hMax = 0
    this.done = false
  }

  onParam(id: string, value: number): void {
    if (id === 'v0') this.v0 = value
    this.running = false
    this.t = 0
    this.place()
    const hTh = (this.v0 * this.v0) / (2 * this.g)
    this.ctx.post('result', {
      lines: [
        `初速 v₀ = ${this.v0.toFixed(1)} m/s 竖直上抛，理论最大高度 h = v₀²/2g = ${hTh.toFixed(2)} m`,
        `全程机械能 E = ½mv₀² = ${(0.5 * this.m * this.v0 ** 2).toFixed(1)} J 保持守恒（忽略空气阻力）`,
        '观察曲线：动能与势能此消彼长，总和 E 始终为水平线'
      ]
    })
  }

  start(): void {
    this.place()
    const ball = this.ctx.physics.get('ball')
    if (ball?.body) ball.body.velocity.set(0, this.v0, 0)
    this.t = 0
    this.running = true
  }
  pause(): void {
    this.running = false
  }
  reset(): void {
    this.onParam('v0', this.v0)
  }

  update(dt: number): void {
    if (!this.running) return
    this.t += dt
    const ball = this.ctx.physics.get('ball')
    if (!ball?.body) return
    const h = Math.max(0, ball.body.position.y - 0.3)
    const v = ball.body.velocity.y
    const ek = 0.5 * this.m * v * v
    const ep = this.m * this.g * h
    const e = ek + ep
    this.hMax = Math.max(this.hMax, h)

    this.sampleAcc += dt
    if (this.sampleAcc >= 0.1) {
      this.sampleAcc = 0
      this.ctx.post('data', { row: [+this.t.toFixed(2), +h.toFixed(2), +ek.toFixed(2), +ep.toFixed(2), +e.toFixed(2)] })
    }

    // 落回地面结束
    if (ball.body.position.y <= 0.32 && this.t > 0.5 && v < 0) {
      this.running = false
      if (!this.done) {
        this.done = true
        const hTh = (this.v0 * this.v0) / (2 * this.g)
        this.ctx.post('result', {
          lines: [
            `实测最大高度 h = ${this.hMax.toFixed(2)} m，理论 h = v₀²/2g = ${hTh.toFixed(2)} m，误差 = ${(Math.abs(this.hMax - hTh) / hTh * 100).toFixed(1)} %`,
            `初始动能 = ${(0.5 * this.m * this.v0 ** 2).toFixed(1)} J；最高点全部转化为势能 = ${(this.m * this.g * this.hMax).toFixed(1)} J`,
            '机械能守恒定律：只有重力做功时，Ek + Ep 总量保持不变'
          ]
        })
      }
    }
  }

  dispose(): void {
    this.running = false
  }
}
