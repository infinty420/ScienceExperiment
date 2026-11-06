/**
 * SciLab Engine Core（ESM 版，W2 → r8 性能治理）
 * 渲染循环、轨道相机、拾取事件、FPS。
 *
 * r8 变更：
 * - 删除 2D 合成路径（_composite/_ctx2d/_blit 等，全工程无 __SCILAB_COMPOSITE_2D 设置方，事实死代码）；
 *   渲染链路定案为直连 GL canvas（memory r5），离屏读回路径彻底移除。
 * - 删除无调用的 resetCamera（setCamera 别名）。
 * - 帧率节流逻辑修正：原 `active || due` 使 30fps 上限被短路失效；现按 maxFps 正确节流，
 *   默认 maxFps=0 跟随显示器刷新率（60/90/120Hz 自适应，rAF 与 vsync 对齐），稳定优先。
 * - dispose 彻底化：事件监听全部可移除（修复匿名回调泄漏）、forceContextLoss 释放 WebGL context
 *   （根治 r7 双 context 竞争闪屏）、幂等。
 * - preserveDrawingBuffer 按平台区分：鸿蒙 ArkWeb 读回需 preserve=true（r3/r4 教训），
 *   PC 端关闭以去掉缓冲保留开销、提升帧率。
 */
import * as THREE from 'three'

export type PostFn = (type: string, payload: Record<string, unknown>) => void

/** 宿主可注入的窗口开关（鸿蒙原生经 runJavaScript 注入） */
interface HostFlags {
  __SCILAB_RENDER_SCALE?: number
  __SCILAB_PRESERVE_BUFFER?: boolean
  __scilabShow?: (m: string) => void
  nativeBridge?: unknown
}

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
  /**
   * 运行中帧率上限（fps）。0 = 跟随显示器刷新率（rAF 与 vsync 对齐，120Hz 屏可跑满 120）；
   * >0 主动限速（如鸿蒙 Mali 防过热可设 60）。稳定优先：设备性能不足时 rAF 自然降频。
   */
  maxFps = 0

  private _fpsFrames = 0
  private _fpsTime = 0
  private _target = new THREE.Vector3(0, 1, 0)
  private _ro: ResizeObserver | null = null
  private _host: HostFlags

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this._host = window as unknown as HostFlags
    const show = this._host.__scilabShow

    // 渲染缩放：宿主可通过 window.__SCILAB_RENDER_SCALE 指定（鸿蒙 Mali GPU 降负载防闪烁）
    const forcedScale = this._host.__SCILAB_RENDER_SCALE
    // preserve 策略：鸿蒙 ArkWeb readPixels/drawImage 读回依赖保留缓冲；PC 关闭以提速
    const isHos = /ArkWeb|OpenHarmony|HarmonyOS/i.test(navigator.userAgent) || !!this._host.nativeBridge
    const preserve = this._host.__SCILAB_PRESERVE_BUFFER ?? isHos

    // r8：boot 标记无条件输出（含 scale/preserve，截图可确认装的是新包）
    show?.('[boot] r8 direct-gl scale=' + (forcedScale ?? 'auto') + ' preserve=' + preserve)

    // alpha:false 走合成器 opaque 路径；antialias:false 规避 Mali 上 MSAA 合成闪烁
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: preserve,
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(forcedScale ?? Math.min(window.devicePixelRatio || 1, 2))

    // 上下文丢失诊断（设备端闪烁时可在页面浮层看到原因）
    canvas.addEventListener('webglcontextlost', this._onContextLost)
    canvas.addEventListener('webglcontextrestored', this._onContextRestored)

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

  /** 设置运行中帧率上限；0 = 跟随显示器刷新率 */
  setMaxFps(n: number): void {
    this.maxFps = Math.max(0, n)
  }

  private _onContextLost = (e: Event): void => {
    e.preventDefault()
    this._host.__scilabShow?.('[contextlost] WebGL 上下文丢失，等待恢复…')
  }
  private _onContextRestored = (): void => {
    this._host.__scilabShow?.('[contextrestored] WebGL 上下文已恢复')
    this._dirty = true
  }

  /* ───── 事件监听（绑定方法引用，dispose 可彻底移除，修复匿名回调泄漏） ───── */
  private _st = { rotating: false, lastX: 0, lastY: 0, pinch: 0 }

  private _onResize = (): void => this.resize()
  private _onMouseDown = (e: MouseEvent): void => this._down(e.clientX, e.clientY)
  private _onMouseMove = (e: MouseEvent): void => this._move(e.clientX, e.clientY)
  private _onMouseUp = (): void => { this._st.rotating = false }
  private _onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) this._down(e.touches[0].clientX, e.touches[0].clientY)
    else if (e.touches.length === 2) this._st.pinch = this._pinch(e.touches)
    e.preventDefault()
  }
  private _onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 1) this._move(e.touches[0].clientX, e.touches[0].clientY)
    else if (e.touches.length === 2) {
      const d = this._pinch(e.touches)
      if (this._st.pinch > 0) this.zoom(this._st.pinch / d)
      this._st.pinch = d
    }
    e.preventDefault()
  }
  private _onTouchEnd = (): void => { this._st.rotating = false }
  private _onWheel = (e: WheelEvent): void => {
    this.zoom(e.deltaY > 0 ? 1.1 : 0.9)
    e.preventDefault()
  }

  private _down(x: number, y: number): void {
    this._st.rotating = true
    this._st.lastX = x
    this._st.lastY = y
  }
  private _move(x: number, y: number): void {
    if (!this._st.rotating) return
    this.orbit((x - this._st.lastX) * 0.005, (y - this._st.lastY) * 0.005)
    this._st.lastX = x
    this._st.lastY = y
  }

  private _bindEvents(): void {
    window.addEventListener('resize', this._onResize)
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize)
      this._ro.observe(this.canvas)
    }
    this.canvas.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', this._onTouchEnd)
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false })
  }

  private _unbindEvents(): void {
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    this.canvas.removeEventListener('mousedown', this._onMouseDown)
    this.canvas.removeEventListener('touchstart', this._onTouchStart)
    this.canvas.removeEventListener('touchmove', this._onTouchMove)
    this.canvas.removeEventListener('touchend', this._onTouchEnd)
    this.canvas.removeEventListener('wheel', this._onWheel)
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored)
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
        this._host.__scilabShow?.(`[resize风暴] 1s 内 ${this._resizeCount} 次 resize（${w}x${h}）`)
      }
      this._resizeCount = 0
      this._resizeTime = now
    }
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this._dirty = true
  }

  private _perfAcc = 0
  private _perfN = 0
  private _perfMax = 0
  private _perfWinStart = performance.now()

  private _lastW = 0
  private _lastH = 0
  private _resizeCount = 0
  private _resizeTime = 0

  /** V4：按需渲染状态——dirty 即时渲染；运行中按 maxFps 节流；空闲 5s 心跳 */
  private _dirty = true
  private _lastRenderT = 0
  private _acc = 0

  /** V2：单步推进（暂停态有效）：以当前流速步进 1/120s 并渲染 */
  stepOnce(): void {
    if (!this.paused) return
    const dt = (1 / 120) * this.timeScale
    for (const fn of this.updatables) fn(dt)
    this.renderer.render(this.scene, this.camera)
    this._lastRenderT = performance.now()
    this._dirty = false
  }

  private _loop(): void {
    // r7：dispose 停转检查——此前 rAF 无条件续排且不查 running，dispose 后僵尸引擎永远渲（离屏 canvas），双 context 并行导致闪屏
    if (!this.running) return
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

    // 按需渲染：活跃（运行/交互/参数变化）按 maxFps 节流渲染；空闲 5s 心跳（r6：静态画面零重绘防闪）
    // maxFps=0 → minInterval=0，活跃时每 rAF 帧都渲，跟随显示器刷新率（120Hz 屏可跑满 120）
    const now = performance.now()
    const active = dt > 0 || this._dirty
    const minInterval = this.maxFps > 0 ? 1000 / this.maxFps : 0
    const sinceLast = now - this._lastRenderT
    const shouldRender = active ? sinceLast >= minInterval : sinceLast >= 5000
    if (shouldRender) {
      const step = this._acc
      this._acc = 0
      const rt0 = performance.now()
      for (const fn of this.updatables) fn(step)
      this.renderer.render(this.scene, this.camera)
      this._lastRenderT = now
      // 帧耗时探针 r6：滚动 5s 窗口持续上报 avg/max + fps（截图任意时刻红条都有数据）
      const cost = performance.now() - rt0
      this._perfAcc += cost
      if (cost > this._perfMax) this._perfMax = cost
      this._perfN++
      if (now - this._perfWinStart > 5000 && this._perfN > 3) {
        this._host.__scilabShow?.(
          '[perf] avg ' + (this._perfAcc / this._perfN).toFixed(1) +
          'ms max ' + this._perfMax.toFixed(1) + 'ms fps=' + this.fps + ' (n=' + this._perfN + ')'
        )
        this._perfWinStart = now
        this._perfAcc = 0
        this._perfN = 0
        this._perfMax = 0
      }
      this._dirty = false
    }
  }

  dispose(): void {
    if (!this.running) return // 幂等：重复 dispose 直接返回
    this.running = false
    this._unbindEvents()
    this._ro?.disconnect()
    this._ro = null
    this.renderer.dispose()
    // 根治 r7 双 context 竞争：显式释放 WebGL context，避免旧引擎离屏 context 与新引擎并行
    this.renderer.forceContextLoss()
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
    this.onPost = null
    this.onFrame = null
  }
}
