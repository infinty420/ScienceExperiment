/**
 * cannon-es 物理世界封装（W2）。
 * body 与 mesh 一一对应创建、同步；固定步长 + 累加器步进。
 */
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { Engine } from './core'

export interface PhysObjectDef {
  id: string
  type: 'box' | 'sphere' | 'plane'
  size?: number[]         // box: [x,y,z]；sphere: [r]
  position?: number[]
  rotation?: number[]     // 欧拉角（弧度）
  static?: boolean
  mass?: number
  color?: string
  friction?: number
  restitution?: number
  visible?: boolean       // 仅物理体不可见（如传感器）
  noPhysics?: boolean     // 仅渲染体
}

export interface PhysPair {
  def: PhysObjectDef
  body: CANNON.Body | null
  mesh: THREE.Mesh
}

export class PhysicsWorld {
  world: CANNON.World
  pairs: Map<string, PhysPair> = new Map()
  private accumulator = 0
  private readonly FIXED = 1 / 120

  constructor(gravity: number) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -gravity, 0) })
    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.allowSleep = false
  }

  setGravity(g: number): void {
    this.world.gravity.set(0, -g, 0)
  }

  add(engine: Engine, def: PhysObjectDef): PhysPair {
    // ---- 渲染 mesh ----
    let geo: THREE.BufferGeometry
    if (def.type === 'sphere') {
      geo = new THREE.SphereGeometry(def.size?.[0] ?? 0.4, 24, 16)
    } else {
      const s = def.size ?? [1, 1, 1]
      geo = new THREE.BoxGeometry(s[0], s[1], s[2])
    }
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color ?? '#7a8a99'),
      roughness: 0.55,
      metalness: 0.08
    })
    const mesh = new THREE.Mesh(geo, mat)
    const p = def.position ?? [0, 0, 0]
    mesh.position.set(p[0], p[1], p[2])
    const r = def.rotation ?? [0, 0, 0]
    mesh.rotation.set(r[0], r[1], r[2])
    mesh.visible = def.visible !== false
    engine.scene.add(mesh)

    // ---- 物理 body ----
    let body: CANNON.Body | null = null
    if (!def.noPhysics) {
      let shape: CANNON.Shape
      if (def.type === 'sphere') {
        shape = new CANNON.Sphere(def.size?.[0] ?? 0.4)
      } else if (def.type === 'plane') {
        shape = new CANNON.Plane()
      } else {
        const s = def.size ?? [1, 1, 1]
        shape = new CANNON.Box(new CANNON.Vec3(s[0] / 2, s[1] / 2, s[2] / 2))
      }
      const isStatic = def.static === true
      body = new CANNON.Body({
        mass: isStatic ? 0 : (def.mass ?? 1),
        shape,
        position: new CANNON.Vec3(p[0], p[1], p[2]),
        material: new CANNON.Material({
          friction: def.friction ?? 0.3,
          restitution: def.restitution ?? 0.05
        })
      })
      if (def.rotation) {
        body.quaternion.setFromEuler(def.rotation[0], def.rotation[1], def.rotation[2])
      }
      this.world.addBody(body)
    }

    const pair: PhysPair = { def, body, mesh }
    this.pairs.set(def.id, pair)
    return pair
  }

  get(id: string): PhysPair | undefined {
    return this.pairs.get(id)
  }

  remove(id: string): void {
    const pair = this.pairs.get(id)
    if (!pair) return
    if (pair.body) this.world.removeBody(pair.body)
    pair.mesh.parent?.remove(pair.mesh)
    pair.mesh.geometry.dispose()
    ;(pair.mesh.material as THREE.Material).dispose()
    this.pairs.delete(id)
  }

  /** 每帧调用：累加器固定步进 + 同步 mesh */
  step(dt: number): void {
    this.accumulator += dt
    while (this.accumulator >= this.FIXED) {
      this.world.step(this.FIXED)
      this.accumulator -= this.FIXED
    }
    for (const pair of this.pairs.values()) {
      if (pair.body && !pair.def.static) {
        pair.mesh.position.set(pair.body.position.x, pair.body.position.y, pair.body.position.z)
        pair.mesh.quaternion.set(
          pair.body.quaternion.x, pair.body.quaternion.y, pair.body.quaternion.z, pair.body.quaternion.w
        )
      }
    }
  }

  dispose(): void {
    for (const id of [...this.pairs.keys()]) this.remove(id)
  }
}
