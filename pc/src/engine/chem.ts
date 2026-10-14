import * as THREE from 'three'

/**
 * 化学实验视觉组件（W4）：试管、液体变色、气泡、沉淀、火焰。
 * 教学级近似：只模拟可见现象。
 */
export class ChemVisual {
  private group = new THREE.Group()
  private liquidMat: THREE.MeshStandardMaterial
  private liquid: THREE.Mesh
  private bubbles: THREE.Points | null = null
  private bubbleSpeeds: number[] = []
  private precip: THREE.Points | null = null
  private flame: THREE.Points | null = null
  private flameLights: THREE.PointLight | null = null
  private bubbleRate = 0 // 0~1，0 = 无气泡
  private burning = false
  private time = 0

  constructor(parent: THREE.Scene, liquidColor = '#cfe4f0') {
    parent.add(this.group)

    // 试管（透明玻璃）
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.3, 2.4, 20, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: '#dceaf2', transparent: true, opacity: 0.22,
        roughness: 0.05, side: THREE.DoubleSide
      })
    )
    glass.position.set(0, 1.2, 0)
    this.group.add(glass)

    // 圆底
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#dceaf2', transparent: true, opacity: 0.25, roughness: 0.05 })
    )
    bottom.position.set(0, 0.02, 0)
    this.group.add(bottom)

    // 液体（颜色/高度可变）
    this.liquidMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(liquidColor), transparent: true, opacity: 0.75, roughness: 0.1
    })
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.27, 1.6, 18), this.liquidMat)
    this.liquid.position.set(0, 0.85, 0)
    this.group.add(this.liquid)
  }

  /** 液体颜色（十六进制字符串）与高度比例(0~1) */
  setLiquid(color: string, level = 1): void {
    this.liquidMat.color.set(color)
    const h = 0.3 + 1.4 * Math.max(0, Math.min(1, level))
    this.liquid.scale.set(1, h / 1.6, 1)
    this.liquid.position.y = 0.05 + h / 2
  }

  /** 气泡强度 0~1（如金属与酸反应、沸腾） */
  setBubbles(rate: number): void {
    this.bubbleRate = rate
    if (rate > 0 && !this.bubbles) {
      const N = 60
      const pos = new Float32Array(N * 3)
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 0.5
        pos[i * 3 + 1] = Math.random() * 1.5
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.5
        this.bubbleSpeeds.push(0.5 + Math.random())
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xeaf6ff, size: 0.07 }))
      this.group.add(this.bubbles)
    }
  }

  /** 沉淀（粒子沉在底部，密度 0~1） */
  setPrecipitate(density: number, color: number): void {
    if (density <= 0) {
      if (this.precip) this.precip.visible = false
      return
    }
    if (!this.precip) {
      const N = 200
      const pos = new Float32Array(N * 3)
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 0.5
        pos[i * 3 + 1] = 0.06 + Math.random() * 0.12
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.5
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.precip = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.06 }))
      this.group.add(this.precip)
    }
    this.precip.visible = true
    ;(this.precip.material as THREE.PointsMaterial).color.setHex(color)
    this.precip.scale.set(1, Math.max(0.4, density * 2.5), 1)
  }

  /** 火焰（燃烧实验用） */
  setFlame(on: boolean): void {
    this.burning = on
    if (on && !this.flame) {
      const N = 40
      const pos = new Float32Array(N * 3)
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 0.16
        pos[i * 3 + 1] = Math.random() * 0.5
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.16
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.flame = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xff9040, size: 0.09, transparent: true, opacity: 0.9
      }))
      this.flame.position.set(0, 2.75, 0)
      this.group.add(this.flame)
      this.flameLights = new THREE.PointLight(0xff9040, 1.5, 3)
      this.flameLights.position.set(0, 2.9, 0)
      this.group.add(this.flameLights)
      // 火柴梗
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8),
        new THREE.MeshStandardMaterial({ color: '#a08050' })
      )
      stick.position.set(0, 2.5, 0)
      this.group.add(stick)
    }
    if (this.flame) this.flame.visible = on
    if (this.flameLights) this.flameLights.intensity = on ? 1.5 : 0
  }

  update(dt: number): void {
    this.time += dt
    // 气泡上升
    if (this.bubbles && this.bubbleRate > 0) {
      this.bubbles.visible = true
      const arr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) + this.bubbleSpeeds[i] * this.bubbleRate * dt * 1.6
        if (y > 1.55) {
          y = 0.1
          arr.setX(i, (Math.random() - 0.5) * 0.5)
          arr.setZ(i, (Math.random() - 0.5) * 0.5)
        }
        arr.setY(i, y)
      }
      arr.needsUpdate = true
    } else if (this.bubbles) {
      this.bubbles.visible = false
    }
    // 火焰摇曳
    if (this.flame && this.burning) {
      const arr = this.flame.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) + dt * (0.8 + (i % 5) * 0.15)
        if (y > 0.55) y = 0
        arr.setY(i, y)
        arr.setX(i, (Math.random() - 0.5) * 0.16)
      }
      arr.needsUpdate = true
      if (this.flameLights) {
        this.flameLights.intensity = 1.2 + Math.sin(this.time * 18) * 0.35
      }
    }
  }

  dispose(parent: THREE.Scene): void {
    parent.remove(this.group)
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}

/** 酸碱指示剂颜色（石蕊：酸红 / 中性紫 / 碱蓝） */
export function litmusColor(pH: number): string {
  if (pH < 6) return '#d05050'
  if (pH <= 8) return '#8a5aa0'
  return '#4a6ad0'
}
