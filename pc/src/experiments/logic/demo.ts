import * as THREE from 'three'
import type { ExperimentContext, ExperimentLogic } from '../types'

/** W1 渲染验证：旋转立方体 */
export class DemoLogic implements ExperimentLogic {
  private ctx!: ExperimentContext
  private cube: THREE.Mesh | null = null
  private spinning = false
  private speed = 1

  init(ctx: ExperimentContext): void {
    this.ctx = ctx
    const pair = ctx.physics.get('cube')
    this.cube = pair ? (pair.mesh as THREE.Mesh) : null
    if (this.cube) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(this.cube.geometry),
        new THREE.LineBasicMaterial({ color: 0xaef0d8 })
      )
      this.cube.add(edges)
    }
  }

  onParam(id: string, value: number): void {
    if (id === 'speed') this.speed = value
  }

  start(): void {
    this.spinning = true
  }

  pause(): void {
    this.spinning = false
  }

  reset(): void {
    this.spinning = false
    if (this.cube) {
      this.cube.rotation.set(0, 0, 0)
      this.cube.position.set(0, 0.85, 0)
    }
  }

  update(dt: number): void {
    if (this.spinning && this.cube) {
      this.cube.rotation.y += this.speed * dt
      this.cube.rotation.x += this.speed * 0.35 * dt
      this.cube.position.y = 0.85 + Math.sin(this.cube.rotation.y * 2) * 0.06
    }
  }

  dispose(): void {
    this.cube = null
  }
}
