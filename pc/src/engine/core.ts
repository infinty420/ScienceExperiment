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
  /** 2D 合成路径：WebGL 渲到离屏画布，每帧 drawImage 到可见 2D 画布（绕开 ArkWeb WebGL 合成面，根治闪屏） */
  private _glCanvas: HTMLCanvasElement
  private _ctx2d: CanvasRenderingContext2D | null = null
  private _composite = false
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
    this._composite = !!(window as unknown as { __SCILAB_COMPOSITE_2D?: boolean }).__SCILAB_COMPOSITE_2D
    this._glCanvas = this._composite ? document.createElement('canvas') : canvas
    if (this._composite) {
      this._ctx2d = canvas.getContext('2d', { alpha: false })
    }
    // alpha:false 走合成器 opaque 路径；antialias:false 规避 Mali 上 MSAA 合成闪烁
    this.renderer = new THREE.WebGLRenderer({
      canvas: this._glCanvas,
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'high-performance'
    })
    // 渲染缩放：宿主可通过 window.__SCILAB_RENDER_SCALE 指定（鸿蒙 Mali GPU 降负载防闪烁）
    const forcedScale = (window as unknown as { __SCILAB_RENDER_SCALE?: number }).__SCILAB_RENDER_SCALE
    this.renderer.setPixelRatio(forcedScale ?? Math.min(window.devicePixelRatio || 1, 2))
    // 上下文丢失诊断（设备端闪烁时可在页面浮层看到原因）
    this._glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      ;(window as unknown as { __scilabShow?: (m: string) => void }).__scilabShow?.('[contextlost] WebGL 上下文丢失，等待恢复…')
    })
    this._glCanvas.addEventListener('webglcontextrestored', () => {
      ;(window as unknown as { __scilabShow?: (m: string) => void }).__scilabShow?.('[contextrestored] WebGL 上下文已恢复')
    })
    // 渲染缩放由构造时的 forcedScale 决定，此处不再重复设置
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
    this._dirty = true
  }

  /** V4：按需渲染——外部（参数变化等）标记需要重绘 */
  markDirty(): void {
    this._dirty = true
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
    this._dirty = true
  }

  zoom(factor: number): void {
    const p = this.camera.position
    const v = p.clone().sub(this._target)
    const len = Math.max(2, Math.min(60, v.length() * factor))
    v.setLength(len)
    p.copy(this._target).add(v)
    this.camera.lookAt(this._target)
    this._dirty = true
  }

  resetCamera(position: number[], target: number[]): void {
    this.setCamera(position, target)
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    // 幂等守卫：尺寸未变不重设缓冲（防 ResizeObserver 风暴导致每帧重分配→闪烁）
    if (w === this._lastW && h === this._lastH) return
    this._lastW = w
    this._lastH = h
    // 风暴检测：1 秒内 resize 超过 10 次则提示（诊断用，正常完全静默）
    this._resizeCount++
    const now = performance.now()
    if (now - this._resizeTime > 1000) {
      if (this._resizeCount > 10) {
        ;(window as unknown as { __scilabShow?: (m: string) => void }).__scilabShow?.(
          `[resize风暴] 1s 内 ${this._resizeCount} 次 resize（${w}x${h}）`
        )
      }
      this._resizeCount = 0
      this._resizeTime = now
    }
    this.renderer.setSize(w, h, false)
    if (this._ctx2d) {
      // 可见 2D 画布缓冲与 GL 缓冲保持一致（1:1 拷贝，CSS 尺寸不变）
      this.canvas.width = this._glCanvas.width
      this.canvas.height = this._glCanvas.height
    }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this._dirty = true
  }

  private _lastW = 0
  private _lastH = 0
  private _resizeCount = 0
  private _resizeTime = 0

  /** V4：按需渲染状态——dirty 即时渲染；运行中 30fps 上限；空闲 500ms 心跳 */
  private _dirty = true
  private _lastRenderT = 0
  private _acc = 0

  /** V2：单步推进（暂停态有效）：以当前流速步进 1/120s 并渲染 */
  stepOnce(): void {
    if (!this.paused) return
    const dt = (1 / 120) * this.timeScale
    for (const fn of this.updatables) fn(dt)
    this.renderer.render(this.scene, this.camera); this._blit()
    this._lastRenderT = performance.now()
    this._dirty = false
  }

  /** 2D 合成：把离屏 GL 画布拷贝到可见画布 */
  private _blit(): void {
    if (this._ctx2d) this._ctx2d.drawImage(this._glCanvas, 0, 0)
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
    this._acc += dt
    if (dt > 0) this.onFrame?.(dt)

    // 按需渲染：交互/参数变化即时画；运行中封顶 30fps；空闲每 500ms 心跳一帧
    const now = performance.now()
    const active = dt > 0 || this._dirty
    const due = active ? now - this._lastRenderT >= 33 : now - this._lastRenderT >= 500
    if (active || due) {
      const step = this._acc
      this._acc = 0
      for (const fn of this.updatables) fn(step)
      this.renderer.render(this.scene, this.camera); this._blit()
      this._lastRenderT = now
      this._dirty = false
    }
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
