/**
 * SciLab Engine Core（ESM 版，W2）
 * 渲染循环、轨道相机、拾取事件、FPS。
 * 从 public/engine/core.js 迁移：three 改 npm 包，post 改回调注入。
 */
import * as THREE from 'three'

export type PostFn = (type: string, payload: Record<string, unknown>) => void

export class Engine {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  clock: THREE.Clock
  updatables: Array<(dt: number) => void> = []
  running = true
  fps = 0
  onPost: PostFn | null = null
  /** V2：时间流速（0.1–10），物理/逻辑步长统一缩放 */
  timeScale = 1
  /** V2：暂停态（updatables 收到 dt=0，相机交互仍可用） */
  paused = false
  /** V2：每帧回调（录制器用，参数为缩放后的 dt） */
  onFrame: ((dt: number) => void) | null = null
  /** 每次渲染后回调（用于 UI 刷新数据） */
  private _fpsFrames = 0
  private _fpsTime = 0
  private _target = new THREE.Vector3(0, 1, 0)
  private _ro: ResizeObserver | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x1a2430, 1)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x1a2430, 24, 80)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300)

    const hemi = new THREE.HemisphereLight(0xdfeaf2, 0x22303c, 1.0)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(8, 14, 6)
    this.scene.add(dir)

    this.clock = new THREE.Clock()
    this._bindEvents()
    this.resize()

    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  setCamera(position: number[], target: number[]): void {
    this.camera.position.set(position[0], position[1], position[2])
    this._target.set(target[0], target[1], target[2])
    this.camera.lookAt(this._target)
  }

  private _bindEvents(): void {
    window.addEventListener('resize', () => this.resize())
    // 容器尺寸变化（侧栏开合等）
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize())
      this._ro.observe(this.canvas)
    }

    // 单指/鼠标旋转、双指捏合缩放、滚轮缩放
    const st = { rotating: false, lastX: 0, lastY: 0, pinch: 0 }
    const down = (x: number, y: number): void => {
      st.rotating = true
      st.lastX = x
      st.lastY = y
    }
    const move = (x: number, y: number): void => {
      if (!st.rotating) return
      this.orbit((x - st.lastX) * 0.005, (y - st.lastY) * 0.005)
      st.lastX = x
      st.lastY = y
    }
    const up = (): void => {
      st.rotating = false
    }

    this.canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY))
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY))
    window.addEventListener('mouseup', up)

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        down(e.touches[0].clientX, e.touches[0].clientY)
      } else if (e.touches.length === 2) {
        st.pinch = this._pinch(e.touches)
      }
      e.preventDefault()
    }, { passive: false })
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        move(e.touches[0].clientX, e.touches[0].clientY)
      } else if (e.touches.length === 2) {
        const d = this._pinch(e.touches)
        if (st.pinch > 0) this.zoom(st.pinch / d)
        st.pinch = d
      }
      e.preventDefault()
    }, { passive: false })
    this.canvas.addEventListener('touchend', up)

    this.canvas.addEventListener('wheel', (e) => {
      this.zoom(e.deltaY > 0 ? 1.1 : 0.9)
      e.preventDefault()
    }, { passive: false })
  }

  private _pinch(t: TouchList): number {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  orbit(dx: number, dy: number): void {
    const p = this.camera.position
    const t = this._target
    const r = Math.sqrt(p.x * p.x + p.z * p.z)
    const theta = Math.atan2(p.z, p.x) - dx
    let phi = Math.atan2(p.y - t.y, r) - dy
    phi = Math.max(-0.2, Math.min(1.45, phi))
    const hr = Math.max(1.5, p.distanceTo(t))
    p.x = t.x + Math.cos(theta) * hr * Math.cos(phi)
    p.z = t.z + Math.sin(theta) * hr * Math.cos(phi)
    p.y = t.y + hr * Math.sin(phi)
    this.camera.lookAt(t)
  }

  zoom(factor: number): void {
    const p = this.camera.position
    const v = p.clone().sub(this._target)
    const len = Math.max(2, Math.min(60, v.length() * factor))
    v.setLength(len)
    p.copy(this._target).add(v)
    this.camera.lookAt(this._target)
  }

  resetCamera(position: number[], target: number[]): void {
    this.setCamera(position, target)
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** V2：单步推进（暂停态有效）：以当前流速步进 1/120s 并渲染 */
  stepOnce(): void {
    if (!this.paused) return
    const dt = (1 / 120) * this.timeScale
    for (const fn of this.updatables) fn(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private _loop(): void {
    requestAnimationFrame(this._loop)
    const rawDt = Math.min(this.clock.getDelta(), 0.05)

    this._fpsFrames++
    this._fpsTime += rawDt
    if (this._fpsTime >= 1.0) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime)
      this._fpsFrames = 0
      this._fpsTime = 0
      this.onPost?.('fps', { fps: this.fps })
    }

    const dt = this.paused ? 0 : rawDt * this.timeScale
    if (dt > 0) this.onFrame?.(dt)
    for (const fn of this.updatables) fn(dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.running = false
    this._ro?.disconnect()
    this.renderer.dispose()
    // 清空场景对象
    const clear = (obj: THREE.Object3D): void => {
      for (let i = obj.children.length - 1; i >= 0; i--) {
        const c = obj.children[i]
        clear(c)
        obj.remove(c)
      }
    }
    clear(this.scene)
    this.updatables = []
  }
}
